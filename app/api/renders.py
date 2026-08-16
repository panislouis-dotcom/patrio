"""Generación de renders — el único módulo que habla con OpenAI.

Claude no genera imágenes: lee. Por eso el render no sale de `parse_prospect`
sino de aquí, con su propio cliente y su propia llave. Dos proveedores, dos
trabajos, dos archivos: mezclarlos en uno es cómo se termina con una llamada
que ya no se puede cambiar de proveedor.
"""
import base64
import io
import os

PROVIDER = "openai"

# gpt-image-2 es el vigente. Se puede fijar otro sin tocar código porque el
# modelo queda escrito en cada render: un cambio de default no reescribe la
# historia de lo ya generado.
MODEL = os.getenv("OPENAI_IMAGE_MODEL", "gpt-image-2")

# Techo de la imagen que se manda: gpt-image trabaja a 1024–1536 px de lado.
# Subir una foto de 12 MP no compra fidelidad, compra latencia y costo.
MAX_EDGE_PHOTO = 1536

# Un plano es línea + texto (cotas, nombres de cuarto), mucho más liviano que
# una foto: el mismo tope de 1536px que basta para una fachada deja las
# etiquetas del plano ilegibles. Sube el techo solo para este camino.
MAX_EDGE_PLAN = 2048


def composite_enabled() -> bool:
    """¿Se pega la geometría exacta encima de lo que devolvió la IA?

    APAGADO por default desde 2026-08-16. Se lee en cada llamada, no al
    importar, para que una prueba o un experimento puedan cambiarlo sin
    recargar el módulo.

    El compositing se construyó (Task 37) sobre una medición real: `images.edit`
    trata la referencia como SESGO, no como restricción, y llegaba a inventar
    muros. Lo que no se volvió a revisar es que esa misma medición traía el
    remedio: el modelo se descarrila cuando la referencia lleva ~64% de lienzo
    vacío (desplazamiento 87-261px), y se queda quieto cuando el encuadre está
    ajustado (0-18px). O sea, el compositing estaba compensando un INPUT malo,
    no un techo del modelo.

    Con el encuadre arreglado (`planImage.ts`, el bbox ya no arrastra el origen
    del mundo al lienzo) y sin etiquetas de texto en la referencia, se midió el
    render 42 de la propiedad 5: la IA colocó los 4 muros interiores con error
    medio de 1.9px y máximo de 2.8px sobre un edificio de 1138px de ancho
    — 0.17%. La garantía que compraba el overlay vale ~2px.

    Y cuesta caro: pega un trazo plano y opaco `#111111` encima de un render
    fotorrealista donde la IA ya dibujó SUS propios muros, con acabado y
    sombreado. Aunque el afín esté perfecto (render 42: desviación -0.68%/+1.05%
    contra la razón del lienzo), dos sistemas de muro en la misma imagen se leen
    como cinta pegada: bandas negras dobles con rendijas blancas en el borde
    inferior, muro doble en la escalera, un tick negro suelto. Peor todavía, el
    overlay no ESCONDE el error geométrico del modelo, lo EXHIBE: sin él nadie
    puede notar que un muro se corrió; con él aparecen los dos muros juntos y el
    desfase salta a la vista. Los renders crudos anteriores a Task 37 (ids 7 y 12
    de la propiedad 5) se ven limpios justamente porque nadie les pegó nada.

    `RENDER_PLAN_COMPOSITE=1` lo vuelve a encender. Vale la pena si alguna vez se
    mide deriva real: el ancho de las barras negras que deja `_composite_geometry`
    en el borde es un diagnóstico gratis del error de escala (3px = alineado,
    95px = roto), así que se puede asertar sobre él en vez de componer siempre.
    """
    return os.environ.get("RENDER_PLAN_COMPOSITE", "0").strip().lower() in {"1", "true", "yes"}

# ── La cláusula que ningún prompt puede olvidar ───────────────────────────────
# No vive en la biblioteca de prompts a propósito. Si cada prompt tuviera que
# repetirla, tarde o temprano uno no la repetiría — y ese render sería de otra
# casa. El riesgo es concreto: un render que mueve una ventana o le quita un
# nivel al inmueble no es una propuesta, es una tergiversación de la propiedad
# frente a un inversionista.
_STRUCTURAL_CLAUSE = (
    "Conserva exactamente la geometría del inmueble de la foto: mismos muros, "
    "mismos vanos de puertas y ventanas en las mismas posiciones, mismo número "
    "de niveles, misma altura y mismo ángulo de cámara. No agregues ni quites "
    "volúmenes. Cambia únicamente acabados, vegetación y mobiliario según la "
    "instrucción. Fotorrealista, sin texto ni marcas de agua."
)


