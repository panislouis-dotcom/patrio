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
            # 028): sin soltarlo primero, resembrar falla con una violación de FK.
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

            # Y su presupuesto, con la misma aritmética de la 028: toda propiedad
            # tiene uno, y su suma es el costo de obra con el overhead ya dentro.
            # `is_residual` prendida (029): es el renglón del que se resta al
            # detallar, y sin él el costo de obra crecería con cada partida.
            # Las dos semillas capturan 0 de obra, así que la fila nace en $0 —
            # que es lo que dicen sus columnas, y sigue significando «nada
            # capturado», no «cero pesos de obra».
            cur.execute(
                """
                WITH nuevos AS (
                    INSERT INTO budgets (property_id)
                    SELECT id FROM properties
                     WHERE name IN ('[SEED] Terreno E2E', '[SEED] Propiedad E2E')
                    RETURNING id, property_id
                )
                INSERT INTO budget_lines (budget_id, chapter_name, name, unit, quantity, unit_price, is_residual)
                SELECT n.id, 'Otros', 'Otros, por detallar', 'lote', 1,
                       (coalesce(p.sqm_construction::numeric, 0)
                        * coalesce(p.construction_cost_per_sqm, 0)
                        * CASE WHEN p.construction_overhead IS NULL THEN 1.3
                               WHEN p.construction_overhead = 0     THEN 1
                               ELSE p.construction_overhead::numeric END),
                       TRUE
                  FROM nuevos n JOIN properties p ON p.id = n.property_id
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
