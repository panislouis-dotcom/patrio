"""Normalización de bytes de imagen recién subidos.

Las cámaras de teléfono no rotan los píxeles: graban la orientación del sensor
en el tag EXIF `Orientation` y dejan que el visor la aplique. `Image.open()`
nunca la aplica — sólo `ImageOps.exif_transpose()` lo hace. Cualquier
redimensionado y re-guardado río abajo escribe entonces los píxeles de lado y
además pierde el tag al guardar, con lo que ya nadie puede corregirlo. Hornear
la rotación en los píxeles aquí, en la entrada, deja una sola representación
correcta para todo lo demás.
"""
import io

from PIL import Image, ImageOps

_ORIENTATION_TAG = 0x0112
_QUALITY = 92
_LOSSY_FORMATS = {"JPEG", "WEBP"}


def normalize_orientation(content: bytes) -> bytes:
    """Devuelve `content` con la rotación EXIF horneada en los píxeles.

    Devuelve los bytes intactos cuando no hay nada que corregir, para no gastar
    un re-encode con pérdida de balde."""
    try:
        img = Image.open(io.BytesIO(content))
        if img.getexif().get(_ORIENTATION_TAG, 1) == 1:
            return content
        # Un exif_transpose de un solo frame aplastaría los demás frames. Pasa
        # con WEBP animado, que sí lleva orientación; ninguna cámara los produce.
        if getattr(img, "n_frames", 1) > 1:
            return content
        fmt = img.format  # exif_transpose devuelve una imagen sin `format`
        transposed = ImageOps.exif_transpose(img)
    except Exception:
        # El content type lo declara el cliente: aquí llegan bytes que no son
        # imagen. Esto normaliza orientación; validar la subida es de las rutas.
        return content

    # exif_transpose ya borró el tag de `info["exif"]`; reescribirlo conserva el
    # resto de los metadatos sin arriesgar una segunda rotación río abajo.
    save_kwargs = {"exif": transposed.info["exif"]} if "exif" in transposed.info else {}
    if fmt in _LOSSY_FORMATS:
        save_kwargs["quality"] = _QUALITY
    buf = io.BytesIO()
    transposed.save(buf, format=fmt, **save_kwargs)
    return buf.getvalue()