def compose_prompt(body: str) -> str:
    """Prompt de la biblioteca + la cláusula estructural, siempre en ese orden."""
    return f"{body.strip()}\n\n{_STRUCTURAL_CLAUSE}"


# ── La cláusula para un PLANO (no una foto) ──────────────────────────────────
# Un plano es una vista cenital: la fidelidad que se le exige no es «no muevas la
# cámara» sino «no muevas los muros». Y el resultado NO debe ser fotorrealista
# —eso lo volvería un 3D— sino un plano amueblado 2D, legible.
_PLAN_CLAUSE = (
    "Es una vista de planta arquitectónica (cenital, desde arriba). Conserva "
    "exactamente la distribución: mismos muros y divisiones, mismos vanos de "
    "puertas y ventanas en las mismas posiciones, mismo contorno. No agregues, "
    "quites ni muevas cuartos ni paredes. Los rectángulos grises que ya ves "
    "dibujados en la referencia son muebles reales, en su posición, tamaño y "
    "rotación reales — el texto te dice qué tipo de mueble es cada uno y en qué "
    "cuarto está. Dibuja cada uno ahí mismo, como ese mueble, en vez de inventar "
    "un mobiliario o una distribución distinta. La referencia también trae "
    "etiquetas de texto (nombre de cada cuarto, tipo de cada mueble): son SOLO "
    "para que tú identifiques qué es cada espacio y cada pieza — información de "
    "consulta, no contenido a dibujar. Tu resultado final NO debe contener ningún "
    "texto, letra, número ni etiqueta de ningún tipo, ni siquiera una versión "
    "aproximada o estilizada de las palabras de la referencia. Agrega acabados de "
    "piso y vegetación según la instrucción. Resultado en estilo de plano "
    "amueblado 2D, limpio y legible, no una fotografía 3D. Sin texto ni marcas de "
    "agua de ningún tipo en la imagen final."
)


def compose_plan_prompt(body: str) -> str:
    """Prompt de la biblioteca + la cláusula del plano: mantén la distribución,
    amuebla, y entrega un plano 2D — no un 3D."""
    return f"{body.strip()}\n\n{_PLAN_CLAUSE}"


def edit_kwargs() -> dict:
    """Parámetros opcionales de `images.edit`.

    `input_fidelity` NO va por default y esto está verificado contra la API, no
    supuesto: gpt-image-2 la rechaza con
    `400 invalid_input_fidelity_model`. Es un parámetro de la familia
    gpt-image-1, así que se manda solo si alguien lo pide a propósito junto con
    un modelo que lo acepte (OPENAI_INPUT_FIDELITY=high). Ojo con lo que hace:
    apega el resultado al ESTILO de la imagen de origen, no solo a su geometría
    —sobre un plano o un dibujo plano devuelve un dibujo plano, no una foto.
    """
    fidelity = os.getenv("OPENAI_INPUT_FIDELITY", "").strip()
    return {"input_fidelity": fidelity} if fidelity else {}


