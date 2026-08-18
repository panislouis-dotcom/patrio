"""
One-off repair: persist real floor IDs for every property whose geometry still
depends on the ephemeral backfill `migrateGeometry` does in memory.

Background: a floor saved before `FloorGraph.id` existed (types.ts:138-143) gets a
FRESH `crypto.randomUUID()` every single time its geometry is loaded — the id is
never written back to storage (types.ts:212-262, `backfillFloorIds`). A render
generated against one of those ephemeral ids (routes/renders.py, `floorId` on
creation) stops matching its floor the moment the page reloads and a new id gets
minted: it disappears from the RENDERS panel (RendersPanel.tsx:200,
`r.floorId === selectedFloorId`) even though the row is still in the database.

This job runs the SAME `migrateGeometry` the editor already runs in memory —
`plano_js.backfill_floor_ids`, evaluated inside the real `plano.iife.js` bundle, not
a parallel reimplementation of the v2/v3 schema in Python — and persists the result
for every property where it actually changed something. Idempotent: a property
that's already fine round-trips byte-identical and is left alone.

Dry-run by default — prints what WOULD change without writing anything. Pass
--apply to persist.

Run: PYTHONPATH=.:apps python -m api.jobs.backfill_floor_ids [--apply]
"""
import argparse
import asyncio

from api.db import get_db
from api.lib import plano_js


def fetch_geometries() -> dict[int, tuple[str, dict]]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, name, geometry FROM properties"
            " WHERE geometry IS NOT NULL AND geometry <> '{}'::jsonb"
        ).fetchall()
    return {r["id"]: (r["name"], r["geometry"]) for r in rows}


async def plan(by_id: dict[int, tuple[str, dict]]) -> tuple[list, list, list]:
    """Sorts properties into (illegible, unchanged, to_fix) without writing anything.
    `to_fix` entries are `(id, name, migrated_geometry)`."""
    if not by_id:
        return [], [], []
    migrated = await plano_js.backfill_floor_ids({pid: g for pid, (_, g) in by_id.items()})

    illegible, unchanged, to_fix = [], [], []
    for pid, (name, original) in by_id.items():
        result = migrated.get(pid)
        if result is None:
            illegible.append((pid, name))
        elif result == original:
            unchanged.append((pid, name))
        else:
            to_fix.append((pid, name, result))
    return illegible, unchanged, to_fix


def apply(to_fix: list) -> None:
    from api import properties_db
    for pid, name, migrated in to_fix:
        properties_db.set_geometry(pid, migrated)
        print(f"  ✓ #{pid} {name} reparado")


async def main(do_apply: bool) -> int:
    by_id = fetch_geometries()
    illegible, unchanged, to_fix = await plan(by_id)

    print(f"{len(by_id)} propiedades con geometría — "
          f"{len(unchanged)} ya bien, {len(illegible)} ilegibles, {len(to_fix)} por reparar\n")
    if illegible:
        print("Ilegibles (sin tocar — migrateGeometry las rechazó, no son un blob v2/v3 válido):")
        for pid, name in illegible:
            print(f"  #{pid} {name}")
    if to_fix:
        print("Por reparar (id de piso efímero → persistido):")
        for pid, name, _ in to_fix:
            print(f"  #{pid} {name}")

    if not do_apply:
        print("\nDry-run — nada se escribió. Corre con --apply para persistir.")
        return 0

    print()
    apply(to_fix)
    print(f"\n{len(to_fix)} propiedades reparadas.")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true",
                        help="Persiste los cambios. Sin esta bandera, solo reporta.")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(main(args.apply)))
