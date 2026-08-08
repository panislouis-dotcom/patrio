#!/usr/bin/env python3
"""Hornea la rotación EXIF en las imágenes que YA estaban guardadas.

`api.lib.images.normalize_orientation` corrige toda foto que entra desde que se
enganchó en la ingestión, pero no toca lo que se subió antes: esos bytes siguen
en storage con los píxeles acostados y la bandera EXIF puesta, y el PDF los
sigue sacando de lado. Este script recorre cada imagen que la base referencia
—fotos de propiedad, la imagen de referencia del editor de planos, los renders
con su plano fuente, y las fotos de proveedores—, las pasa por el mismo
normalizador y reescribe SOBRE EL MISMO key. No hay nada que actualizar en la
base: la ruta relativa no cambia.

Correrlo dos veces no reescribe nada la segunda vez: el normalizador devuelve
los bytes intactos cuando ya no hay rotación pendiente.

Lee el entorno de la API (`.env` vía `api.config`), así que apunta a la base y
al storage que ese entorno configure — el `--apply` reescribe donde el API de
ese entorno guardó las fotos.

    python scripts/backfill_image_orientation.py            # simulación
    python scripts/backfill_image_orientation.py --apply    # reescribe
"""
import argparse
from collections import Counter
from pathlib import Path
import sys

_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT / "app"))

from api import db_proveedores, properties_db, renders_db, storage  # noqa: E402
from api.lib.images import normalize_orientation                    # noqa: E402

PROPERTY_PHOTO = "foto de propiedad"
FLOORPLAN_REFERENCE = "plano de referencia"
RENDER = "render"
RENDER_PLAN = "plano fuente de render"
PROVEEDOR_PHOTO = "foto de proveedor"

SOURCES = (PROPERTY_PHOTO, FLOORPLAN_REFERENCE, RENDER, RENDER_PLAN, PROVEEDOR_PHOTO)


def _reference_keys(geometry: dict):
    """Las imágenes de referencia del modelo de plano.

    Viven una por PISO (`floors[].reference.imageKey`), no en la raíz del
    modelo: el editor sólo calibra sobre el piso activo.
    """
    for floor in geometry.get("floors") or []:
        key = (floor.get("reference") or {}).get("imageKey")
        if key:
            yield key


def collect_keys() -> list[tuple[str, str]]:
    """(origen, key) de cada imagen guardada, sin repetir keys.

    Un key repetido se procesaría dos veces sin daño —el segundo paso ya no
    encuentra nada que corregir—, pero contaría doble, y el conteo es lo único
    que la simulación entrega.
    """
    found: list[tuple[str, str]] = []
    for prop in properties_db.get_properties(include_archived=True):
        property_id = prop["id"]
        for image in prop["images"]:
            found.append((PROPERTY_PHOTO, image["filePath"]))
        for key in _reference_keys(properties_db.get_geometry(property_id) or {}):
            found.append((FLOORPLAN_REFERENCE, key))
        for render in renders_db.list_renders(property_id):
            found.append((RENDER, render["filePath"]))
            if render["sourcePlanPath"]:
                found.append((RENDER_PLAN, render["sourcePlanPath"]))
    for proveedor in db_proveedores.get_proveedores():
        for photo in proveedor["photos"]:
            found.append((PROVEEDOR_PHOTO, photo["filePath"]))

    seen: set[str] = set()
    unique = []
    for source, key in found:
        if key not in seen:
            seen.add(key)
            unique.append((source, key))
    return unique


def backfill(apply: bool) -> dict[str, Counter]:
    keys = collect_keys()
    verb = "Corrigiendo" if apply else "Simulando"
    print(f"{verb} sobre {len(keys)} imágenes guardadas"
          f"{'' if apply else ' (nada se escribe; usa --apply para reescribir)'}\n")

    checked, fixed, missing = Counter(), Counter(), Counter()
    for source, key in keys:
        checked[source] += 1
        try:
            content, content_type = storage.stream(key)
        except FileNotFoundError:
            # La base puede referenciar un archivo que ya no está. Es un dato
            # roto de antes, no algo que este backfill deba arreglar ni motivo
            # para dejar sin corregir todo lo que falta por revisar.
            missing[source] += 1
            print(f"  ! sin archivo en storage: {key} — {source}")
            continue
        normalized = normalize_orientation(content)
        if normalized == content:
            continue
        fixed[source] += 1
        print(f"  [{sum(fixed.values())}] {key} — {source}")
        if apply:
            storage.upload(key, normalized, content_type)

    _print_summary(checked, fixed, missing, apply)
    return {"checked": checked, "fixed": fixed, "missing": missing}


def _print_summary(checked: Counter, fixed: Counter, missing: Counter, apply: bool) -> None:
    label = "corregidas" if apply else "por corregir"
    print("\nResumen")
    for source in SOURCES:
        print(f"  {source:<24} {checked[source]:>5} revisadas"
              f"   {fixed[source]:>4} {label}"
              f"   {missing[source]:>4} sin archivo")
    print(f"  {'TOTAL':<24} {sum(checked.values()):>5} revisadas"
          f"   {sum(fixed.values()):>4} {label}"
          f"   {sum(missing.values()):>4} sin archivo")
    if not apply and sum(fixed.values()):
        print("\nNada se escribió. Vuelve a correr con --apply para reescribirlas.")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--apply", action="store_true",
                        help="reescribe las imágenes; sin esta bandera sólo las lista")
    backfill(apply=parser.parse_args(argv).apply)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