def _downscale(image_bytes: bytes, max_edge: int) -> tuple[bytes, str]:
    """Reduce al lado máximo y normaliza a PNG. Devuelve (bytes, content_type).

    `max_edge` lo decide el llamador (foto vs. plano tienen topes distintos) —
    esta función ya no sabe cuál camino la está usando, solo obedece el tope
    que le dan.
    """
    from PIL import Image

    img = Image.open(io.BytesIO(image_bytes))
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGB")
    if max(img.size) > max_edge:
        img.thumbnail((max_edge, max_edge), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue(), "image/png"


# gpt-image-2 acepta cualquier "WIDTHxHEIGHT" siempre que: ancho y alto sean
# múltiplos de 16, la razón entre ellos quede entre 1:3 y 3:1, y no pase de
# 3840x2160 (verificado contra el SDK instalado, no supuesto — ver el plan
# 2026-08-12-fidelidad-dimensional-renders.md).
_MIN_RATIO = 1 / 3
_MAX_RATIO = 3.0

# Task 35 (addendum de fidelidad geométrica, 2026-08-13): a 1024*1024
# (~1.05 MP, el presupuesto original) un muro interior de 0.10 m en una casa
# de 20 m de ancho se pinta a ~5.8 px — sub-token para un modelo que
# tokeniza por parches (calculado, no medido: ver
# docs/plans/2026-08-13-fidelidad-geometrica-renders-plano.md). 2560x1440
# (~3.69 MP) es el techo que la propia API documenta como "no experimental"
# (arriba de eso "los resultados pueden ser más variables" — ver el SDK
# instalado y el plan de fidelidad dimensional, 2026-08-12); apuntar al
# mismo presupuesto TOTAL de píxeles sube la resolución real de cada muro
# ~3.5× sin cruzar a territorio experimental.
_TARGET_PIXELS = 2560 * 1440

_SIZE_TOLERANCE = 0.02


def _round16(value: float) -> int:
    """Redondea al múltiplo de 16 más cercano — la API rechaza cualquier otro."""
    return max(16, round(value / 16) * 16)


def _floor16(value: float) -> int:
    """Redondea HACIA ABAJO al múltiplo de 16 — a diferencia de `_round16` (que
    redondea al más cercano y puede subir), garantiza que el resultado nunca
    EXCEDA `value`. Necesario en la salvaguarda de razón máxima: redondear al más
    cercano ahí podía dejar una razón por encima del límite que la API rechaza."""
    return max(16, (int(value) // 16) * 16)


def _ceil16(value: float) -> int:
    """Redondea HACIA ARRIBA al múltiplo de 16 — simétrico a `_floor16`, garantiza
    que el resultado nunca quede POR DEBAJO de `value`. Necesario en la salvaguarda
    de razón mínima."""
    return max(16, -(-int(value) // 16) * 16)


def _output_size(image_bytes: bytes) -> str:
    """Devuelve el "WIDTHxHEIGHT" que más se acerca a la razón de aspecto real
    de `image_bytes`, dentro de lo que gpt-image-2 soporta.

    Pura y determinista a propósito: sin esto no se puede probar sin llamar a
    OpenAI en cada corrida de la suite.

    Algoritmo: calcula la razón real (alto/ancho), la recorta a [1:3, 3:1] si
    se pasa, y elige ancho = √(presupuesto / razón) redondeado a 16; alto =
    ancho × razón, también redondeado a 16. Redondear a 16 puede desviar la
    razón resultante más de lo tolerado — si pasa, se empuja el alto de a 16px
    hacia la razón objetivo y se revisa de nuevo.
    """
    from PIL import Image

    img = Image.open(io.BytesIO(image_bytes))
    real_width, real_height = img.size
    ratio = real_height / real_width
    ratio = min(max(ratio, _MIN_RATIO), _MAX_RATIO)

    width = _round16((_TARGET_PIXELS / ratio) ** 0.5)
    height = _round16(width * ratio)

    attempts = 0
    while abs(height / width - ratio) > _SIZE_TOLERANCE and attempts < 8:
        height += -16 if height / width > ratio else 16
        height = max(16, height)
        attempts += 1

    # Salvaguarda dura: pase lo que pase con el redondeo de arriba, nunca se
    # manda una razón fuera de lo que la API acepta.
    #
    # Bug real, encontrado en la Task 35 al subir `_TARGET_PIXELS`: `_round16` (al
    # más cercano) puede redondear el lado corregido HACIA EL LADO EQUIVOCADO del
    # límite. Ejemplo real que lo expuso: 1200x200 (6:1) con el presupuesto nuevo
    # rendía width=3328, height=1104 antes de esta salvaguarda — height/width =
    # 0.3318, por DEBAJO de _MIN_RATIO (0.3333...). La rama de abajo recalculaba
    # `_round16(3328 * (1/3))` = `_round16(1109.33)` = 1104 — EL MISMO valor
    # redondeado al más cercano, sin corregir nada: la razón final quedaba en
    # 3.0145, por encima del 3.0 que la API exige como tope duro. `_floor16`/
    # `_ceil16` (redondeo direccional, no al más cercano) garantizan que el
    # resultado SIEMPRE caiga del lado permitido, nunca lo cruce por redondeo.
    final_ratio = height / width
    if final_ratio > _MAX_RATIO:
        # height/width debe quedar <= _MAX_RATIO: redondear height HACIA ABAJO
        # nunca puede empujarlo por encima del límite.
        height = _floor16(width * _MAX_RATIO)
    elif final_ratio < _MIN_RATIO:
        # Simétrico: height/width debe quedar >= _MIN_RATIO: redondear HACIA ARRIBA.
        height = _ceil16(width * _MIN_RATIO)

    return f"{width}x{height}"


# ── Task 37: componer la geometría exacta encima del resultado de la IA ──────
#
# Diagnóstico del addendum completo (docs/plans/2026-08-13-fidelidad-
# geometrica-renders-plano.md): images.edit no es una transformación que
# preserve geometría — es una re-síntesis completa. Ningún prompt lo cambia.
# La única forma de garantizar "el muro final SIEMPRE es el real" es no
# depender de que la IA lo haya dibujado bien: se compone el trazo exacto
# (la MISMA referencia limpia que ya se le mandó a OpenAI, Task 34) encima
# de lo que la IA devolvió.
#
# Validado con un render real (Task 36, propiedad 5, 2026-08-13): el eje X
# del resultado de OpenAI coincide casi exactamente con el de la referencia,
# pero el eje Y se estira ~16% (anclado en el mismo borde superior, no un
# recorte caótico) — un pegado a coordenadas fijas queda mal alineado hacia
# abajo. Fix: detectar el bounding box de CONTENIDO real (no blanco) de
# ambas imágenes y ajustar con una transformación afín simple (escala X/Y
# independientes + traslado) antes de componer — prototipado y verificado
# visualmente contra ese mismo render real antes de escribir este código.

WALL_CORE_LUMINANCE = 25
# Cualquier pixel tan oscuro como esto (el trazo real de muro/vano,
# `#111111` ≈ 17, nunca puro negro 0) recibe alfa TOTAL — sin este piso, un
# muro real quedaría semitransparente en vez de opaco.
WALL_LUMINANCE_MAX = 60
# Separa el trazo de muro/vano real (`#111111`, ~17) del contorno de
# silueta de mueble (`#555555`, ~85): el mueble es solo una sugerencia de
# colocación para la IA — nunca se fuerza, solo el muro se compone con
# garantía. Entre WALL_CORE_LUMINANCE y este valor hay una rampa suave para
# el antialiasing del reescalado (ver `_wall_alpha` en `_composite_geometry`).

_BBOX_BG_THRESHOLD = 245
# Un pixel más claro que esto se trata como "fondo/página en blanco", no
# contenido real — mismo umbral usado para detectar tanto la referencia
# (línea sobre blanco) como la salida fotorrealista (donde TODO el interior
# del edificio queda no-blanco, así que el bbox de "no blanco" traza el
# contorno real del edificio con buena fidelidad, verificado empíricamente).


def _content_bbox(img):
    """Bounding box (x0,y0,x1,y1) del contenido no-blanco de `img`, o `None`
    si la imagen está en blanco por completo (nada que alinear)."""
    gray = img.convert("L")
    mask = gray.point(lambda p: 255 if p < _BBOX_BG_THRESHOLD else 0)
    return mask.getbbox()


def _composite_geometry(reference_bytes: bytes, output_bytes: bytes) -> bytes:
    """Compone el trazo de muros/vanos de `reference_bytes` (la referencia
    limpia que se mandó a OpenAI) OPACO encima de `output_bytes` (lo que
    OpenAI devolvió), ajustado por un afín simple que alinea el bounding box
    de contenido de ambas imágenes.

    Si no se puede detectar contenido en alguna de las dos (imagen en
    blanco, caso degenerado) se regresa `output_bytes` tal cual — mejor no
    componer nada que arriesgar una composición mal alineada sobre datos
    que no se pueden medir.
    """
    from PIL import Image

    ref = Image.open(io.BytesIO(reference_bytes)).convert("RGBA")
    out = Image.open(io.BytesIO(output_bytes)).convert("RGBA")

    ref_bbox = _content_bbox(ref)
    out_bbox = _content_bbox(out)
    if ref_bbox is None or out_bbox is None:
        return output_bytes

    rx0, ry0, rx1, ry1 = ref_bbox
    ox0, oy0, ox1, oy1 = out_bbox
    ref_w, ref_h = max(1, rx1 - rx0), max(1, ry1 - ry0)
    scale_x = (ox1 - ox0) / ref_w
    scale_y = (oy1 - oy0) / ref_h

    new_w = max(1, round(ref.width * scale_x))
    new_h = max(1, round(ref.height * scale_y))
    resized = ref.resize((new_w, new_h), Image.LANCZOS)

    off_x = round(ox0 - rx0 * scale_x)
    off_y = round(oy0 - ry0 * scale_y)

    aligned = Image.new("RGBA", out.size, (0, 0, 0, 0))
    aligned.paste(resized, (off_x, off_y))

    # Alfa de dos tramos: OPACO completo para cualquier pixel tan oscuro como
    # el trazo real de muro (`#111111`, luminancia ~17 — nunca puro negro
    # 0, así que la rampa no puede empezar en 0 o el muro real mismo
    # quedaría semitransparente, bug real encontrado al escribir el test).
    # Entre WALL_CORE_LUMINANCE y WALL_LUMINANCE_MAX hay una rampa suave —
    # el antialiasing del reescalado deja pixeles de borde en esa banda, y
    # sin rampa el borde del muro compuesto saldría dentado. Cualquier cosa
    # a partir de WALL_LUMINANCE_MAX (incluido el gris de silueta de
    # mueble, ~85) queda en cero a propósito.
    gray = aligned.convert("L")

    def _wall_alpha(p: int) -> int:
        if p <= WALL_CORE_LUMINANCE:
            return 255
        if p >= WALL_LUMINANCE_MAX:
            return 0
        span = WALL_LUMINANCE_MAX - WALL_CORE_LUMINANCE
        return round(255 * (WALL_LUMINANCE_MAX - p) / span)

    alpha = gray.point(_wall_alpha)
    wall_layer = Image.new("RGBA", out.size, (17, 17, 17, 255))
    wall_layer.putalpha(alpha)

    composited = Image.alpha_composite(out, wall_layer)
    buf = io.BytesIO()
    composited.convert("RGB").save(buf, format="PNG")
    return buf.getvalue()


def generate_image(image_bytes: bytes, content_type: str, prompt: str, *,
                    max_edge: int, match_aspect: bool) -> tuple[bytes, str]:
    """Manda la foto y el prompt a OpenAI. Devuelve (bytes del render, mime).

    Es la única llamada de pago del módulo y la única costura que las pruebas
    sustituyen: todo lo demás —persistencia, provenance, validación— se prueba
    de verdad contra la base.

    `max_edge` y `match_aspect` los decide el llamador: una foto quiere el
    cuadrado fijo de siempre (`match_aspect=False`) con el tope de 1536; un
    plano quiere su proporción real (`match_aspect=True`) con el tope de 2048.
    Esta función ya no sabe cuál camino la llamó, solo obedece lo que le piden.
    """
    from openai import OpenAI

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RenderUnavailable("OPENAI_API_KEY no está configurada")

    prepared, _ = _downscale(image_bytes, max_edge)
    size = _output_size(image_bytes) if match_aspect else "1024x1024"
    # Task 35: un plano es línea + texto denso (cotas, nombres) — "high" sube el
    # presupuesto de TOKENS DE SALIDA que el modelo gasta dibujando el detalle fino
    # de muros/vanos; no cambia cómo se LEE la entrada (gpt-image-2 siempre procesa
    # la referencia a alta fidelidad, sin importar `quality`). Una foto no tiene ese
    # problema de detalle lineal fino, así que se queda en el `auto` de siempre en
    # vez de pagar el costo extra sin beneficio de fidelidad geométrica.
    quality = "high" if match_aspect else "auto"
    client = OpenAI(api_key=api_key, max_retries=2)
    result = client.images.edit(
        model=MODEL,
        image=("source.png", io.BytesIO(prepared), "image/png"),
        prompt=prompt,
        size=size,
        quality=quality,
        n=1,
        **edit_kwargs(),
    )
    b64 = result.data[0].b64_json
    if not b64:
        raise RenderUnavailable("OpenAI no devolvió imagen")
    raw = base64.b64decode(b64)

    # Task 37: solo el camino de plano tiene una referencia limpia de línea
    # (Task 34) cuya geometría se pueda componer con garantía — una foto no
    # tiene un "trazo verdadero" equivalente que componer encima.
    if match_aspect and composite_enabled():
        raw = _composite_geometry(image_bytes, raw)

    return raw, "image/png"


class RenderUnavailable(RuntimeError):
    """El proveedor no pudo entregar un render. Se traduce a 502, no a 500:
    la petición estaba bien, quien falló fue el tercero."""
