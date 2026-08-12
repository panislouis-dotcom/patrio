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
    "quites ni muevas cuartos ni paredes. Amuebla cada espacio y agrega acabados "
    "de piso y vegetación según la instrucción. Resultado en estilo de plano "
    "amueblado 2D, limpio y legible, no una fotografía 3D. Sin texto ni marcas "
    "de agua."
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

# Mismo orden de magnitud que el "1024x1024" fijo de hoy (~1.05 MP): lo que
# cambia con este presupuesto es la FORMA del lienzo, no su tamaño total —
# no hay razón para pagar más costo/latencia solo por respetar la proporción.
_TARGET_PIXELS = 1024 * 1024

_SIZE_TOLERANCE = 0.02


def _round16(value: float) -> int:
    """Redondea al múltiplo de 16 más cercano — la API rechaza cualquier otro."""
    return max(16, round(value / 16) * 16)


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
    final_ratio = height / width
    if final_ratio > _MAX_RATIO:
        height = _round16(width * _MAX_RATIO)
    elif final_ratio < _MIN_RATIO:
        height = _round16(width * _MIN_RATIO)

    return f"{width}x{height}"


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
    client = OpenAI(api_key=api_key, max_retries=2)
    result = client.images.edit(
        model=MODEL,
        image=("source.png", io.BytesIO(prepared), "image/png"),
        prompt=prompt,
        size=size,
        n=1,
        **edit_kwargs(),
    )
    b64 = result.data[0].b64_json
    if not b64:
        raise RenderUnavailable("OpenAI no devolvió imagen")
    return base64.b64decode(b64), "image/png"


class RenderUnavailable(RuntimeError):
    """El proveedor no pudo entregar un render. Se traduce a 502, no a 500:
    la petición estaba bien, quien falló fue el tercero."""
