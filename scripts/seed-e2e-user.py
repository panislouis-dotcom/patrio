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

            # Seed a prospect so row-click/detail-page E2E tests have data
            cur.execute("DELETE FROM prospects WHERE name = '[SEED] Terreno E2E'")
            cur.execute(
                """
                INSERT INTO prospects (
                    name, address, city, status, url,
                    latitude, longitude,
                    sqm_land, sqm_construction,
                    land_price, acquisition_cost_pct,
                    permits_cost, subdivision_cost,
                    construction_cost_per_sqm, construction_overhead,
                    projected_sale, hold_months, rent_monthly
                ) VALUES (
                    '[SEED] Terreno E2E', 'Calle E2E 1, Col. Centro', 'Monterrey', 'evaluating',
                    'https://refigan.mx',
                    25.6866, -100.3161,
                    500, 0,
                    2000000, 0.065,
                    0, 0,
                    0, 1.3,
                    3000000, 18, 0
                )
                """,
            )

            # Seed a project so proyecto row-click/detail-page E2E tests have data
            cur.execute("DELETE FROM projects WHERE name = '[SEED] Proyecto E2E'")
            cur.execute(
                """
                INSERT INTO projects (
                    name, type, address, city, status,
                    total_units, acquisition_date, conclusion_date,
                    total_investment, current_valuation, valuation_date,
                    url, latitude, longitude
                ) VALUES (
                    '[SEED] Proyecto E2E', 'residencial', 'Av. E2E 100, Monterrey', 'Monterrey', 'en_proceso',
                    10, '2024-01-01', '2025-12-31',
                    5000000, 6000000, '2024-06-01',
                    'https://refigan.mx', 25.6866, -100.3161
                )
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

    print("✓ E2E user, prospect, project, investor, and proveedor seeded")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
