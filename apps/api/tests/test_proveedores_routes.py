"""Integration tests for proveedores routes."""
from api.db import get_db


def test_list_categories_empty(client):
    r = client.get("/api/proveedor-categories")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_category_crud(client):
    r = client.post("/api/proveedor-categories", json={"name": "[TEST] Cat", "description": "test"})
    assert r.status_code == 201
    cat = r.json()
    assert cat["name"] == "[TEST] Cat"
    r2 = client.patch(f"/api/proveedor-categories/{cat['id']}", json={"name": "[TEST] Cat Updated"})
    assert r2.status_code == 200
    assert r2.json()["name"] == "[TEST] Cat Updated"
    r3 = client.delete(f"/api/proveedor-categories/{cat['id']}")
    assert r3.status_code == 204


def test_category_404(client):
    assert client.get("/api/proveedor-categories").status_code == 200  # list always 200
    assert client.patch("/api/proveedor-categories/99999", json={"name": "X"}).status_code == 404
    assert client.delete("/api/proveedor-categories/99999").status_code == 404


def test_proveedor_crud(client):
    r = client.post("/api/proveedores", json={"name": "[TEST] Prov", "status": "activo"})
    assert r.status_code == 201
    p = r.json()
    assert "categories" in p
    assert isinstance(p["categories"], list)
    r2 = client.patch(f"/api/proveedores/{p['id']}", json={"zona": "Centro"})
    assert r2.status_code == 200
    assert r2.json()["zona"] == "Centro"
    r3 = client.delete(f"/api/proveedores/{p['id']}")
    assert r3.status_code == 204
    assert client.get(f"/api/proveedores/{p['id']}").status_code == 404


def test_veto_requires_reason(client):
    r = client.post("/api/proveedores", json={"name": "[TEST] VetoTest", "status": "activo"})
    p = r.json()
    r2 = client.patch(f"/api/proveedores/{p['id']}", json={"status": "vetado"})
    assert r2.status_code == 422
    with get_db() as conn:
        conn.execute("DELETE FROM proveedores WHERE id = %s", (p["id"],))


def test_missing_proveedor_returns_404(client):
    assert client.get("/api/proveedores/99999999").status_code == 404
    assert client.patch("/api/proveedores/99999999", json={"zona": "X"}).status_code == 404
    assert client.delete("/api/proveedores/99999999").status_code == 404


def test_set_categories(client):
    cat = client.post("/api/proveedor-categories", json={"name": "[TEST] SetCat"}).json()
    prov = client.post("/api/proveedores", json={"name": "[TEST] SetCatProv"}).json()
    r = client.put(f"/api/proveedores/{prov['id']}/categories", json={"categoryIds": [cat["id"]]})
    assert r.status_code == 200
    assert any(c["id"] == cat["id"] for c in r.json()["categories"])
    # Cleanup
    with get_db() as conn:
        conn.execute("DELETE FROM proveedores WHERE id = %s", (prov["id"],))
        conn.execute("DELETE FROM proveedor_categories WHERE id = %s", (cat["id"],))
