"""Renders: la biblioteca de prompts y la propuesta que no se disfraza de foto."""
import base64
import io
from types import SimpleNamespace

import pytest
from PIL import Image, ImageDraw

from api import storage


def _png_bytes():
    # 1x1 transparent PNG
    return bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
        "0000000a49444154789c6360000002000154a24f7f0000000049454e44ae426082"
    )


@pytest.fixture
def fake_openai(monkeypatch):
    """Sustituye la única llamada de pago. Devuelve bytes distintos a la fuente
    para que una prueba no pueda pasar por accidente devolviendo la original."""
    from api import renders

    calls = []

    def _fake(image_bytes: bytes, content_type: str, prompt: str, *,
              max_edge: int, match_aspect: bool):
        calls.append({
            "image": image_bytes, "content_type": content_type, "prompt": prompt,
            "max_edge": max_edge, "match_aspect": match_aspect,
        })
        return b"RENDERED-BYTES", "image/png"

    monkeypatch.setattr(renders, "generate_image", _fake)
    return calls


@pytest.fixture
def fake_images_edit(monkeypatch):
    """Sustituye SOLO la llamada HTTP de `images.edit`, dejando que
    `generate_image` corra de verdad — así se puede afirmar qué `size` y qué
    tope de downscale calculó por dentro, algo que `fake_openai` (que sustituye
    `generate_image` entero) no puede ver."""
    import openai

    calls = []

    class _FakeImages:
        def edit(self, **kwargs):
            calls.append(kwargs)
            # Un PNG real y decodificable, no el hex de 1x1 de `_png_bytes()`
            # (Task 37: `generate_image` ahora sí abre los bytes de "salida"
            # con PIL para componer geometría en el camino de plano — ese
            # fixture minúsculo truena con "broken data stream" al primer
            # intento real de procesarlo, algo que ningún test anterior
            # necesitaba hacer).
            b64 = base64.b64encode(_rect_png_bytes(64, 64)).decode()
            return SimpleNamespace(data=[SimpleNamespace(b64_json=b64)])

    class _FakeClient:
        def __init__(self, *args, **kwargs):
            self.images = _FakeImages()

    monkeypatch.setattr(openai, "OpenAI", _FakeClient)
    monkeypatch.setenv("OPENAI_API_KEY", "test-key-not-used")
    return calls


def _rect_png_bytes(width: int, height: int) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (width, height), (10, 20, 30)).save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def source_image(client, test_property):
    r = client.post(
        f"/api/properties/{test_property['id']}/images",
        files={"file": ("fachada.png", io.BytesIO(_png_bytes()), "image/png")},
        data={"image_type": "antes"},
    )
    assert r.status_code == 201, r.text
    return r.json()


# ─── Subida manual (sin proveedor) ────────────────────────────────────────────

