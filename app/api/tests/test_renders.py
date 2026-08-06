"""Renders: la biblioteca de prompts y la propuesta que no se disfraza de foto."""
import io

import pytest


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
        data={"promptText": "Amuebla la planta: sala amplia, cocina integral."},
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
        data={"promptText": "Amuebla la planta."},
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
        data={"promptText": "Amuebla la planta."},
    )
    # No hay endpoint propio para listar fotos: `images` vive embebido en la
    # propiedad, igual que en cualquier otro lector (properties_db.parse_property).
    assert client.get(f"/api/properties/{test_property['id']}").json()["images"] == []


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
