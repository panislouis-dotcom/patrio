#!/usr/bin/env python3
import os
import sys
from urllib.parse import urlparse

import psycopg2
from passlib.context import CryptContext

_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


def main() -> int:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is required", file=sys.stderr)
        return 1

    host = urlparse(database_url).hostname or ""
    if host not in _LOCAL_HOSTS:
        print(
            f"Refusing to seed: DATABASE_URL points to non-local host '{host}'. "
            "This script must only run against a local or CI database.",
            file=sys.stderr,
        )
        return 1

    email = os.environ.get("E2E_USER")
    password = os.environ.get("E2E_PASS")
    if not email or not password:
        print("E2E_USER and E2E_PASS env vars must be set", file=sys.stderr)
        return 1

    password_context = CryptContext(schemes=["bcrypt"])
    password_hash = password_context.hash(password)

    conn = psycopg2.connect(database_url)
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO users (email, hashed_password, is_active)
                VALUES (%s, %s, TRUE)
                ON CONFLICT (email) DO NOTHING
                """,
                (email, password_hash),
            )

            # El presupuesto de obra retiene a su propiedad (RESTRICT, migración
            # 032): sin soltarlo primero, resembrar falla con una violación de FK.
            # Se suelta explícitamente porque eso es lo que compra el RESTRICT —
            # que tirar captura de obra sea una decisión y no un efecto colateral.
            cur.execute(
                """
                DELETE FROM budgets
                 WHERE property_id IN (SELECT id FROM properties
                                        WHERE name IN ('[SEED] Terreno E2E', '[SEED] Propiedad E2E'))
                """,
            )

            # Seed a pre-purchase property so row-click/detail-page E2E tests have data.
            # Both rent columns stay NULL: they only store positive rents.
            cur.execute("DELETE FROM properties WHERE name = '[SEED] Terreno E2E'")
            cur.execute(
                """
                INSERT INTO properties (
                    name, address, city, status, asset_type, url,
                    latitude, longitude,
                    sqm_land, sqm_construction,
                    purchase_price, acquisition_cost_pct,
                    permits_cost, subdivision_cost,
                    construction_cost_per_sqm, construction_overhead,
                    projected_sale, hold_months
                ) VALUES (
                    '[SEED] Terreno E2E', 'Calle E2E 1, Col. Centro', 'Monterrey', 'prospecto', 'lote',
                    'https://refigan.mx',
                    25.6866, -100.3161,
                    500, 0,
                    2000000, 0.065,
                    0, 0,
                    0, 1.3,
                    3000000, 18
                )
                """,
            )

            # Seed a property under development so the post-purchase E2E tests have data
            cur.execute("DELETE FROM properties WHERE name = '[SEED] Propiedad E2E'")
            cur.execute(
                """
                INSERT INTO properties (
                    name, asset_type, strategy_type, address, city, status,
                    total_units, acquisition_date,
                    purchase_price, acquisition_cost_pct,
                    permits_cost, subdivision_cost,
                    sqm_construction, construction_cost_per_sqm,
                    current_valuation, valuation_date,
                    url, latitude, longitude
                ) VALUES (
                    '[SEED] Propiedad E2E', 'edificio', 'ground_up',
                    'Av. E2E 100, Monterrey', 'Monterrey', 'desarrollo',
                    10, '2024-01-01',
                    -- Inversión all-in de $5M: toda en el precio de compra, con
                    -- el pct de adquisición en 0 explícito (NULL aplicaría el
                    -- 6.5% del sistema y la base dejaría de ser $5,000,000).
                    5000000, 0,
                    0, 0,
                    0, 0,
                    6000000, '2024-06-01',
                    'https://refigan.mx', 25.6866, -100.3161
                )
                """,
            )

            # Both properties need their opening status event: the API writes one on
            # create, and the lifecycle E2E specs read the history.
            cur.execute(
                """
                INSERT INTO property_status_events (property_id, from_status, to_status, effective_on, notes)
                SELECT id, NULL, status, created_at::date, 'Alta de semilla E2E'
                  FROM properties
                 WHERE name IN ('[SEED] Terreno E2E', '[SEED] Propiedad E2E')
                """,
            )

            # Y su presupuesto. Toda propiedad tiene uno, y su total es la suma
            # de sus renglones (053) — ya no hay residuo del que restar.
            #
            # ESPEJO EXACTO de `db/seeds/properties/seed_zz_presupuestos.sql`, y
            # tiene que seguir siéndolo: una base sembrada por aquí y una
            # sembrada por allá se leen igual. De ahí las tres cosas que copia:
            # `seeded = TRUE` declarada al INSERT —la procedencia se registra,
            # no se deduce (054)—, el nombre con la cuenta que lo produjo en el
            # formato de `estimate_line_name`, y la guarda del final.
            #
            # ESA GUARDA ES LA QUE MANDA HOY: las dos semillas capturan 0 de
            # obra, así que no se escribe renglón y el presupuesto nace VACÍO,
            # igual que lo haría el API. Un renglón de $0 llamado «Estimado
            # inicial · 0 m² × $0/m²» no dice nada que el presupuesto vacío no
            # diga ya (`seed_estimate_line`), y sembrado sin marca dejaba a las
            # dos propiedades leyéndose como trabajo capturado: indelebles por
            # el 422 de `holds_captured_work`, que es justo lo que las specs de
            # borrado necesitan poder hacer. El nombre queda escrito para el día
            # que alguna semilla sí traiga metraje.
            cur.execute(
                """
                WITH nuevos AS (
                    INSERT INTO budgets (property_id)
                    SELECT id FROM properties
                     WHERE name IN ('[SEED] Terreno E2E', '[SEED] Propiedad E2E')
                    RETURNING id, property_id
                )
                INSERT INTO budget_lines (budget_id, chapter_name, name, unit,
                                          quantity, unit_price, seeded)
                SELECT n.id, 'Otros',
                       'Estimado inicial · '
                         || rtrim(trim(to_char(coalesce(p.sqm_construction::numeric, 0),
                                               'FM999,999,990.999')), '.')
                         || ' m² × $'
                         || rtrim(trim(to_char(coalesce(p.construction_cost_per_sqm, 0),
                                               'FM999,999,990.99')), '.')
                         || '/m²'
                         || CASE WHEN overhead.factor = 1 THEN ''
                                 ELSE ' × ' || rtrim(trim(to_char(overhead.factor,
                                                                  'FM999,990.9999')), '.') END,
                       'lote', 1,
                       (coalesce(p.sqm_construction::numeric, 0)
                        * coalesce(p.construction_cost_per_sqm, 0)
                        * overhead.factor),
                       TRUE
                  FROM nuevos n
                  JOIN properties p ON p.id = n.property_id
                  JOIN LATERAL (SELECT CASE WHEN p.construction_overhead IS NULL THEN 1.3
                                            WHEN p.construction_overhead = 0     THEN 1
                                            ELSE p.construction_overhead::numeric END AS factor)
                       overhead ON TRUE
                 WHERE coalesce(p.sqm_construction::numeric, 0)
                       * coalesce(p.construction_cost_per_sqm, 0) > 0
                """,
            )

            # Seed an investor so inversionista row-click/detail-page E2E tests have data
            cur.execute("DELETE FROM investors WHERE name = '[SEED] Inversionista E2E'")
            cur.execute(
                "INSERT INTO investors (name) VALUES ('[SEED] Inversionista E2E')",
            )

            # Seed a proveedor so proveedores row-click/detail-page E2E tests have data
            cur.execute("DELETE FROM proveedores WHERE name = '[SEED] Proveedor E2E'")
            cur.execute(
                "INSERT INTO proveedores (name, zona, status, notes) VALUES ('[SEED] Proveedor E2E', 'Monterrey', 'activo', '')",
            )
    finally:
        conn.close()

    print("✓ E2E user, properties, investor, and proveedor seeded")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