def test_uploading_a_render_for_a_photo_stores_it_without_calling_the_provider(
    client, test_property, source_image, monkeypatch,
):
    from api import renders

    def _boom(*args, **kwargs):
        raise AssertionError("subir un render no debe llamar al proveedor")
    monkeypatch.setattr(renders, "generate_image", _boom)

    r = client.post(
        f"/api/properties/{test_property['id']}/renders/upload",
        files={"file": ("render.png", io.BytesIO(_rect_png_bytes(64, 64)), "image/png")},
        data={"sourceImageId": str(source_image["id"])},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["sourceImageId"] == source_image["id"]
    assert body["provider"] == "upload"
    assert body["model"] == "manual"
    assert body["promptText"]  # nunca vacío: CHECK de la tabla


def test_an_uploaded_photo_render_can_be_chosen(client, test_property, source_image):
    r = client.post(
        f"/api/properties/{test_property['id']}/renders/upload",
        files={"file": ("render.png", io.BytesIO(_rect_png_bytes(64, 64)), "image/png")},
        data={"sourceImageId": str(source_image["id"])},
    )
    render_id = r.json()["id"]
    chosen = client.put(f"/api/properties/{test_property['id']}/renders/{render_id}/choose")
    assert chosen.status_code == 200, chosen.text
    assert chosen.json()["isChosen"] is True


def test_uploading_a_render_for_a_photo_outside_the_property_is_422(client, test_property):
    r = client.post(
        f"/api/properties/{test_property['id']}/renders/upload",
        files={"file": ("render.png", io.BytesIO(_rect_png_bytes(64, 64)), "image/png")},
        data={"sourceImageId": "999999"},
    )
    assert r.status_code == 422, r.text


def test_uploading_an_unsupported_file_type_is_415(client, test_property, source_image):
    r = client.post(
        f"/api/properties/{test_property['id']}/renders/upload",
        files={"file": ("render.txt", io.BytesIO(b"no es una imagen"), "text/plain")},
        data={"sourceImageId": str(source_image["id"])},
    )
    assert r.status_code == 415, r.text


def test_uploading_a_jpeg_render_keeps_its_real_content_type(client, test_property, source_image):
    """La ruta guardada debe llevar la extensión real del archivo subido, no un
    `.png` fijo: en el backend de disco local, `storage.stream` deriva el
    Content-Type servido de la EXTENSIÓN del archivo, no de la columna
    `content_type` de la BD — un JPEG guardado como `.png` se serviría de
    vuelta con un Content-Type mentiroso."""
    buf = io.BytesIO()
    Image.new("RGB", (10, 10), (200, 50, 50)).save(buf, format="JPEG")
    r = client.post(
        f"/api/properties/{test_property['id']}/renders/upload",
        files={"file": ("render.jpg", io.BytesIO(buf.getvalue()), "image/jpeg")},
        data={"sourceImageId": str(source_image["id"])},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["contentType"] == "image/jpeg"
    assert body["filePath"].endswith(".jpg")


def test_uploading_a_render_ignores_a_spoofed_filename_extension(client, test_property, source_image):
    """El nombre de archivo lo manda el cliente; la extensión real la decide el
    Content-Type validado, nunca el filename — si no, un Content-Type permitido
    con un filename `.svg`/`.html` guardaría el archivo con esa extensión, y
    storage.stream() (que adivina el Content-Type de SERVIDO por la extensión
    del path, no por la columna de la BD) lo serviría como SVG/HTML."""
    r = client.post(
        f"/api/properties/{test_property['id']}/renders/upload",
        files={"file": ("evil.svg", io.BytesIO(_rect_png_bytes(64, 64)), "image/png")},
        data={"sourceImageId": str(source_image["id"])},
    )
    assert r.status_code == 201, r.text
    assert r.json()["filePath"].endswith(".png")


def test_uploading_a_render_from_plan_groups_it_by_floor(client, test_property):
    r = client.post(
        f"/api/properties/{test_property['id']}/renders/from-plan/upload",
        files={"file": ("render.png", io.BytesIO(_rect_png_bytes(64, 64)), "image/png")},
        data={"variant": "original", "floorId": "floor-abc-123", "floorName": "Planta Baja"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["sourceImageId"] is None
    assert body["sourcePlanPath"] is None  # no hubo plano de referencia: no lo vio la IA
    assert body["sourceVariant"] == "original"
    assert body["floorId"] == "floor-abc-123"
    assert body["provider"] == "upload"
    assert body["model"] == "manual"


def test_uploading_a_render_from_plan_with_an_invalid_variant_is_422(client, test_property):
    r = client.post(
        f"/api/properties/{test_property['id']}/renders/from-plan/upload",
        files={"file": ("render.png", io.BytesIO(_rect_png_bytes(64, 64)), "image/png")},
        data={"variant": "no-existe", "floorId": "floor-abc-123", "floorName": "Planta Baja"},
    )
    assert r.status_code == 422, r.text


def test_an_uploaded_plan_render_can_be_chosen(client, test_property):
    r = client.post(
        f"/api/properties/{test_property['id']}/renders/from-plan/upload",
        files={"file": ("render.png", io.BytesIO(_rect_png_bytes(64, 64)), "image/png")},
        data={"variant": "original", "floorId": "floor-abc-123", "floorName": "Planta Baja"},
    )
    render_id = r.json()["id"]
    chosen = client.put(f"/api/properties/{test_property['id']}/renders/{render_id}/choose")
    assert chosen.status_code == 200, chosen.text
    assert chosen.json()["isChosen"] is True


# ─── Parámetros que se le mandan al proveedor ─────────────────────────────────

def test_generating_a_render_from_the_plan_keeps_the_plan_as_source(
    client, test_property, fake_openai,
):
    """La fuente es el plano, no una foto: source_image_id queda NULL y la ruta
    del plano vive en source_plan_path."""
    r = client.post(
        f"/api/properties/{test_property['id']}/renders/from-plan",
        files={"file": ("plano.png", io.BytesIO(_png_bytes()), "image/png")},
        data={"promptText": "Amuebla la planta: sala amplia, cocina integral.",
              "variant": "original",
              "floorId": "floor-abc-123", "floorName": "Planta Baja"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["sourceImageId"] is None
    assert body["sourcePlanPath"]  # el plano se conservó como fuente


def test_a_plan_render_uses_the_plan_clause_not_the_photo_clause(
    client, test_property, fake_openai,
):
    client.post(
        f"/api/properties/{test_property['id']}/renders/from-plan",
        files={"file": ("plano.png", io.BytesIO(_png_bytes()), "image/png")},
        data={"promptText": "Amuebla la planta.", "variant": "original",
              "floorId": "floor-abc-123", "floorName": "Planta Baja"},
    )
    prompt = fake_openai[-1]["prompt"]
    assert "vista de planta" in prompt          # la cláusula del plano se añadió
    assert "ángulo de cámara" not in prompt      # la de la foto, no


def test_a_plan_render_does_not_land_in_the_photo_gallery(
    client, test_property, fake_openai,
):
    client.post(
        f"/api/properties/{test_property['id']}/renders/from-plan",
        files={"file": ("plano.png", io.BytesIO(_png_bytes()), "image/png")},
        data={"promptText": "Amuebla la planta.", "variant": "original",
              "floorId": "floor-abc-123", "floorName": "Planta Baja"},
    )
    # No hay endpoint propio para listar fotos: `images` vive embebido en la
    # propiedad, igual que en cualquier otro lector (properties_db.parse_property).
    assert client.get(f"/api/properties/{test_property['id']}").json()["images"] == []


def test_a_rotated_plan_is_straightened_for_both_of_its_uses(
    client, test_property, fake_openai,
):
    """El plano se normaliza UNA vez, antes de sus dos lecturas. Enderezar sólo
    la copia que se guarda dejaría lo almacenado bien y el render generándose
    igual de un plano de lado: el error se vería en la imagen final, lejos de
    aquí. Por eso las dos mitades se afirman juntas."""
    exif = Image.Exif()
    exif[0x0112] = 6  # rotación de 90°: el alto y el ancho salen intercambiados
    buf = io.BytesIO()
    Image.new("RGB", (20, 40), (30, 30, 200)).save(buf, format="PNG", exif=exif)

    r = client.post(
        f"/api/properties/{test_property['id']}/renders/from-plan",
        files={"file": ("plano.png", io.BytesIO(buf.getvalue()), "image/png")},
        data={"promptText": "Amuebla la planta.", "variant": "original",
              "floorId": "floor-abc-123", "floorName": "Planta Baja"},
    )
    assert r.status_code == 201, r.text

    stored = Image.open(io.BytesIO(storage.stream(r.json()["sourcePlanPath"])[0]))
    assert stored.size == (40, 20)
    assert stored.getexif().get(0x0112, 1) == 1

    sent = Image.open(io.BytesIO(fake_openai[-1]["image"]))
    assert sent.size == (40, 20)
    assert sent.getexif().get(0x0112, 1) == 1


def test_editing_a_render_builds_on_it_and_chains_to_it(
    client, test_property, source_image, fake_openai,
):
    """Editar avanza sobre la MISMA imagen: los PÍXELES que se mandan a editar son
    los del render padre, no la foto — pero `sourceImageId` no es "de dónde salió
    el pixel", es a qué foto PERTENECE la cadena (mismo patrón que
    `sourceVariant`/`floorId`, migración 047): el hijo lo hereda, no lo pierde."""
    parent = client.post(
        f"/api/properties/{test_property['id']}/renders",
        json={"sourceImageId": source_image["id"], "promptText": "Jardín inicial."},
    ).json()
    r = client.post(
        f"/api/properties/{test_property['id']}/renders/{parent['id']}/edit",
        json={"promptText": "Agrega una puerta al baño."},
    )
    assert r.status_code == 201, r.text
    child = r.json()
    assert child["parentRenderId"] == parent["id"]              # cuelga del padre
    assert child["sourceImageId"] == source_image["id"]         # pero sigue siendo de esa foto
    # Editó ENCIMA de la imagen del padre: esos bytes fueron los que se mandaron.
    assert fake_openai[-1]["image"] == b"RENDERED-BYTES"


def test_editing_a_plan_render_keeps_the_plan_clause(
    client, test_property, fake_openai,
):
    parent = client.post(
        f"/api/properties/{test_property['id']}/renders/from-plan",
        files={"file": ("plano.png", io.BytesIO(_png_bytes()), "image/png")},
        data={"promptText": "Amuebla.", "variant": "original",
              "floorId": "floor-abc-123", "floorName": "Planta Baja"},
    ).json()
    client.post(
        f"/api/properties/{test_property['id']}/renders/{parent['id']}/edit",
        json={"promptText": "Agrega puerta al baño."},
    )
    assert "vista de planta" in fake_openai[-1]["prompt"]   # cláusula de plano, no la de foto


def test_editing_a_photo_render_keeps_the_photo_clause(
    client, test_property, source_image, fake_openai,
):
    parent = client.post(
        f"/api/properties/{test_property['id']}/renders",
        json={"sourceImageId": source_image["id"], "promptText": "x"},
    ).json()
    client.post(
        f"/api/properties/{test_property['id']}/renders/{parent['id']}/edit",
        json={"promptText": "y"},
    )
    assert "ángulo de cámara" in fake_openai[-1]["prompt"]   # cláusula de foto


# ─── Tamaño de salida y tope de referencia: foto vs. plano ────────────────────
#
# Estas pruebas usan `fake_images_edit`, no `fake_openai`: necesitan ver lo que
# `generate_image` calculó de verdad puertas adentro (el `size` y el tamaño de
# la imagen de referencia que preparó), algo invisible si se sustituye
# `generate_image` entero.

def test_a_photo_render_keeps_the_fixed_square_size_and_the_1536_cap(
    client, test_property, fake_images_edit,
):
    """El comportamiento de hoy para fotos no cambia ni un bit: cuadrado fijo,
    tope de referencia 1536, sin importar la forma real de la foto fuente."""
    big_photo = _rect_png_bytes(3000, 2000)   # más grande que el tope: debe recortarse
    up = client.post(
        f"/api/properties/{test_property['id']}/images",
        files={"file": ("fachada.png", io.BytesIO(big_photo), "image/png")},
        data={"image_type": "antes"},
    )
    assert up.status_code == 201, up.text

    r = client.post(
        f"/api/properties/{test_property['id']}/renders",
        json={"sourceImageId": up.json()["id"], "promptText": "Jardín."},
    )
    assert r.status_code == 201, r.text

    assert fake_images_edit[-1]["size"] == "1024x1024"
    assert fake_images_edit[-1]["quality"] == "auto"   # sin el costo extra de "high"
    sent = Image.open(fake_images_edit[-1]["image"][1])
    assert max(sent.size) == 1536   # el tope de foto, no el de plano (2048)


def test_a_plan_render_uses_its_real_aspect_ratio_and_the_2048_cap(
    client, test_property, fake_images_edit,
):
    """El plano NO sale cuadrado: el `size` que se manda a `images.edit` es el
    que calcula `_output_size` sobre la forma real del plano, y la imagen de
    referencia se prepara con el tope de 2048, no el de 1536 de las fotos."""
    from api import renders

    real_width, real_height = 599, 1105   # proporción real de la propiedad 5
    big_plan = _rect_png_bytes(real_width * 4, real_height * 4)   # > 2048: debe recortarse
    expected_size = renders._output_size(big_plan)

    r = client.post(
        f"/api/properties/{test_property['id']}/renders/from-plan",
        files={"file": ("plano.png", io.BytesIO(big_plan), "image/png")},
        data={"promptText": "Amuebla la planta.", "variant": "original",
              "floorId": "floor-abc-123", "floorName": "Planta Baja"},
    )
    assert r.status_code == 201, r.text

    assert fake_images_edit[-1]["size"] == expected_size
    assert expected_size != "1024x1024"   # el fixture es deliberadamente rectangular
    sent = Image.open(fake_images_edit[-1]["image"][1])
    assert max(sent.size) == 2048   # el tope de plano, no el de foto (1536)


def test_a_plan_render_uses_quality_high(client, test_property, fake_images_edit):
    """Task 35: un muro interior vive en pocos píxeles a la calidad `auto` de
    siempre — `high` sube el presupuesto de tokens de salida solo para el
    camino de plano, donde el detalle lineal fino sí importa."""
    plan = _rect_png_bytes(599, 1105)   # mismo patrón que los demás tests con fake_images_edit
    r = client.post(
        f"/api/properties/{test_property['id']}/renders/from-plan",
        files={"file": ("plano.png", io.BytesIO(plan), "image/png")},
        data={"promptText": "Amuebla la planta.", "variant": "original",
              "floorId": "floor-abc-123", "floorName": "Planta Baja"},
    )
    assert r.status_code == 201, r.text
    assert fake_images_edit[-1]["quality"] == "high"


def test_editing_a_plan_render_inherits_match_aspect_and_the_plan_cap(
    client, test_property, fake_openai,
):
    """Mismo patrón que `test_editing_a_plan_render_keeps_the_plan_clause`: lo
    que decide `chain_is_plan` también decide el tamaño de salida, no solo la
    cláusula del prompt."""
    parent = client.post(
        f"/api/properties/{test_property['id']}/renders/from-plan",
        files={"file": ("plano.png", io.BytesIO(_png_bytes()), "image/png")},
        data={"promptText": "Amuebla.", "variant": "original",
              "floorId": "floor-abc-123", "floorName": "Planta Baja"},
    ).json()
    client.post(
        f"/api/properties/{test_property['id']}/renders/{parent['id']}/edit",
        json={"promptText": "Agrega puerta al baño."},
    )
    from api import renders
    assert fake_openai[-1]["match_aspect"] is True
    assert fake_openai[-1]["max_edge"] == renders.MAX_EDGE_PLAN


def test_editing_a_photo_render_inherits_the_fixed_size_and_the_photo_cap(
    client, test_property, source_image, fake_openai,
):
    parent = client.post(
        f"/api/properties/{test_property['id']}/renders",
        json={"sourceImageId": source_image["id"], "promptText": "x"},
    ).json()
    client.post(
        f"/api/properties/{test_property['id']}/renders/{parent['id']}/edit",
        json={"promptText": "y"},
    )
    from api import renders
    assert fake_openai[-1]["match_aspect"] is False
    assert fake_openai[-1]["max_edge"] == renders.MAX_EDGE_PHOTO


def test_render_heads_are_the_latest_of_each_chain(
    client, test_property, source_image, fake_openai,
):
    """La presentación toma una render por línea: la cabeza (la más reciente).
    Los pasos intermedios de una edición quedan fuera."""
    from api import renders_db
    pid = test_property["id"]
    # Línea A: foto -> editada una vez (cadena de 2)
    a = client.post(f"/api/properties/{pid}/renders",
                    json={"sourceImageId": source_image["id"], "promptText": "A0"}).json()
    a2 = client.post(f"/api/properties/{pid}/renders/{a['id']}/edit",
                     json={"promptText": "A1"}).json()
    # Línea B: desde el plano (cadena de 1)
    b = client.post(f"/api/properties/{pid}/renders/from-plan",
                    files={"file": ("plano.png", io.BytesIO(_png_bytes()), "image/png")},
                    data={"promptText": "B0", "variant": "original",
                          "floorId": "floor-abc-123", "floorName": "Planta Baja"}).json()
    ids = {h["id"] for h in renders_db.list_render_heads(pid)}
    assert ids == {a2["id"], b["id"]}   # las cabezas: la última de A y la de B
    assert a["id"] not in ids           # el paso intermedio queda fuera


def test_input_fidelity_is_not_sent_by_default(monkeypatch):
    """gpt-image-2 rechaza `input_fidelity` con 400. No se manda a menos que
    alguien lo pida explícitamente para un modelo que sí lo acepta."""
    from api import renders

    monkeypatch.delenv("OPENAI_INPUT_FIDELITY", raising=False)
    assert "input_fidelity" not in renders.edit_kwargs()


def test_input_fidelity_is_sent_when_configured(monkeypatch):
    from api import renders

    monkeypatch.setenv("OPENAI_INPUT_FIDELITY", "high")
    assert renders.edit_kwargs()["input_fidelity"] == "high"


# ─── compositing: apagado por default (2026-08-16) ───────────────────────────
# El overlay se construyó contra un modelo que movía muros con una referencia de
# lienzo flojo. Con el encuadre ajustado la IA coloca los muros interiores con
# error medio de 1.9px sobre 1138px (render 42, propiedad 5) — la garantía vale
# ~2px y cuesta el aspecto de todos los renders. Estas pruebas existen para que
# el default no se voltee sin que alguien lo decida.

def test_compositing_is_off_by_default(monkeypatch):
    from api import renders

    monkeypatch.delenv("RENDER_PLAN_COMPOSITE", raising=False)
    assert renders.composite_enabled() is False


def test_compositing_can_be_turned_back_on(monkeypatch):
    from api import renders

    monkeypatch.setenv("RENDER_PLAN_COMPOSITE", "1")
    assert renders.composite_enabled() is True


@pytest.mark.parametrize("value", ["0", "false", "no", "", "cualquier-cosa"])
def test_only_an_explicit_opt_in_turns_compositing_on(monkeypatch, value):
    """Nada de "si la variable existe, enciéndelo": un valor vacío o basura deja
    el default apagado en vez de prender el overlay por accidente."""
    from api import renders

    monkeypatch.setenv("RENDER_PLAN_COMPOSITE", value)
    assert renders.composite_enabled() is False


# La verificación de extremo a extremo (que el camino de plano de verdad no
# compone) vive más abajo, contra el endpoint real:
# `test_no_render_composites_geometry_by_default_not_even_a_plan`.


# ─── _output_size: la razón real del plano, no un cuadrado fijo ──────────────

def test_output_size_matches_the_real_aspect_ratio():
    """599x1105 es la proporción real de la propiedad 5 (5.99m x 11.05m),
    escalada a píxeles de prueba razonables."""
    from api import renders

    real_width, real_height = 599, 1105
    size = renders._output_size(_rect_png_bytes(real_width, real_height))
    out_width, out_height = (int(part) for part in size.split("x"))

    assert out_width % 16 == 0
    assert out_height % 16 == 0
    true_ratio = real_width / real_height
    out_ratio = out_width / out_height
    assert abs(true_ratio - out_ratio) < 0.02


def test_output_size_of_a_square_image_stays_near_the_target_pixel_budget():
    """Task 35 subió `_TARGET_PIXELS` de 1024*1024 a 2560*1440 (~3.69 MP) para
    que un muro interior no viva en unos pocos píxeles — un cuadrado debe
    acercarse a sqrt(2560*1440) ≈ 1920x1920, no al 1024 viejo."""
    from api import renders

    size = renders._output_size(_rect_png_bytes(1000, 1000))
    out_width, out_height = (int(part) for part in size.split("x"))

    assert out_width % 16 == 0
    assert out_height % 16 == 0
    assert abs(out_width - out_height) <= 16          # prácticamente cuadrado
    assert 1856 <= out_width <= 1984                   # cerca de 1920, no lejos


def test_output_size_clamps_extreme_ratios_to_the_api_limit():
    """gpt-image-2 rechaza razones más allá de 1:3 — un plano larguísimo se
    recorta a ese límite, nunca lo excede."""
    from api import renders

    size = renders._output_size(_rect_png_bytes(200, 1200))  # 1:6, muy vertical
    out_width, out_height = (int(part) for part in size.split("x"))
    assert out_width % 16 == 0
    assert out_height % 16 == 0
    assert out_height / out_width <= 3.0 + 1e-9

    size = renders._output_size(_rect_png_bytes(1200, 200))  # 6:1, muy horizontal
    out_width, out_height = (int(part) for part in size.split("x"))
    assert out_width % 16 == 0
    assert out_height % 16 == 0
    assert out_width / out_height <= 3.0 + 1e-9


# ─── Task 37: componer la geometría exacta encima del resultado de la IA ─────
# Diseño validado con un render real (Task 36, propiedad 5, 2026-08-13): el
# eje X de la salida de OpenAI coincide con el de la referencia, pero el eje
# Y se estira ~16% anclado en el mismo borde superior — nunca a coordenadas
# fijas. Ver docs/plans/2026-08-13-fidelidad-geometrica-renders-plano.md.

def _png_with_rect(canvas_size, rect_box, color=(17, 17, 17), bg=(255, 255, 255)):
    """PNG de `bg` con un rectángulo de `color` en `rect_box` (x0,y0,x1,y1) —
    simula una geometría (muro o silueta de mueble) sobre un fondo."""
    img = Image.new("RGB", canvas_size, bg)
    ImageDraw.Draw(img).rectangle(rect_box, fill=color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_content_bbox_of_a_blank_image_is_none():
    from api import renders

    blank = Image.new("RGB", (100, 100), (255, 255, 255))
    assert renders._content_bbox(blank) is None


def test_content_bbox_finds_the_drawn_shape():
    from api import renders

    img = Image.open(io.BytesIO(_png_with_rect((200, 200), (40, 50, 160, 150))))
    # ImageDraw.rectangle dibuja INCLUSIVO en ambos extremos (pixeles 40..160
    # y 50..150) — getbbox() usa la convención de límite superior EXCLUSIVO
    # (uno más allá del último pixel no-blanco), de ahí el +1 en x1/y1.
    assert renders._content_bbox(img) == (40, 50, 161, 151)


def test_composite_geometry_repositions_the_wall_to_match_the_detected_output_bbox():
    """El caso real que motivó la Task 37: si la salida de la IA usa MÁS
    lienzo del que ocupaba el contenido de la referencia, el muro debe
    aparecer estirado/reposicionado para llenar ese mismo espacio relativo
    — nunca quedarse pegado a las coordenadas crudas de la referencia."""
    from api import renders

    # Referencia 150x150: TODO su contenido es un "muro" negro en
    # (50,50)-(100,100) — el resto es fondo blanco. bbox = (50,50,100,100).
    reference = _png_with_rect((150, 150), (50, 50, 100, 100))

    # Salida de la IA 150x150: contenido no-blanco llena el lienzo COMPLETO
    # (bbox = (0,0)-(150,150)) — la IA "usó más lienzo" que la referencia,
    # el mismo patrón medido en el render real de la Task 36.
    output = _png_with_rect((150, 150), (0, 0, 150, 150), color=(230, 210, 190), bg=(230, 210, 190))

    composited = renders._composite_geometry(reference, output)
    result = Image.open(io.BytesIO(composited)).convert("RGB")

    def is_wall(xy):
        r, g, b = result.getpixel(xy)
        return r < 60 and g < 60 and b < 60

    # Si NO se hubiera reposicionado (pegar a coordenadas crudas de la
    # referencia), la esquina del lienzo NUNCA sería pared — el rect
    # original (50,50)-(100,100) no la toca.
    assert is_wall((5, 5)), "la esquina debería quedar cubierta tras el ajuste afín"
    assert is_wall((145, 145))
    assert is_wall((75, 75))   # el centro también sigue siendo pared


def test_composite_geometry_never_forces_furniture_gray_only_true_walls():
    """El gris de silueta de mueble (#555555, luminancia ~85) es solo una
    sugerencia de colocación para la IA — nunca se fuerza, a diferencia del
    muro real (#111111, luminancia ~17)."""
    from api import renders

    ref_img = Image.new("RGB", (100, 100), (255, 255, 255))
    d = ImageDraw.Draw(ref_img)
    d.rectangle((0, 0, 49, 99), fill=(17, 17, 17))     # mitad izquierda: muro real
    d.rectangle((50, 0, 99, 99), fill=(85, 85, 85))    # mitad derecha: silueta de mueble
    buf = io.BytesIO()
    ref_img.save(buf, format="PNG")
    reference = buf.getvalue()

    output = _png_with_rect((100, 100), (0, 0, 100, 100), color=(230, 210, 190), bg=(230, 210, 190))

    composited = renders._composite_geometry(reference, output)
    result = Image.open(io.BytesIO(composited)).convert("RGB")

    left = result.getpixel((10, 50))
    right = result.getpixel((90, 50))
    assert left[0] < 60, "el muro real SÍ debe forzarse opaco"
    assert right == (230, 210, 190), "el gris de mueble NUNCA se fuerza — el color de la IA sobrevive intacto"


def test_composite_geometry_returns_output_unchanged_when_reference_has_no_content():
    """Sin geometría detectable en la referencia no hay nada confiable que
    alinear — mejor no componer que arriesgar una composición mal alineada."""
    from api import renders

    blank_ref = Image.new("RGB", (50, 50), (255, 255, 255))
    buf = io.BytesIO()
    blank_ref.save(buf, format="PNG")
    reference = buf.getvalue()

    output = _png_with_rect((50, 50), (0, 0, 50, 50), color=(10, 20, 30), bg=(10, 20, 30))

    assert renders._composite_geometry(reference, output) == output


def test_no_render_composites_geometry_by_default_not_even_a_plan(
    client, test_property, fake_images_edit, monkeypatch,
):
    """Desde 2026-08-16 el overlay está apagado por default, así que NINGÚN
    camino compone — ni foto ni plano. Antes el plano sí lo hacía; ver
    `composite_enabled` para por qué se apagó (la IA coloca los muros con error
    medio de 1.9px cuando la referencia va bien encuadrada, y el trazo plano
    encima se lee como cinta pegada). Usa `fake_images_edit` (deja correr
    `generate_image` de verdad) con imágenes reales — no el fixture
    `_png_bytes()` de 1x1, que PIL no puede procesar por este camino real
    (mismo problema ya encontrado en otros tests de este archivo)."""
    from api import renders

    monkeypatch.delenv("RENDER_PLAN_COMPOSITE", raising=False)
    calls = []
    monkeypatch.setattr(renders, "_composite_geometry", lambda ref, out: calls.append(True) or out)

    up = client.post(
        f"/api/properties/{test_property['id']}/images",
        files={"file": ("fachada.png", io.BytesIO(_rect_png_bytes(1000, 800)), "image/png")},
        data={"image_type": "antes"},
    )
    assert up.status_code == 201, up.text
    r_photo = client.post(
        f"/api/properties/{test_property['id']}/renders",
        json={"sourceImageId": up.json()["id"], "promptText": "x"},
    )
    assert r_photo.status_code == 201, r_photo.text
    assert len(calls) == 0, "una foto no debe componerse"

    plan = _rect_png_bytes(599, 1105)
    r_plan = client.post(
        f"/api/properties/{test_property['id']}/renders/from-plan",
        files={"file": ("plano.png", io.BytesIO(plan), "image/png")},
        data={"promptText": "Amuebla.", "variant": "original",
              "floorId": "floor-abc-123", "floorName": "Planta Baja"},
    )
    assert r_plan.status_code == 201, r_plan.text
    assert len(calls) == 0, "un plano tampoco se compone con el default de hoy"


def test_a_plan_render_still_composites_when_explicitly_opted_in(
    client, test_property, fake_images_edit, monkeypatch,
):
    """El overlay no se borró, se apagó: con `RENDER_PLAN_COMPOSITE=1` el camino
    de plano vuelve a componer y el de foto sigue sin hacerlo (una foto nunca
    tuvo un "trazo verdadero" que pegar). Sin esta prueba, apagar el default y
    romper el interruptor serían indistinguibles."""
    from api import renders

    monkeypatch.setenv("RENDER_PLAN_COMPOSITE", "1")
    calls = []
    monkeypatch.setattr(renders, "_composite_geometry", lambda ref, out: calls.append(True) or out)

    up = client.post(
        f"/api/properties/{test_property['id']}/images",
        files={"file": ("fachada.png", io.BytesIO(_rect_png_bytes(1000, 800)), "image/png")},
        data={"image_type": "antes"},
    )
    assert up.status_code == 201, up.text
    r_photo = client.post(
        f"/api/properties/{test_property['id']}/renders",
        json={"sourceImageId": up.json()["id"], "promptText": "x"},
    )
    assert r_photo.status_code == 201, r_photo.text
    assert len(calls) == 0, "una foto no se compone ni con el flag encendido"

    r_plan = client.post(
        f"/api/properties/{test_property['id']}/renders/from-plan",
        files={"file": ("plano.png", io.BytesIO(_rect_png_bytes(599, 1105)), "image/png")},
        data={"promptText": "Amuebla.", "variant": "original",
              "floorId": "floor-abc-123", "floorName": "Planta Baja"},
    )
    assert r_plan.status_code == 201, r_plan.text
    assert len(calls) == 1, "con el flag encendido, un plano SÍ se compone"


# ─── Biblioteca de prompts ────────────────────────────────────────────────────

def test_library_ships_with_seeded_defaults(client):
    prompts = client.get("/api/render-prompts").json()
    assert len(prompts) >= 6
    assert all(p["isDefault"] for p in prompts if p["name"] == "Jardín regional (xeriscape)")


def test_seeded_garden_prompt_names_regional_species(client):
    """Un render con pasto inglés vende un jardín que se muere en agosto."""
    garden = next(p for p in client.get("/api/render-prompts").json()
                  if p["name"] == "Jardín regional (xeriscape)")
    assert "mezquite" in garden["body"].lower()


def test_saving_a_new_prompt_adds_it_to_the_library(client):
    r = client.post("/api/render-prompts",
                    json={"name": "Cochera techada", "body": "Cochera con techo ligero."})
    assert r.status_code == 201, r.text
    assert r.json()["isDefault"] is False
    assert any(p["name"] == "Cochera techada" for p in client.get("/api/render-prompts").json())


def test_a_default_prompt_cannot_be_deleted(client):
    """Los sembrados son el piso de la biblioteca: siempre hay de dónde partir."""
    default = next(p for p in client.get("/api/render-prompts").json() if p["isDefault"])
    assert client.delete(f"/api/render-prompts/{default['id']}").status_code == 409


def test_a_saved_prompt_can_be_deleted(client):
    created = client.post("/api/render-prompts",
                          json={"name": "Desechable", "body": "x"}).json()
    assert client.delete(f"/api/render-prompts/{created['id']}").status_code == 204
    assert not any(p["id"] == created["id"] for p in client.get("/api/render-prompts").json())


def test_duplicate_active_prompt_name_is_rejected(client):
    client.post("/api/render-prompts", json={"name": "Repetido", "body": "a"})
    assert client.post("/api/render-prompts",
                       json={"name": "repetido", "body": "b"}).status_code == 409


# ─── kind: la biblioteca de foto y la de plano son distintas (Tarea 22) ───────
#
# Un preset de foto describe un ÁREA (jardín, fachada, alberca...). Un preset
# de plano describe un ESTILO puro, porque un plano no tiene "jardín" que
# renderizar — es la distribución completa vista desde arriba.

_SEEDED_PHOTO_NAMES = (
    "Jardín regional (xeriscape)",
    "Fachada minimalista contemporánea",
    "Patio y terraza de estar",
    "Alberca y asoleadero",
    "Interior renovado (sala y cocina)",
    "Lote limpio (potencial)",
)

_SEEDED_PLAN_NAMES = (
    "Cálido contemporáneo",
    "Minimalista nórdico",
    "Industrial urbano",
    "Colorido y vibrante",
    "Clásico cálido",
)


def test_the_six_original_seeds_are_kind_photo(client):
    prompts = client.get("/api/render-prompts").json()
    for name in _SEEDED_PHOTO_NAMES:
        prompt = next(p for p in prompts if p["name"] == name)
        assert prompt["kind"] == "photo"


def test_the_new_plan_style_presets_are_seeded_as_defaults(client):
    """Los presets de plano son el piso de esa biblioteca, igual que los de
    foto lo son de la suya: mismo patrón, is_default=true."""
    prompts = client.get("/api/render-prompts").json()
    for name in _SEEDED_PLAN_NAMES:
        prompt = next(p for p in prompts if p["name"] == name)
        assert prompt["kind"] == "plan"
        assert prompt["isDefault"] is True


def test_creating_a_prompt_without_kind_defaults_to_photo(client):
    """Compat hacia atrás: cualquier llamador que no sepa de `kind` todavía
    obtiene el comportamiento de siempre."""
    r = client.post("/api/render-prompts",
                    json={"name": "Sin kind explícito", "body": "x"})
    assert r.status_code == 201, r.text
    assert r.json()["kind"] == "photo"


def test_creating_a_prompt_with_kind_plan_persists(client):
    r = client.post("/api/render-prompts",
                    json={"name": "Estilo de prueba", "body": "x", "kind": "plan"})
    assert r.status_code == 201, r.text
    assert r.json()["kind"] == "plan"
    stored = next(p for p in client.get("/api/render-prompts").json()
                  if p["name"] == "Estilo de prueba")
    assert stored["kind"] == "plan"


def test_creating_a_prompt_with_invalid_kind_is_rejected(client):
    """Sin la validación de Pydantic esto llega crudo al INSERT y choca contra
    el CHECK de la 041 como un 500 mudo — el mismo patrón que `variant` ya
    evita unas líneas más abajo en este archivo."""
    r = client.post("/api/render-prompts",
                    json={"name": "Kind inválido", "body": "x", "kind": "banana"})
    assert r.status_code == 422, r.text
    assert not any(p["name"] == "Kind inválido" for p in client.get("/api/render-prompts").json())


def test_listing_prompts_filtered_by_kind(client):
    all_prompts = client.get("/api/render-prompts").json()
    photo_prompts = client.get("/api/render-prompts?kind=photo").json()
    plan_prompts = client.get("/api/render-prompts?kind=plan").json()

    assert all(p["kind"] == "photo" for p in photo_prompts)
    assert all(p["kind"] == "plan" for p in plan_prompts)
    assert len(photo_prompts) + len(plan_prompts) == len(all_prompts)
    assert {p["name"] for p in photo_prompts} >= set(_SEEDED_PHOTO_NAMES)
    assert {p["name"] for p in plan_prompts} >= set(_SEEDED_PLAN_NAMES)


# ─── Generar un render ────────────────────────────────────────────────────────

def test_generating_a_render_stores_it_against_the_property(
        client, test_property, source_image, fake_openai):
    r = client.post(f"/api/properties/{test_property['id']}/renders",
                    json={"sourceImageId": source_image["id"], "promptText": "Jardín de prueba"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["sourceImageId"] == source_image["id"]
    assert body["promptText"] == "Jardín de prueba"
    assert body["provider"] == "openai"
    assert body["filePath"].startswith(f"properties/{test_property['id']}/renders/")


def test_the_structural_clause_is_appended_to_every_prompt(
        client, test_property, source_image, fake_openai):
    """Ningún prompt puede olvidarla: si la olvida, el render es de otra casa."""
    client.post(f"/api/properties/{test_property['id']}/renders",
                json={"sourceImageId": source_image["id"], "promptText": "Jardín de prueba"})
    sent = fake_openai[0]["prompt"]
    assert "Jardín de prueba" in sent
    assert "geometr" in sent.lower()


def test_editing_a_prompt_does_not_rewrite_history(
        client, test_property, source_image, fake_openai):
    """El render de ayer no puede citar el texto de hoy."""
    prompt = client.post("/api/render-prompts",
                         json={"name": "Evolutivo", "body": "Texto original"}).json()
    render = client.post(
        f"/api/properties/{test_property['id']}/renders",
        json={"sourceImageId": source_image["id"], "promptId": prompt["id"],
              "promptText": "Texto original"},
    ).json()

    client.patch(f"/api/render-prompts/{prompt['id']}", json={"body": "Texto cambiado"})

    stored = next(x for x in client.get(f"/api/properties/{test_property['id']}/renders").json()
                  if x["id"] == render["id"])
    assert stored["promptText"] == "Texto original"


def test_deleting_the_source_photo_keeps_the_render(
        client, test_property, source_image, fake_openai):
    """Borrar la foto no destruye el render que ya se enseñó; pierde la liga."""
    render = client.post(
        f"/api/properties/{test_property['id']}/renders",
        json={"sourceImageId": source_image["id"], "promptText": "x"},
    ).json()

    client.delete(f"/api/properties/{test_property['id']}/images/{source_image['id']}")

    stored = client.get(f"/api/properties/{test_property['id']}/renders").json()
    assert [x["id"] for x in stored] == [render["id"]]
    assert stored[0]["sourceImageId"] is None


def test_renders_never_appear_in_the_photo_gallery(
        client, test_property, source_image, fake_openai):
    """Una propuesta no se cuela entre la evidencia."""
    client.post(f"/api/properties/{test_property['id']}/renders",
                json={"sourceImageId": source_image["id"], "promptText": "x"})
    images = client.get(f"/api/properties/{test_property['id']}").json()["images"]
    assert [i["id"] for i in images] == [source_image["id"]]


def test_render_on_a_missing_property_is_404(client, source_image, fake_openai):
    assert client.post("/api/properties/999999999/renders",
                       json={"sourceImageId": source_image["id"],
                             "promptText": "x"}).status_code == 404


def test_render_from_another_propertys_photo_is_rejected(
        client, test_property, source_image, fake_openai):
    """La foto fuente tiene que ser de la propiedad que se está renderizando."""
    other = client.post("/api/properties", json={
        "name": "Otra", "status": "prospecto", "address": "Calle 2", "city": "Monterrey"})
    assert other.status_code == 201, other.text
    r = client.post(f"/api/properties/{other.json()['id']}/renders",
                    json={"sourceImageId": source_image["id"], "promptText": "x"})
    assert r.status_code == 422


def test_empty_prompt_text_is_rejected(client, test_property, source_image, fake_openai):
    assert client.post(f"/api/properties/{test_property['id']}/renders",
                       json={"sourceImageId": source_image["id"],
                             "promptText": "   "}).status_code == 422


def test_deleting_a_render_removes_it(client, test_property, source_image, fake_openai):
    render = client.post(f"/api/properties/{test_property['id']}/renders",
                         json={"sourceImageId": source_image["id"], "promptText": "x"}).json()
    assert client.delete(
        f"/api/properties/{test_property['id']}/renders/{render['id']}").status_code == 204
    assert client.get(f"/api/properties/{test_property['id']}/renders").json() == []


# ─── variant: campo requerido en from-plan (Tarea 14) ─────────────────────────

def test_from_plan_without_variant_is_rejected(client, test_property, fake_openai):
    """`variant` es obligatorio: sin él no sabemos de qué levantamiento nació
    el render, y esa clasificación es la que separa ORIGINAL de PLANEADO."""
    before = client.get(f"/api/properties/{test_property['id']}/renders").json()
    r = client.post(
        f"/api/properties/{test_property['id']}/renders/from-plan",
        files={"file": ("plano.png", io.BytesIO(_png_bytes()), "image/png")},
        data={"promptText": "Amuebla la planta."},
    )
    assert r.status_code == 422
    after = client.get(f"/api/properties/{test_property['id']}/renders").json()
    assert after == before   # no se creó ningún render a medio validar


def _seed_plans(client, property_id, *plan_ids):
    """Persiste un geometry v4 con los planes dados: desde la migración 050 la
    variante de un render ES un plan id, y el servidor valida que exista en el
    geometry vivo — un test que genera un render de plan tiene que sembrar el
    plan primero, igual que la UI real (que siempre genera desde un plan abierto)."""
    fs = {"slab_m": 0.15, "activeFloor": 0,
          "floors": [{"id": "floor-abc-123", "name": "Planta Baja", "height_m": 2.6,
                      "extWall_m": 0.15, "intWall_m": 0.10,
                      "vertices": {}, "edges": {}, "rooms": []}]}
    r = client.put(f"/api/properties/{property_id}/geometry", json={"geometry": {
        "schemaVersion": 4,
        "variants": {"original": fs,
                     "plans": [{"id": pid, "name": f"Plan {pid}", "fs": fs} for pid in plan_ids]},
    }})
    assert r.status_code == 200, r.text


def test_from_plan_with_an_unknown_plan_id_is_rejected(client, test_property, fake_openai):
    # 'remodelado' no es 'original' ni un plan presente en el geometry — 422,
    # aunque OTROS planes sí existan (la membresía es por id exacto).
    _seed_plans(client, test_property["id"], "planned")
    before = client.get(f"/api/properties/{test_property['id']}/renders").json()
    r = client.post(
        f"/api/properties/{test_property['id']}/renders/from-plan",
        files={"file": ("plano.png", io.BytesIO(_png_bytes()), "image/png")},
        data={"promptText": "Amuebla la planta.", "variant": "remodelado"},
    )
    assert r.status_code == 422
    after = client.get(f"/api/properties/{test_property['id']}/renders").json()
    assert after == before


def test_from_plan_with_a_plan_id_absent_from_geometry_is_rejected(
        client, test_property, fake_openai):
    # Sin sembrar NINGÚN plan, hasta el id legado 'planned' es inválido: el
    # servidor valida contra el geometry vivo, no contra un vocabulario fijo.
    r = client.post(
        f"/api/properties/{test_property['id']}/renders/from-plan",
        files={"file": ("plano.png", io.BytesIO(_png_bytes()), "image/png")},
        data={"promptText": "Amuebla la planta.", "variant": "planned",
              "floorId": "floor-abc-123", "floorName": "Planta Baja"},
    )
    assert r.status_code == 422


@pytest.mark.parametrize("variant", ["original", "planned"])
def test_from_plan_persists_the_variant_it_was_given(
        client, test_property, fake_openai, variant):
    _seed_plans(client, test_property["id"], "planned")
    r = client.post(
        f"/api/properties/{test_property['id']}/renders/from-plan",
        files={"file": ("plano.png", io.BytesIO(_png_bytes()), "image/png")},
        data={"promptText": "Amuebla la planta.", "variant": variant,
              "floorId": "floor-abc-123", "floorName": "Planta Baja"},
    )
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["sourceVariant"] == variant
    # Redondea completo: lo que se guardó es lo que se lee de vuelta.
    fetched = client.get(f"/api/properties/{test_property['id']}/renders").json()
    assert next(x for x in fetched if x["id"] == created["id"])["sourceVariant"] == variant


def test_create_render_from_plan_is_not_a_coroutine():
    """El fix del event loop (Tarea 14): `async def` aquí bloqueaba el servidor
    ENTERO ~60s por render, porque la llamada a OpenAI y a storage corrían sin
    `asyncio.to_thread`. Debe ser sync para que FastAPI la corra en su
    threadpool, igual que los otros dos endpoints de generación
    (`create_property_render`, `edit_property_render`)."""
    import inspect
    from api.routes.renders import create_render_from_plan
    assert not inspect.iscoroutinefunction(create_render_from_plan)


# ─── source_variant: de qué levantamiento nació ───────────────────────────────
#
# El endpoint from-plan ya exige y persiste `variant` (arriba). Aquí se sigue
# usando `renders_db.add_render` directo para fijar un padre con un valor
# explícito sin pasar por el flujo completo de generación — por ejemplo, para
# probar la herencia de variante al editar.

def test_a_render_from_a_photo_has_no_source_variant(
        client, test_property, source_image, fake_openai):
    """Vive en FOTOS: no tiene levantamiento del que haber nacido."""
    body = client.post(f"/api/properties/{test_property['id']}/renders",
                       json={"sourceImageId": source_image["id"], "promptText": "x"}).json()
    assert body["sourceVariant"] is None


def test_add_render_persists_an_explicit_source_variant(client, test_property):
    from api import renders_db
    created = renders_db.add_render(
        property_id=test_property["id"], source_image_id=None,
        file_path=f"properties/{test_property['id']}/renders/planned.png",
        content_type="image/png", prompt_id=None, prompt_text="x",
        provider="openai", model="gpt-image-2",
        source_plan_path=f"properties/{test_property['id']}/plan-sources/planned.png",
        source_variant="planned",
    )
    assert created["sourceVariant"] == "planned"
    fetched = renders_db.get_render(test_property["id"], created["id"])
    assert fetched["sourceVariant"] == "planned"


def test_editing_a_photo_render_keeps_source_variant_null(
        client, test_property, source_image, fake_openai):
    parent = client.post(
        f"/api/properties/{test_property['id']}/renders",
        json={"sourceImageId": source_image["id"], "promptText": "x"},
    ).json()
    child = client.post(
        f"/api/properties/{test_property['id']}/renders/{parent['id']}/edit",
        json={"promptText": "y"},
    ).json()
    assert child["sourceVariant"] is None


def test_editing_a_plan_render_inherits_its_source_variant(
        client, test_property, fake_openai):
    """El plano editado sigue perteneciendo al mismo levantamiento (Original o
    Planeado), igual que sigue respetando la cláusula del plano."""
    from api import renders_db
    parent = renders_db.add_render(
        property_id=test_property["id"], source_image_id=None,
        file_path=f"properties/{test_property['id']}/renders/parent.png",
        content_type="image/png", prompt_id=None, prompt_text="Amuebla.",
        provider="openai", model="gpt-image-2",
        source_plan_path=f"properties/{test_property['id']}/plan-sources/parent.png",
        source_variant="planned",
    )
    from api import storage
    storage.upload(parent["filePath"], b"FAKE-PARENT-IMAGE", "image/png")

    child = client.post(
        f"/api/properties/{test_property['id']}/renders/{parent['id']}/edit",
        json={"promptText": "Agrega puerta al baño."},
    ).json()
    assert child["sourceVariant"] == "planned"


def test_render_heads_and_list_surface_source_variant(client, test_property, fake_openai):
    from api import renders_db
    created = renders_db.add_render(
        property_id=test_property["id"], source_image_id=None,
        file_path=f"properties/{test_property['id']}/renders/original.png",
        content_type="image/png", prompt_id=None, prompt_text="x",
        provider="openai", model="gpt-image-2",
        source_plan_path=f"properties/{test_property['id']}/plan-sources/original.png",
        source_variant="original",
    )

    listed = next(r for r in renders_db.list_renders(test_property["id"])
                  if r["id"] == created["id"])
    assert listed["sourceVariant"] == "original"

    heads = next(r for r in renders_db.list_render_heads(test_property["id"])
                 if r["id"] == created["id"])
    assert heads["sourceVariant"] == "original"

    via_http = next(r for r in client.get(f"/api/properties/{test_property['id']}/renders").json()
                    if r["id"] == created["id"])
    assert via_http["sourceVariant"] == "original"


# ─── floor_id/floor_name: de qué piso nació (Tarea 29) ────────────────────────
#
# Un levantamiento puede tener varios pisos (la propiedad 5 ya tiene "Planta
# Baja"/"Planta Alta"). Mismo patrón dual que prompt_id/prompt_text: floor_id
# es la identidad, floor_name es el nombre congelado al momento de generar.
# Ambos requeridos en from-plan (el frontend siempre los manda una vez
# cableado); NULL solo para renders de foto y para renders anteriores a esta
# migración.

def test_from_plan_without_floor_id_is_rejected(client, test_property, fake_openai):
    before = client.get(f"/api/properties/{test_property['id']}/renders").json()
    r = client.post(
        f"/api/properties/{test_property['id']}/renders/from-plan",
        files={"file": ("plano.png", io.BytesIO(_png_bytes()), "image/png")},
        data={"promptText": "Amuebla la planta.", "variant": "original",
              "floorName": "Planta Baja"},
    )
    assert r.status_code == 422
    after = client.get(f"/api/properties/{test_property['id']}/renders").json()
    assert after == before   # no se creó ningún render a medio validar


def test_from_plan_without_floor_name_is_rejected(client, test_property, fake_openai):
    before = client.get(f"/api/properties/{test_property['id']}/renders").json()
    r = client.post(
        f"/api/properties/{test_property['id']}/renders/from-plan",
        files={"file": ("plano.png", io.BytesIO(_png_bytes()), "image/png")},
        data={"promptText": "Amuebla la planta.", "variant": "original",
              "floorId": "floor-abc-123"},
    )
    assert r.status_code == 422
    after = client.get(f"/api/properties/{test_property['id']}/renders").json()
    assert after == before


def test_from_plan_with_blank_floor_id_is_rejected(client, test_property, fake_openai):
    """`Form(...)` solo blinda contra AUSENCIA; un string en blanco llega igual
    de vacío que si nunca se hubiera mandado — mismo patrón que promptText."""
    r = client.post(
        f"/api/properties/{test_property['id']}/renders/from-plan",
        files={"file": ("plano.png", io.BytesIO(_png_bytes()), "image/png")},
        data={"promptText": "Amuebla la planta.", "variant": "original",
              "floorId": "   ", "floorName": "Planta Baja"},
    )
    assert r.status_code == 422


def test_from_plan_with_blank_floor_name_is_rejected(client, test_property, fake_openai):
    r = client.post(
        f"/api/properties/{test_property['id']}/renders/from-plan",
        files={"file": ("plano.png", io.BytesIO(_png_bytes()), "image/png")},
        data={"promptText": "Amuebla la planta.", "variant": "original",
              "floorId": "floor-abc-123", "floorName": "   "},
    )
    assert r.status_code == 422


def test_from_plan_persists_floor_id_and_name(client, test_property, fake_openai):
    r = client.post(
        f"/api/properties/{test_property['id']}/renders/from-plan",
        files={"file": ("plano.png", io.BytesIO(_png_bytes()), "image/png")},
        data={"promptText": "Amuebla la planta.", "variant": "original",
              "floorId": "floor-abc-123", "floorName": "Planta Baja"},
    )
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["floorId"] == "floor-abc-123"
    assert created["floorName"] == "Planta Baja"
    # Redondea completo: lo que se guardó es lo que se lee de vuelta.
    fetched = next(x for x in client.get(f"/api/properties/{test_property['id']}/renders").json()
                   if x["id"] == created["id"])
    assert fetched["floorId"] == "floor-abc-123"
    assert fetched["floorName"] == "Planta Baja"


def test_editing_a_plan_render_inherits_floor_id_and_name(client, test_property, fake_openai):
    """El plano editado sigue perteneciendo al mismo piso, igual que sigue
    respetando la cláusula del plano y la source_variant del padre."""
    parent = client.post(
        f"/api/properties/{test_property['id']}/renders/from-plan",
        files={"file": ("plano.png", io.BytesIO(_png_bytes()), "image/png")},
        data={"promptText": "Amuebla.", "variant": "original",
              "floorId": "floor-abc-123", "floorName": "Planta Baja"},
    ).json()
    child = client.post(
        f"/api/properties/{test_property['id']}/renders/{parent['id']}/edit",
        json={"promptText": "Agrega puerta al baño."},
    ).json()
    assert child["floorId"] == "floor-abc-123"
    assert child["floorName"] == "Planta Baja"


def test_a_render_from_a_photo_has_no_floor_identity(
        client, test_property, source_image, fake_openai):
    """La ruta de foto no toca floor_id/floor_name en absoluto — quedan NULL,
    igual que source_variant en ese mismo camino."""
    body = client.post(f"/api/properties/{test_property['id']}/renders",
                       json={"sourceImageId": source_image["id"], "promptText": "x"}).json()
    assert body["floorId"] is None
    assert body["floorName"] is None


# ─── Elegir el render (Task 2) ─────────────────────────────────────────────────

@pytest.fixture
def make_property(client):
    """Una segunda propiedad para probar que elegir está acotado por propiedad.
    Local a este archivo: la de test_documents.py vive allá con sus propios
    números de underwriting, que aquí no significan nada."""
    from api.db import get_db

    created: list[int] = []

    def _make(**fields) -> dict:
        r = client.post("/api/properties", json={
            "name": "[TEST] Otra Propiedad", "address": "Calle Dos 2", "city": "Monterrey",
            "purchasePrice": 1_000_000, "acquisitionCostPct": 0.0, "permitsCost": 0,
            "subdivisionCost": 0, "sqmLand": 300, "sqmConstruction": 0,
            "holdMonths": 12, "projectedSale": 2_000_000, **fields})
        assert r.status_code == 201, r.text
        created.append(r.json()["id"])
        return r.json()

    yield _make
    with get_db() as conn:
        for property_id in created:
            conn.execute("DELETE FROM budgets WHERE property_id = %s", (property_id,))
            conn.execute("DELETE FROM properties WHERE id = %s", (property_id,))


def test_choose_a_photo_render_marks_it_and_unmarks_siblings(client, test_property, source_image, fake_openai):
    a = client.post(f"/api/properties/{test_property['id']}/renders",
                    json={"sourceImageId": source_image["id"], "promptText": "x"}).json()
    b = client.post(f"/api/properties/{test_property['id']}/renders",
                    json={"sourceImageId": source_image["id"], "promptText": "y"}).json()
    r = client.put(f"/api/properties/{test_property['id']}/renders/{a['id']}/choose")
    assert r.status_code == 200, r.text
    assert r.json()["isChosen"] is True

    r = client.put(f"/api/properties/{test_property['id']}/renders/{b['id']}/choose")
    assert r.status_code == 200, r.text
    assert r.json()["isChosen"] is True
    renders = {r["id"]: r for r in client.get(f"/api/properties/{test_property['id']}/renders").json()}
    assert renders[a["id"]]["isChosen"] is False   # b lo apagó


def test_choosing_one_photo_does_not_touch_another_photos_choice(
        client, test_property, source_image, fake_openai):
    second_photo = client.post(
        f"/api/properties/{test_property['id']}/images",
        files={"file": ("2.jpg", io.BytesIO(_png_bytes()), "image/jpeg")}).json()
    a = client.post(f"/api/properties/{test_property['id']}/renders",
                    json={"sourceImageId": source_image["id"], "promptText": "x"}).json()
    c = client.post(f"/api/properties/{test_property['id']}/renders",
                    json={"sourceImageId": second_photo["id"], "promptText": "z"}).json()
    client.put(f"/api/properties/{test_property['id']}/renders/{a['id']}/choose")
    client.put(f"/api/properties/{test_property['id']}/renders/{c['id']}/choose")
    renders = {r["id"]: r for r in client.get(f"/api/properties/{test_property['id']}/renders").json()}
    assert renders[a["id"]]["isChosen"] is True
    assert renders[c["id"]]["isChosen"] is True


def test_unchoose_removes_the_mark_without_choosing_another(
        client, test_property, source_image, fake_openai):
    a = client.post(f"/api/properties/{test_property['id']}/renders",
                    json={"sourceImageId": source_image["id"], "promptText": "x"}).json()
    client.put(f"/api/properties/{test_property['id']}/renders/{a['id']}/choose")
    r = client.delete(f"/api/properties/{test_property['id']}/renders/{a['id']}/choose")
    assert r.status_code == 200, r.text
    assert r.json()["isChosen"] is False


def test_choosing_a_plan_render_scopes_by_floor_and_variant(client, test_property, fake_openai):
    _seed_plans(client, test_property["id"], "planned")
    a = client.post(
        f"/api/properties/{test_property['id']}/renders/from-plan",
        files={"file": ("plano.png", io.BytesIO(_png_bytes()), "image/png")},
        data={"promptText": "x", "variant": "original", "floorId": "f1", "floorName": "Planta Baja"},
    ).json()
    other_variant = client.post(
        f"/api/properties/{test_property['id']}/renders/from-plan",
        files={"file": ("plano.png", io.BytesIO(_png_bytes()), "image/png")},
        data={"promptText": "y", "variant": "planned", "floorId": "f1", "floorName": "Planta Baja"},
    ).json()
    client.put(f"/api/properties/{test_property['id']}/renders/{a['id']}/choose")
    r = client.put(f"/api/properties/{test_property['id']}/renders/{other_variant['id']}/choose")
    assert r.status_code == 200, r.text
    renders = {r["id"]: r for r in client.get(f"/api/properties/{test_property['id']}/renders").json()}
    assert renders[a["id"]]["isChosen"] is True     # variante distinta: no lo tocó
    assert renders[other_variant["id"]]["isChosen"] is True


def test_choosing_scopes_by_plan_even_when_floors_share_their_id(
        client, test_property, fake_openai):
    """LA colisión que el diseño de múltiples planes resuelve: dos planes
    clonados del mismo original comparten floor ids A PROPÓSITO (linaje del
    Antes/Después). Como la variante ES el plan id, elegir el render de un piso
    en el plan A no desmarca el del MISMO piso en el plan B — el índice único de
    la 046 ya distingue por (property, floor, variante) sin ningún cambio."""
    _seed_plans(client, test_property["id"], "plan-a", "plan-b")
    en_a = client.post(
        f"/api/properties/{test_property['id']}/renders/from-plan",
        files={"file": ("plano.png", io.BytesIO(_png_bytes()), "image/png")},
        data={"promptText": "x", "variant": "plan-a",
              "floorId": "floor-abc-123", "floorName": "Planta Baja"},
    ).json()
    en_b = client.post(
        f"/api/properties/{test_property['id']}/renders/from-plan",
        files={"file": ("plano.png", io.BytesIO(_png_bytes()), "image/png")},
        data={"promptText": "y", "variant": "plan-b",
              "floorId": "floor-abc-123", "floorName": "Planta Baja"},
    ).json()
    assert en_a["sourceVariant"] == "plan-a"
    assert en_b["sourceVariant"] == "plan-b"
    client.put(f"/api/properties/{test_property['id']}/renders/{en_a['id']}/choose")
    r = client.put(f"/api/properties/{test_property['id']}/renders/{en_b['id']}/choose")
    assert r.status_code == 200, r.text
    renders = {r["id"]: r for r in client.get(f"/api/properties/{test_property['id']}/renders").json()}
    assert renders[en_a["id"]]["isChosen"] is True   # otro plan, mismo piso: intacto
    assert renders[en_b["id"]]["isChosen"] is True


def test_choosing_a_render_without_floor_or_photo_is_rejected(client, test_property, fake_openai):
    """Un render huérfano (su foto o su piso se borraron) no pertenece a ningún
    grupo — no hay «los demás» que apagar, así que elegirlo no tiene sentido."""
    from api import renders_db
    render = renders_db.add_render(test_property["id"], None, "x.png", "image/png",
                                   None, "x", "openai", "gpt-image-2")
    r = client.put(f"/api/properties/{test_property['id']}/renders/{render['id']}/choose")
    assert r.status_code == 422


def test_choosing_a_render_from_another_property_404s(client, test_property, make_property,
                                                        source_image, fake_openai):
    other = make_property()
    a = client.post(f"/api/properties/{test_property['id']}/renders",
                    json={"sourceImageId": source_image["id"], "promptText": "x"}).json()
    r = client.put(f"/api/properties/{other['id']}/renders/{a['id']}/choose")
    assert r.status_code == 404


# ─── Editar un render de foto no debe perder la liga a su foto fuente (migración 047) ──

def test_editing_a_photo_render_keeps_its_source_image(client, test_property, source_image, fake_openai):
    a = client.post(f"/api/properties/{test_property['id']}/renders",
                    json={"sourceImageId": source_image["id"], "promptText": "x"}).json()
    assert a["sourceImageId"] == source_image["id"]

    b = client.post(f"/api/properties/{test_property['id']}/renders/{a['id']}/edit",
                    json={"promptText": "más luz natural"}).json()
    assert b["sourceImageId"] == source_image["id"]

    # Y por lo tanto SÍ se puede elegir con estrella — antes del arreglo, un
    # render sin sourceImageId ni floorId no pertenece a ningún grupo (422).
    r = client.put(f"/api/properties/{test_property['id']}/renders/{b['id']}/choose")
    assert r.status_code == 200, r.text
    assert r.json()["isChosen"] is True


def test_a_chain_of_edits_keeps_the_original_source_image(client, test_property, source_image, fake_openai):
    a = client.post(f"/api/properties/{test_property['id']}/renders",
                    json={"sourceImageId": source_image["id"], "promptText": "x"}).json()
    b = client.post(f"/api/properties/{test_property['id']}/renders/{a['id']}/edit",
                    json={"promptText": "y"}).json()
    c = client.post(f"/api/properties/{test_property['id']}/renders/{b['id']}/edit",
                    json={"promptText": "z"}).json()
    assert c["sourceImageId"] == source_image["id"]


# ─── Borrar un plan: cascada deliberada sobre sus renders ────────────────────

def test_deleting_a_plan_cascades_its_renders_and_files(client, test_property, fake_openai):
    from api import storage
    pid = test_property["id"]
    _seed_plans(client, pid, "plan-a", "plan-b")
    en_a = client.post(
        f"/api/properties/{pid}/renders/from-plan",
        files={"file": ("plano.png", io.BytesIO(_png_bytes()), "image/png")},
        data={"promptText": "x", "variant": "plan-a",
              "floorId": "floor-abc-123", "floorName": "Planta Baja"},
    ).json()
    en_b = client.post(
        f"/api/properties/{pid}/renders/from-plan",
        files={"file": ("plano.png", io.BytesIO(_png_bytes()), "image/png")},
        data={"promptText": "y", "variant": "plan-b",
              "floorId": "floor-abc-123", "floorName": "Planta Baja"},
    ).json()

    r = client.delete(f"/api/properties/{pid}/plans/plan-a")
    assert r.status_code == 200, r.text
    assert r.json() == {"deletedRenders": 1}

    # El plan se fue del geometry; el hermano sigue.
    g = client.get(f"/api/properties/{pid}/geometry").json()
    assert [p["id"] for p in g["variants"]["plans"]] == ["plan-b"]
    # Sus renders se fueron de la BD; los del otro plan siguen intactos.
    ids = {x["id"] for x in client.get(f"/api/properties/{pid}/renders").json()}
    assert en_a["id"] not in ids
    assert en_b["id"] in ids
    # Y sus archivos se fueron de storage (render + PNG de referencia del plano).
    with pytest.raises(FileNotFoundError):
        storage.stream(en_a["filePath"])
    with pytest.raises(FileNotFoundError):
        storage.stream(en_a["sourcePlanPath"])
    storage.stream(en_b["filePath"])   # el hermano no perdió nada


def test_deleting_a_missing_plan_is_404_and_touches_nothing(client, test_property, fake_openai):
    pid = test_property["id"]
    _seed_plans(client, pid, "plan-a")
    r = client.delete(f"/api/properties/{pid}/plans/no-existe")
    assert r.status_code == 404
    g = client.get(f"/api/properties/{pid}/geometry").json()
    assert [p["id"] for p in g["variants"]["plans"]] == ["plan-a"]


def test_deleting_a_plan_leaves_photo_and_original_renders_alone(
        client, test_property, source_image, fake_openai):
    pid = test_property["id"]
    _seed_plans(client, pid, "plan-a")
    foto = client.post(f"/api/properties/{pid}/renders",
                       json={"sourceImageId": source_image["id"], "promptText": "x"}).json()
    original = client.post(
        f"/api/properties/{pid}/renders/from-plan",
        files={"file": ("plano.png", io.BytesIO(_png_bytes()), "image/png")},
        data={"promptText": "x", "variant": "original",
              "floorId": "floor-abc-123", "floorName": "Planta Baja"},
    ).json()
    r = client.delete(f"/api/properties/{pid}/plans/plan-a")
    assert r.status_code == 200
    assert r.json() == {"deletedRenders": 0}
    ids = {x["id"] for x in client.get(f"/api/properties/{pid}/renders").json()}
    assert foto["id"] in ids and original["id"] in ids
