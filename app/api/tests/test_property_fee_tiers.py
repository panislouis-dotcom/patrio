"""saleFeeTiers/rentFeeTiers en el payload de propiedad, y replace_fee_tiers()
— el reemplazo atómico de una escalera completa (Task 3/8, ver
docs/plans/2026-08-19-comisiones-de-inversion-design.md).

select_tier()/validate_tiers() ya están probados a fondo en
test_finance_fees.py; aquí solo se prueba la capa de properties_db.py: que
get_property()/get_properties() lean la tabla satélite property_fee_tiers en
el mismo batched fetch que ya usan las imágenes, y que replace_fee_tiers()
persista correctamente (incluido reemplazar, no solo insertar)."""
from decimal import Decimal

import pytest

from api import properties_db
from api.db import get_db
from api.properties_db import PropertyError, PropertyNotFound

# Misma escalera de ejemplo del feature — Salón Escobedo, venta ≥$6.5M→7%,
# ≥$5.5M→6%, si no→5%. A propósito NO en orden ascendente: replace_fee_tiers
# debe ordenar por su cuenta, no confiar en el orden que mandó el cliente.
ESCOBECO_VENTA = [
    {"threshold": Decimal("6500000"), "rate": Decimal("0.07")},
    {"threshold": None, "rate": Decimal("0.05")},
    {"threshold": Decimal("5500000"), "rate": Decimal("0.06")},
]


# ── Lectura: saleFeeTiers/rentFeeTiers en cada propiedad ────────────────────

def test_una_propiedad_sin_escalera_trae_arrays_vacios(client, test_property):
    p = properties_db.get_property(test_property["id"])
    assert p["saleFeeTiers"] == []
    assert p["rentFeeTiers"] == []


def test_get_properties_trae_saleFeeTiers_y_rentFeeTiers_en_cada_fila(client, test_property):
    """El listado pasa por el mismo `_fetch()` que get_property(): confirma que
    no hay una segunda ruta de lectura desincronizada de la primera."""
    props = properties_db.get_properties(include_archived=True)
    target = next(p for p in props if p["id"] == test_property["id"])
    assert target["saleFeeTiers"] == []
    assert target["rentFeeTiers"] == []


def test_tramos_sembrados_a_mano_salen_ordenados_ascendente_con_el_piso_al_final(
        client, test_property):
    """Filas insertadas directamente (no vía replace_fee_tiers) en un orden que
    no es el de lectura — el batched fetch debe ordenar por threshold, no
    confiar en sort_order de captura."""
    pid = test_property["id"]
    with get_db() as conn:
        conn.execute(
            "INSERT INTO property_fee_tiers (property_id, kind, threshold, rate, sort_order)"
            " VALUES (%s, 'venta', NULL, %s, 0)",
            (pid, Decimal("0.05")),
        )
        conn.execute(
            "INSERT INTO property_fee_tiers (property_id, kind, threshold, rate, sort_order)"
            " VALUES (%s, 'venta', %s, %s, 1)",
            (pid, Decimal("6500000"), Decimal("0.07")),
        )
        conn.execute(
            "INSERT INTO property_fee_tiers (property_id, kind, threshold, rate, sort_order)"
            " VALUES (%s, 'venta', %s, %s, 2)",
            (pid, Decimal("5500000"), Decimal("0.06")),
        )

    p = properties_db.get_property(pid)
    assert p["saleFeeTiers"] == [
        {"threshold": Decimal("5500000"), "rate": Decimal("0.06")},
        {"threshold": Decimal("6500000"), "rate": Decimal("0.07")},
        {"threshold": None, "rate": Decimal("0.05")},
    ]
    assert p["rentFeeTiers"] == []  # kind='renta' no tiene filas: sigue vacío


def test_escalera_de_venta_configurada_mueve_exitFeeVenta_en_el_payload(client, test_property):
    """Prueba de wiring, no de select_tier(): confirma que parse_property()
    de verdad conecta la escalera leída con fees.compute_fees(), no solo con
    el campo saleFeeTiers/rentFeeTiers del payload."""
    pid = test_property["id"]
    client.patch(f"/api/properties/{pid}", json={"projectedSale": 6_500_000})
    properties_db.replace_fee_tiers(pid, "venta", ESCOBECO_VENTA)

    p = properties_db.get_property(pid)
    # 6,500,000 cae justo en el umbral superior (≥ inclusivo) → 7%, no el 5% default
    assert Decimal(str(p["exitFeeVenta"])) == Decimal("6500000") * Decimal("0.07")


# ── replace_fee_tiers() ──────────────────────────────────────────────────────

def test_replace_fee_tiers_persiste_ordenado_con_el_piso_al_final(client, test_property):
    pid = test_property["id"]
    stored = properties_db.replace_fee_tiers(pid, "venta", ESCOBECO_VENTA)
    expected = [
        {"threshold": Decimal("5500000"), "rate": Decimal("0.06")},
        {"threshold": Decimal("6500000"), "rate": Decimal("0.07")},
        {"threshold": None, "rate": Decimal("0.05")},
    ]
    assert stored == expected
    assert properties_db.get_property(pid)["saleFeeTiers"] == expected


