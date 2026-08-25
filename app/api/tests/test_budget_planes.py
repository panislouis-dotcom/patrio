"""Presupuesto-escenario por plan de proyecto (addendum 2026-08-24).

La invariante que TODA prueba de aquí defiende: el presupuesto de la propiedad
(plan_id NULL) es la única respuesta viva que alimenta las finanzas; un
escenario jamás mueve un peso de constructionBudgeted/totalInvestment.
"""
import pytest


def _seed_plans(client, property_id, *plan_ids):
    fs = {"slab_m": 0.15, "activeFloor": 0,
          "floors": [{"id": "floor-1", "name": "Planta Baja", "height_m": 2.6,
                      "extWall_m": 0.15, "intWall_m": 0.10,
                      "vertices": {}, "edges": {}, "rooms": []}]}
    r = client.put(f"/api/properties/{property_id}/geometry", json={"geometry": {
        "schemaVersion": 4,
        "variants": {"original": fs,
                     "plans": [{"id": pid, "name": f"Plan {pid}", "fs": fs} for pid in plan_ids]},
    }})
    assert r.status_code == 200, r.text


def _line(client, pid, name, price, plan_id=None, chapter="Obra"):
    qs = f"?planId={plan_id}" if plan_id else ""
    r = client.post(f"/api/properties/{pid}/budget/lines{qs}", json={
        "chapterName": chapter, "name": name, "unit": "lote",
        "quantity": 1, "unitPrice": price,
    })
    assert r.status_code == 201, r.text
    return r.json()


def _budget(client, pid, plan_id=None):
    qs = f"?planId={plan_id}" if plan_id else ""
    r = client.get(f"/api/properties/{pid}/budget{qs}")
    return r


def test_el_escenario_nace_copiado_del_de_la_propiedad(client, test_property):
    pid = test_property["id"]
    _seed_plans(client, pid, "plan-a")
    _line(client, pid, "Albañilería", 100_000)

    r = client.post(f"/api/properties/{pid}/budget/plans/plan-a")
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["linesAdded"] == 1        # el renglón detallado viajó
    assert body["budget"]["planId"] == "plan-a"
    names = [ln["name"] for ln in body["budget"]["lines"]]
    assert "Albañilería" in names
    # Mismo total que el de la propiedad al nacer: el residuo absorbió el resto.
    prop_total = sum(ln["quantity"] * ln["unitPrice"] for ln in _budget(client, pid).json()["lines"])
    plan_total = sum(ln["quantity"] * ln["unitPrice"] for ln in body["budget"]["lines"])
    assert plan_total == prop_total


def test_el_escenario_puede_nacer_vacio(client, test_property):
    pid = test_property["id"]
    _seed_plans(client, pid, "plan-a")
    r = client.post(f"/api/properties/{pid}/budget/plans/plan-a",
                    json={"copyFromProperty": False})
    assert r.status_code == 201, r.text
    lines = r.json()["budget"]["lines"]
    assert len(lines) == 1 and lines[0]["isResidual"]     # solo el residuo, en 0
    assert lines[0]["quantity"] * lines[0]["unitPrice"] == 0


def test_nacimientos_invalidos(client, test_property):
    pid = test_property["id"]
    _seed_plans(client, pid, "plan-a")
    assert client.post(f"/api/properties/{pid}/budget/plans/no-existe").status_code == 404
    assert client.post(f"/api/properties/{pid}/budget/plans/plan-a").status_code == 201
    # Repetir el nacimiento: rechazado, no duplicado.
    assert client.post(f"/api/properties/{pid}/budget/plans/plan-a").status_code in (409, 422)


def test_leer_un_escenario_que_no_existe_es_404_nunca_autocrea(client, test_property):
    pid = test_property["id"]
    _seed_plans(client, pid, "plan-a")
    assert _budget(client, pid, "plan-a").status_code == 404
    # Y seguir sin existir: leerlo no lo sembró.
    assert _budget(client, pid, "plan-a").status_code == 404


def test_un_escenario_jamas_mueve_las_finanzas_de_la_propiedad(client, test_property):
    pid = test_property["id"]
    _seed_plans(client, pid, "plan-a")
    before = client.get(f"/api/properties/{pid}").json()

    client.post(f"/api/properties/{pid}/budget/plans/plan-a",
                json={"copyFromProperty": False})
    _line(client, pid, "Torre de oro", 99_000_000, plan_id="plan-a")

    after = client.get(f"/api/properties/{pid}").json()
    # Las cifras de obra y la inversión: intactas al peso.
    for key in ("constructionBudgeted", "totalInvestment", "projectedRoi"):
        assert after.get(key) == before.get(key), key
    # Y el renglón vive SOLO en el escenario.
    prop_names = [ln["name"] for ln in _budget(client, pid).json()["lines"]]
    assert "Torre de oro" not in prop_names


