#!/usr/bin/env python3
"""Persiste el id de piso que hoy es efímero para todo blob guardado antes de que
`FloorGraph.id` existiera.

`migrateGeometry` (app/web/src/lib/floorplan/types.ts:212-262) rellena ese `id` en
MEMORIA con `crypto.randomUUID()` cada vez que el editor abre un blob que aún no lo
tiene — nunca lo escribe de vuelta a menos que alguien guarde el plano. Un render se
etiqueta al generarse con el id efímero de ESA carga (LevantamientoPanel.tsx:180); en
la siguiente carga migrateGeometry le asigna un id NUEVO al mismo piso, y el render
—que sigue intacto en la base— deja de encontrar su piso y desaparece de la vista
(RendersPanel.tsx:200). Reportado en prod contra Vicente Guerrero: generar un render
se veía de inmediato y desaparecía al recargar, dos veces seguidas.

Este script corre el MISMO `migrateGeometry` que ya corre en el editor —evaluado
dentro del bundle real (`plano.iife.js`) vía `api.lib.plano_js`, no una
reimplementación paralela del schema v2/v3 en Python— y persiste el resultado donde
de verdad cambió algo. Un blob v2 sin `schemaVersion` también sube a v3 de paso: es
la misma migración que el editor ya trata como equivalente en cada lectura, así que
persistirla no cambia ningún comportamiento, sólo dejamos de re-envolverla cada vez.

Correrlo dos veces no reescribe nada la segunda vez: una propiedad ya reparada vuelve
del round-trip idéntica y se salta.

Lee el entorno de la API (`.env` vía `api.config`), así que trabaja sobre la base
que ese entorno configure. Corre dentro de la imagen del API (necesita el bundle
`plano.iife.js` y Chromium que ya vienen horneados ahí) — tanto a mano vía
`kubectl exec` como automático en un Job de deploy junto a `refigan-migrate`
(edg-infra), con --yes para saltarse la confirmación interactiva que un Job sin
terminal no puede responder.

    python scripts/backfill_floor_ids.py                       # simulación
    python scripts/backfill_floor_ids.py --property-id 42      # sólo esa
    python scripts/backfill_floor_ids.py --apply                # persiste, confirma a mano
    python scripts/backfill_floor_ids.py --apply --yes          # persiste sin confirmar (CI)
"""
import argparse
import asyncio
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT / "app"))

from api.db import get_db          # noqa: E402
from api.lib import plano_js       # noqa: E402
from api import properties_db      # noqa: E402

_YES = {"y", "yes", "s", "si", "sí"}


def fetch_geometries(property_id: int | None = None) -> dict[int, tuple[str, dict]]:
    where = "WHERE geometry IS NOT NULL AND geometry <> '{}'::jsonb"
    params: tuple = ()
    if property_id is not None:
        where += " AND id = %s"
        params = (property_id,)
    with get_db() as conn:
        rows = conn.execute(f"SELECT id, name, geometry FROM properties {where}", params).fetchall()
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
    for pid, name, migrated in to_fix:
        properties_db.set_geometry(pid, migrated)
        print(f"  ✓ #{pid} {name} reparado")


def _confirmed(pending: int) -> bool:
    answer = input(f"\nSe van a persistir ids de piso en {pending} propiedades. "
                   "¿Continuar? [y/N]: ")
    return answer.strip().lower() in _YES


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--apply", action="store_true",
                        help="persiste los ids; sin esta bandera sólo reporta")
    parser.add_argument("--property-id", type=int,
                        help="limita el recorrido a una sola propiedad")
    # Sin la confirmación interactiva: para el Job de deploy (PreSync, sin
    # terminal — un input() ahí cuelga el Job hasta el activeDeadlineSeconds).
    # A mano seguís usando --apply solo, que sí confirma.
    parser.add_argument("--yes", action="store_true",
                        help="con --apply, no pide confirmación (uso no interactivo/CI)")
    args = parser.parse_args(argv)

    by_id = fetch_geometries(args.property_id)
    illegible, unchanged, to_fix = asyncio.run(plan(by_id))

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

    if not args.apply:
        if to_fix:
            print("\nNada se escribió. Vuelve a correr con --apply para persistirlos.")
        return 0
    if not to_fix:
        return 0
    if not args.yes and not _confirmed(len(to_fix)):
        print("Cancelado: no se escribió nada.")
        return 0

    print()
    apply(to_fix)
    print(f"\n{len(to_fix)} propiedades reparadas.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