def test_replace_fee_tiers_segunda_llamada_reemplaza_entera_la_primera(client, test_property):
    """No es un insert acumulativo: la segunda escalera debe dejar la tabla
    exactamente como la segunda llamada la pidió, sin rastro de la primera."""
    pid = test_property["id"]
    properties_db.replace_fee_tiers(pid, "venta", ESCOBECO_VENTA)

    segunda = [
        {"threshold": Decimal("4000000"), "rate": Decimal("0.03")},
        {"threshold": None, "rate": Decimal("0.02")},
    ]
    stored = properties_db.replace_fee_tiers(pid, "venta", segunda)
    assert stored == segunda

    p = properties_db.get_property(pid)
    assert p["saleFeeTiers"] == segunda
    assert Decimal("6500000") not in [t["threshold"] for t in p["saleFeeTiers"]]
    assert Decimal("5500000") not in [t["threshold"] for t in p["saleFeeTiers"]]

    with get_db() as conn:
        count = conn.execute(
            "SELECT COUNT(*) AS n FROM property_fee_tiers WHERE property_id = %s AND kind = 'venta'",
            (pid,),
        ).fetchone()["n"]
    assert count == 2  # nada de la primera escalera (3 tramos) sobrevive


def test_replace_fee_tiers_venta_y_renta_son_lados_independientes(client, test_property):
    pid = test_property["id"]
    properties_db.replace_fee_tiers(pid, "venta", ESCOBECO_VENTA)
    properties_db.replace_fee_tiers(
        pid, "renta", [{"threshold": None, "rate": Decimal("0.08")}])

    p = properties_db.get_property(pid)
    assert len(p["saleFeeTiers"]) == 3
    assert p["rentFeeTiers"] == [{"threshold": None, "rate": Decimal("0.08")}]

    # Reemplazar el lado de venta no toca el de renta.
    properties_db.replace_fee_tiers(
        pid, "venta", [{"threshold": None, "rate": Decimal("0.04")}])
    p = properties_db.get_property(pid)
    assert p["saleFeeTiers"] == [{"threshold": None, "rate": Decimal("0.04")}]
    assert p["rentFeeTiers"] == [{"threshold": None, "rate": Decimal("0.08")}]


def test_replace_fee_tiers_lista_vacia_borra_la_escalera_existente(client, test_property):
    """Lista vacía es válida (validate_tiers) y significa «sin escalera, usa
    el default» — replace_fee_tiers debe poder volver una propiedad a ese
    estado, no solo poblarla."""
    pid = test_property["id"]
    properties_db.replace_fee_tiers(pid, "venta", ESCOBECO_VENTA)
    stored = properties_db.replace_fee_tiers(pid, "venta", [])
    assert stored == []
    assert properties_db.get_property(pid)["saleFeeTiers"] == []


def test_replace_fee_tiers_input_invalido_delega_a_validate_tiers(client, test_property):
    """No se re-exploran todos los casos de validate_tiers (ya cubiertos en
    test_finance_fees.py) — solo que el rechazo de verdad llega como
    PropertyError hasta esta capa."""
    pid = test_property["id"]
    with pytest.raises(PropertyError):
        # dos tramos piso
        properties_db.replace_fee_tiers(
            pid, "venta", [
                {"threshold": None, "rate": Decimal("0.05")},
                {"threshold": None, "rate": Decimal("0.06")},
            ])
    with pytest.raises(PropertyError):
        # rate fuera de rango
        properties_db.replace_fee_tiers(
            pid, "venta", [{"threshold": None, "rate": Decimal("1.5")}])


def test_replace_fee_tiers_invalido_no_deja_a_medias_la_escalera_vieja(client, test_property):
    """validate_tiers rechaza ANTES de tocar la base — la escalera capturada
    antes debe seguir intacta si el reemplazo intentado era inválido."""
    pid = test_property["id"]
    properties_db.replace_fee_tiers(pid, "venta", ESCOBECO_VENTA)
    with pytest.raises(PropertyError):
        # dos tramos piso
        properties_db.replace_fee_tiers(
            pid, "venta", [
                {"threshold": None, "rate": Decimal("0.05")},
                {"threshold": None, "rate": Decimal("0.06")},
            ])
    p = properties_db.get_property(pid)
    assert len(p["saleFeeTiers"]) == 3


def test_replace_fee_tiers_sin_piso_no_vacia_persiste_y_hace_round_trip(client, test_property):
    """Una escalera con tramos de umbral pero sin piso ya no es inválida —
    replace_fee_tiers debe aceptarla y devolverla intacta en el round-trip."""
    pid = test_property["id"]
    sin_piso = [{"threshold": Decimal("6500000"), "rate": Decimal("0.07")}]
    stored = properties_db.replace_fee_tiers(pid, "venta", sin_piso)
    assert stored == sin_piso
    assert properties_db.get_property(pid)["saleFeeTiers"] == sin_piso


def test_get_property_con_escalera_sin_piso_debajo_del_umbral_trae_fee_cero(client, test_property):
    """Si el valor proyectado no alcanza el único umbral y no hay piso, la
    comisión calculada debe ser 0 — no el default del modelo."""
    pid = test_property["id"]
    client.patch(f"/api/properties/{pid}", json={"projectedSale": 1_000_000})
    properties_db.replace_fee_tiers(
        pid, "venta", [{"threshold": Decimal("6500000"), "rate": Decimal("0.07")}])

    p = properties_db.get_property(pid)
    assert Decimal(str(p["exitFeeVenta"])) == Decimal("0")


def test_replace_fee_tiers_propiedad_inexistente_es_not_found():
    with pytest.raises(PropertyNotFound):
        properties_db.replace_fee_tiers(
            999_999_999, "venta", [{"threshold": None, "rate": Decimal("0.05")}])


def test_replace_fee_tiers_kind_invalido_es_rechazado(client, test_property):
    with pytest.raises(PropertyError):
        properties_db.replace_fee_tiers(
            test_property["id"], "alquiler", [{"threshold": None, "rate": Decimal("0.05")}])
