"""Renders: la biblioteca de prompts y la propuesta que no se disfraza de foto."""
import io

import pytest
from PIL import Image

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

    def _fake(image_bytes: bytes, content_type: str, prompt: str):
        calls.append({"image": image_bytes, "content_type": content_type, "prompt": prompt})
        return b"RENDERED-BYTES", "image/png"

    monkeypatch.setattr(renders, "generate_image", _fake)
    return calls


@pytest.fixture
def source_image(client, test_property):
    r = client.post(
        f"/api/properties/{test_property['id']}/images",
        files={"file": ("fachada.png", io.BytesIO(_png_bytes()), "image/png")},
        data={"image_type": "antes"},
    )
    assert r.status_code == 201, r.text
    return r.json()


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
              "variant": "original"},
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
        data={"promptText": "Amuebla la planta.", "variant": "original"},
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
        data={"promptText": "Amuebla la planta.", "variant": "original"},
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
        data={"promptText": "Amuebla la planta.", "variant": "original"},
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
    """Editar avanza sobre la MISMA imagen: la fuente es el render padre (no una
    foto), y el hijo cuelga de él para poder caminar el historial."""
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
    assert child["parentRenderId"] == parent["id"]   # cuelga del padre
    assert child["sourceImageId"] is None            # su fuente es el render, no una foto
    # Editó ENCIMA de la imagen del padre: esos bytes fueron los que se mandaron.
    assert fake_openai[-1]["image"] == b"RENDERED-BYTES"


def test_editing_a_plan_render_keeps_the_plan_clause(
    client, test_property, fake_openai,
):
    parent = client.post(
        f"/api/properties/{test_property['id']}/renders/from-plan",
        files={"file": ("plano.png", io.BytesIO(_png_bytes()), "image/png")},
        data={"promptText": "Amuebla.", "variant": "original"},
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
                    data={"promptText": "B0", "variant": "original"}).json()
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


def test_from_plan_with_an_invalid_variant_is_rejected(client, test_property, fake_openai):
    before = client.get(f"/api/properties/{test_property['id']}/renders").json()
    r = client.post(
        f"/api/properties/{test_property['id']}/renders/from-plan",
        files={"file": ("plano.png", io.BytesIO(_png_bytes()), "image/png")},
        data={"promptText": "Amuebla la planta.", "variant": "remodelado"},
    )
    assert r.status_code == 422
    after = client.get(f"/api/properties/{test_property['id']}/renders").json()
    assert after == before


@pytest.mark.parametrize("variant", ["original", "planned"])
def test_from_plan_persists_the_variant_it_was_given(
        client, test_property, fake_openai, variant):
    r = client.post(
        f"/api/properties/{test_property['id']}/renders/from-plan",
        files={"file": ("plano.png", io.BytesIO(_png_bytes()), "image/png")},
        data={"promptText": "Amuebla la planta.", "variant": variant},
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