def test_usar_el_plan_copia_al_de_la_propiedad_sin_pisar_lo_capturado(client, test_property):
    pid = test_property["id"]
    _seed_plans(client, pid, "plan-a")
    _line(client, pid, "Albañilería", 100_000)     # ya capturado en la propiedad
    client.post(f"/api/properties/{pid}/budget/plans/plan-a")   # nace copiado (trae Albañilería)
    _line(client, pid, "Cancelería", 50_000, plan_id="plan-a")  # detalle nuevo del escenario

    r = client.post(f"/api/properties/{pid}/budget/plans/plan-a/use")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["linesAdded"] == 1      # Cancelería entró
    assert body["linesSkipped"] == 1    # Albañilería ya estaba: se saltó, no se pisó
    prop_names = [ln["name"] for ln in _budget(client, pid).json()["lines"]]
    assert "Cancelería" in prop_names
    # El escenario queda intacto — es la propuesta.
    plan_names = [ln["name"] for ln in _budget(client, pid, "plan-a").json()["lines"]]
    assert "Cancelería" in plan_names


def test_borrar_el_plan_cascadea_su_presupuesto(client, test_property):
    pid = test_property["id"]
    _seed_plans(client, pid, "plan-a", "plan-b")
    client.post(f"/api/properties/{pid}/budget/plans/plan-a")
    client.post(f"/api/properties/{pid}/budget/plans/plan-b")

    assert client.delete(f"/api/properties/{pid}/plans/plan-a").status_code == 200
    assert _budget(client, pid, "plan-a").status_code == 404   # el escenario cayó con él
    assert _budget(client, pid, "plan-b").status_code == 200   # el hermano sigue
    assert _budget(client, pid).status_code == 200             # el de la propiedad ni se inmuta


def test_las_fuentes_listan_los_escenarios_de_la_misma_obra_etiquetados(client, test_property):
    """El cambio que pidió Eduardo (2026-08-24): la lista es de PRESUPUESTOS —
    el menú de una obra ofrece sus propios escenarios (imposible cuando se
    excluía la propiedad entera), etiquetados con el nombre VIVO de su plan."""
    pid = test_property["id"]
    _seed_plans(client, pid, "plan-a")
    _line(client, pid, "Albañilería", 100_000)
    client.post(f"/api/properties/{pid}/budget/plans/plan-a")   # nace copiado
    prop_budget_id = _budget(client, pid).json()["id"]

    sources = client.get("/api/budget/sources",
                         params={"excludeBudgetId": prop_budget_id}).json()
    mine = [s for s in sources if s["propertyId"] == pid]
    # El escenario aparece (el de la propiedad quedó excluido por SU id):
    assert len(mine) == 1
    assert mine[0]["planId"] == "plan-a"
    assert mine[0]["planName"] == "Plan plan-a"     # el nombre vivo del geometry
    assert mine[0]["lineCount"] == 1                 # lo copiable, sin residuo
    assert mine[0]["fullTotal"] is not None          # el objetivo para proporcional


def test_include_empty_lista_destinos_sin_nada_copiable(client, test_property):
    pid = test_property["id"]
    _seed_plans(client, pid, "plan-a")
    client.post(f"/api/properties/{pid}/budget/plans/plan-a",
                json={"copyFromProperty": False})   # escenario vacío
    sin_flag = client.get("/api/budget/sources").json()
    con_flag = client.get("/api/budget/sources", params={"includeEmpty": True}).json()
    vacio = [s for s in con_flag if s["propertyId"] == pid and s["planId"] == "plan-a"]
    assert vacio and vacio[0]["lineCount"] == 0
    assert not any(s["propertyId"] == pid and s.get("planId") == "plan-a" for s in sin_flag)


def test_apply_puede_escribir_en_un_escenario_como_destino(client, test_property):
    pid = test_property["id"]
    _seed_plans(client, pid, "plan-a")
    _line(client, pid, "Albañilería", 100_000)      # detalle en la propiedad
    client.post(f"/api/properties/{pid}/budget/plans/plan-a",
                json={"copyFromProperty": False})   # escenario vacío
    prop_budget_id = _budget(client, pid).json()["id"]

    r = client.post(f"/api/properties/{pid}/budget/apply?planId=plan-a",
                    json={"budgetId": prop_budget_id})
    assert r.status_code == 201, r.text
    assert r.json()["linesAdded"] == 1
    plan_names = [ln["name"] for ln in _budget(client, pid, "plan-a").json()["lines"]]
    assert "Albañilería" in plan_names
    # La propiedad no recibió nada de vuelta: el destino era el escenario.
    assert r.json()["budget"]["planId"] == "plan-a"
