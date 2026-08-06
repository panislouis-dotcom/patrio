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
_MAX_EDGE = 1536

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


def _downscale(image_bytes: bytes) -> tuple[bytes, str]:
    """Reduce al lado máximo y normaliza a PNG. Devuelve (bytes, content_type)."""
    from PIL import Image

    img = Image.open(io.BytesIO(image_bytes))
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGB")
    if max(img.size) > _MAX_EDGE:
        img.thumbnail((_MAX_EDGE, _MAX_EDGE), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue(), "image/png"


def generate_image(image_bytes: bytes, content_type: str, prompt: str) -> tuple[bytes, str]:
    """Manda la foto y el prompt a OpenAI. Devuelve (bytes del render, mime).

    Es la única llamada de pago del módulo y la única costura que las pruebas
    sustituyen: todo lo demás —persistencia, provenance, validación— se prueba
    de verdad contra la base.
    """
    from openai import OpenAI

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RenderUnavailable("OPENAI_API_KEY no está configurada")

    prepared, _ = _downscale(image_bytes)
    client = OpenAI(api_key=api_key, max_retries=2)
    result = client.images.edit(
        model=MODEL,
        image=("source.png", io.BytesIO(prepared), "image/png"),
        prompt=prompt,
        size="1024x1024",
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
