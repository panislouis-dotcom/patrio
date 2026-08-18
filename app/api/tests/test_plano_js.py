import asyncio
import re
import pytest
from api.lib import plano_js


def _rect(w, h, fid=None):
    pts = [(0, 0), (w, 0), (w, h), (0, h)]
    V = {f"v{i}": {"id": f"v{i}", "x": x, "y": y} for i, (x, y) in enumerate(pts)}
    ids = list(V)
    E = {f"e{i}": {"id": f"e{i}", "v1": ids[i], "v2": ids[(i + 1) % 4],
                   "thickness": 0.15, "openings": []} for i in range(4)}
    f = {"name": "Planta Baja", "height_m": 2.6, "extWall_m": 0.15, "intWall_m": 0.10,
         "vertices": V, "edges": E, "rooms": [{"name": "Recámara", "cx": w / 2, "cy": h / 2}],
         "fixtures": [], "manualDimensions": []}
    if fid is not None:
        f["id"] = fid
    return f


V2_SIN_IDS = {"schemaVersion": 2, "slab_m": 0.15, "activeFloor": 0, "floors": [_rect(4.2, 3.1)]}
V3 = {"schemaVersion": 3, "variants": {
    "original": {"slab_m": 0.15, "activeFloor": 0, "floors": [_rect(4.2, 3.1, "abc")]},
    "planned": {"slab_m": 0.15, "activeFloor": 0, "floors": [_rect(5.0, 3.1, "abc")]}}}

pytestmark = pytest.mark.skipif(
    not plano_js._BUNDLE.exists(), reason="corre `make build-plano` primero")


def test_dibuja_un_blob_v2_sin_ids_de_piso():
    """El caso que revienta si la página anfitriona no es contexto seguro:
    migrateGeometry rellena ids con crypto.randomUUID(), que no existe en
    about:blank ni con set_content."""
    out = asyncio.run(plano_js.render_plan_sheets({7: V2_SIN_IDS}))
    assert len(out[7]) == 1
    assert out[7][0]["variant"] == "original"
    assert out[7][0]["floorId"]
    assert "m²" in out[7][0]["svg"]


def test_las_dos_variantes_comparten_floor_id_y_escala():
    sheets = asyncio.run(plano_js.render_plan_sheets({7: V3}))[7]
    assert [s["variant"] for s in sheets] == ["original", "planned"]
    assert sheets[0]["floorId"] == sheets[1]["floorId"] == "abc"
    grosor = lambda s: float(re.search(r'<line[^>]*stroke-width="([\d.]+)"', s).group(1))
    assert grosor(sheets[1]["svg"]) == pytest.approx(grosor(sheets[0]["svg"]))


def test_varias_propiedades_en_un_solo_chromium():
    out = asyncio.run(plano_js.render_plan_sheets({7: V2_SIN_IDS, 9: V3, 11: {}}))
    assert len(out[7]) == 1 and len(out[9]) == 2 and out[11] == []


def test_sin_geometrias_no_lanza_navegador():
    assert asyncio.run(plano_js.render_plan_sheets({})) == {}


def test_bundle_ausente_degrada_a_vacio_y_avisa(monkeypatch, caplog):
    """Un PDF no se muere porque un plano no dibujó — misma degradación que un
    fetch de imagen fallido en documents.py:44."""
    monkeypatch.setattr(plano_js, "_BUNDLE", plano_js._BUNDLE.with_name("no-existe.js"))
    with caplog.at_level("WARNING"):
        assert asyncio.run(plano_js.render_plan_sheets({7: V2_SIN_IDS})) == {}
    assert "make build-plano" in caplog.text
