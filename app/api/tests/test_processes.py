"""Integration tests for /api/process/templates and nodes routes."""
import io

import pytest
from PIL import Image

from api import storage
from api.db import get_db


@pytest.fixture
def test_process_template(client):
    r = client.post("/api/process/templates", json={"name": "[TEST] Template"})
    assert r.status_code == 201
    tmpl = r.json()
    yield tmpl
    with get_db() as conn:
        conn.execute("DELETE FROM process_templates WHERE id = %s", (tmpl["id"],))


@pytest.fixture
def test_process_node(client, test_process_template):
    r = client.post(
        f"/api/process/templates/{test_process_template['id']}/nodes",
        json={"name": "[TEST] Node", "sortOrder": 0},
    )
    assert r.status_code == 201
    node = r.json()
    yield node
    with get_db() as conn:
        conn.execute("DELETE FROM template_nodes WHERE id = %s", (node["id"],))


@pytest.fixture
def test_process_instance(client, test_process_template):
    r = client.post("/api/process/instances", json={
        "name": "[TEST] Instance", "startDate": "2026-01-01",
        "templateId": test_process_template["id"],
    })
    assert r.status_code == 201
    instance = r.json()
    yield instance
    with get_db() as conn:
        conn.execute("DELETE FROM process_instances WHERE id = %s", (instance["id"],))


def _rotated_jpeg() -> bytes:
    """Lo que sale de un teléfono: los píxeles de lado y la rotación sólo en EXIF."""
    exif = Image.Exif()
    exif[0x0112] = 6  # rotación de 90°: el alto y el ancho salen intercambiados
    buf = io.BytesIO()
    Image.new("RGB", (20, 40), (200, 30, 30)).save(buf, format="JPEG", exif=exif)
    return buf.getvalue()


def test_list_templates_empty(client):
    r = client.get("/api/process/templates")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_create_template(client, test_process_template):
    assert "id" in test_process_template
    assert test_process_template["name"] == "[TEST] Template"


def test_patch_template(client, test_process_template):
    r = client.patch(
        f"/api/process/templates/{test_process_template['id']}",
        json={"name": "[TEST] Updated Template"},
    )
    assert r.status_code == 200
    assert r.json()["name"] == "[TEST] Updated Template"


def test_delete_template(client, test_process_template):
    r = client.delete(f"/api/process/templates/{test_process_template['id']}")
    assert r.status_code == 204
    # fixture teardown is a no-op


def test_delete_nonexistent_404(client):
    r = client.delete("/api/process/templates/999999")
    assert r.status_code == 404


def test_get_nodes_empty(client, test_process_template):
    r = client.get(f"/api/process/templates/{test_process_template['id']}/nodes")
    assert r.status_code == 200
    assert r.json() == []


def test_create_node(client, test_process_node):
    assert "id" in test_process_node
    assert test_process_node["name"] == "[TEST] Node"


def test_patch_node(client, test_process_node):
    r = client.patch(
        f"/api/process/nodes/{test_process_node['id']}",
        json={"name": "[TEST] Updated Node"},
    )
    assert r.status_code == 200
    assert r.json()["name"] == "[TEST] Updated Node"


def test_delete_node(client, test_process_node):
    r = client.delete(f"/api/process/nodes/{test_process_node['id']}")
    assert r.status_code == 204
    # fixture teardown is a no-op


def test_requires_auth(client, anonymous):
    r = client.get("/api/process/templates")
    assert r.status_code == 401


def test_node_file_upload_bakes_the_exif_rotation(client, test_process_node):
    """La evidencia de un paso suele ser la foto del trabajo hecho, tomada con el
    teléfono: si se guarda con la rotación sólo en el tag, sale de lado."""
    r = client.post(f"/api/process/nodes/{test_process_node['id']}/files",
                    files={"file": ("phone.jpg", io.BytesIO(_rotated_jpeg()), "image/jpeg")})
    assert r.status_code == 201, r.text
    try:
        stored = Image.open(io.BytesIO(storage.stream(r.json()["filePath"])[0]))
        assert stored.size == (40, 20)
        assert stored.getexif().get(0x0112, 1) == 1
    finally:
        client.delete(f"/api/process/files/{r.json()['id']}")


def test_instance_file_upload_bakes_the_exif_rotation(client, test_process_instance):
    r = client.post(f"/api/process/instances/{test_process_instance['id']}/files",
                    files={"file": ("phone.jpg", io.BytesIO(_rotated_jpeg()), "image/jpeg")})
    assert r.status_code == 201, r.text
    try:
        stored = Image.open(io.BytesIO(storage.stream(r.json()["filePath"])[0]))
        assert stored.size == (40, 20)
        assert stored.getexif().get(0x0112, 1) == 1
    finally:
        client.delete(f"/api/process/instance-files/{r.json()['id']}")


def test_non_image_evidence_is_stored_byte_for_byte(client, test_process_node):
    """Estas rutas aceptan cualquier archivo — una factura pagada, un PDF. Pasar
    por el normalizador no puede tocarles un byte."""
    content = b"%PDF-1.4\nfake invoice\n%%EOF\n"
    r = client.post(f"/api/process/nodes/{test_process_node['id']}/files",
                    files={"file": ("factura.pdf", io.BytesIO(content), "application/pdf")})
    assert r.status_code == 201, r.text
    try:
        assert storage.stream(r.json()["filePath"])[0] == content
    finally:
        client.delete(f"/api/process/files/{r.json()['id']}")


def test_cycle_detection(client):
    """Adding a node whose sourceTemplateId creates a cycle should return 400."""
    r_a = client.post("/api/process/templates", json={"name": "[TEST] Template A (cycle)"})
    r_b = client.post("/api/process/templates", json={"name": "[TEST] Template B (cycle)"})
    assert r_a.status_code == 201
    assert r_b.status_code == 201
    tid_a, tid_b = r_a.json()["id"], r_b.json()["id"]

    try:
        # A references B — OK
        r1 = client.post(f"/api/process/templates/{tid_a}/nodes", json={
            "name": "A→B", "sortOrder": 0, "sourceTemplateId": tid_b,
        })
        assert r1.status_code == 201, f"Expected 201, got {r1.status_code}: {r1.text}"

        # B tries to reference A — cycle, must be 400
        r2 = client.post(f"/api/process/templates/{tid_b}/nodes", json={
            "name": "B→A", "sortOrder": 0, "sourceTemplateId": tid_a,
        })
        assert r2.status_code == 400, f"Expected 400 (cycle), got {r2.status_code}: {r2.text}"
    finally:
        with get_db() as conn:
            conn.execute("DELETE FROM template_nodes WHERE template_id IN (%s, %s)", (tid_a, tid_b))
            conn.execute("DELETE FROM process_templates WHERE id IN (%s, %s)", (tid_a, tid_b))
