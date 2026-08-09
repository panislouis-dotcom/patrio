#!/usr/bin/env python3
"""Hornea la rotación EXIF en las imágenes que YA estaban guardadas.

`api.lib.images.normalize_orientation` endereza toda foto que entra desde que se
enganchó en la ingestión, pero no toca lo que se subió antes: esos bytes siguen
en storage con los píxeles acostados y la bandera EXIF puesta, y el PDF los
sigue sacando de lado. Este script recorre cada imagen que la base referencia
—fotos de propiedad, la imagen de referencia del editor de planos, los renders
con su plano fuente, las fotos de proveedores y los archivos que cuelgan de los
procesos—, las pasa por el mismo normalizador y reescribe SOBRE EL MISMO key. No
hay nada que actualizar en la base: la ruta relativa no cambia.

Los archivos de proceso no son sólo imágenes: ahí vive también la factura en PDF
que prueba que un paso se pagó. No hay que apartarlos, el normalizador devuelve
intacto todo lo que no sabe enderezar.

Reescribir encima no deja copia de lo anterior y la base no guarda rastro de
que pasó, así que `--apply` primero simula, enseña la cuenta y la pide
confirmada. `--property-id` limita el recorrido a una sola propiedad, para
probarlo contra la que se reportó rota antes de soltarlo sobre todas.

Correrlo dos veces no reescribe nada la segunda vez: el normalizador devuelve
los bytes intactos cuando ya no hay rotación pendiente.

Lee el entorno de la API (`.env` vía `api.config`), así que trabaja sobre la
base y el storage que ese entorno configure.

    python scripts/backfill_image_orientation.py                     # simulación
    python scripts/backfill_image_orientation.py --property-id 42    # sólo esa
    python scripts/backfill_image_orientation.py --apply             # reescribe
"""
import argparse
from collections import Counter
from pathlib import Path
import sys

_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT / "app"))

from api import db_proveedores, process_db, properties_db, renders_db, storage  # noqa: E402
from api.lib.images import normalize_orientation                                # noqa: E402

PROPERTY_PHOTO = "foto de propiedad"
FLOORPLAN_REFERENCE = "plano de referencia"
RENDER = "render"
RENDER_PLAN = "plano fuente de render"
PROVEEDOR_PHOTO = "foto de proveedor"
NODE_FILE = "archivo de paso"
INSTANCE_FILE = "archivo de tarea"

SOURCES = (PROPERTY_PHOTO, FLOORPLAN_REFERENCE, RENDER, RENDER_PLAN, PROVEEDOR_PHOTO,
           NODE_FILE, INSTANCE_FILE)

_YES = {"y", "yes", "s", "si", "sí"}


def _reference_keys(geometry: dict):
    """Las imágenes de referencia del modelo de plano.

    Viven una por PISO (`floors[].reference.imageKey`), no en la raíz del
    modelo: el editor sólo calibra sobre el piso activo.
    """
    for floor in geometry.get("floors") or []:
        key = (floor.get("reference") or {}).get("imageKey")
        if key:
            yield key


def collect_keys(property_id: int | None = None) -> list[tuple[str, str]]:
    """(origen, key) de cada imagen guardada, sin repetir keys.

    Con `property_id` sólo se recorre esa propiedad; queda fuera todo lo que no
    cuelga de ninguna: las fotos de proveedores, los archivos de referencia de
    las plantillas de proceso y las tareas que no son de una propiedad.

    Un key repetido se procesaría dos veces sin daño —el segundo paso ya no
    encuentra nada que corregir—, pero contaría doble, y el conteo es lo que se
    confirma antes de escribir.
    """
    if property_id is None:
        properties = properties_db.get_properties(include_archived=True)
    else:
        prop = properties_db.get_property(property_id)
        if prop is None:
            raise properties_db.PropertyNotFound(f"Propiedad {property_id} no encontrada")
        properties = [prop]

    found: list[tuple[str, str]] = []
    for prop in properties:
        for image in prop["images"]:
            found.append((PROPERTY_PHOTO, image["filePath"]))
        for key in _reference_keys(properties_db.get_geometry(prop["id"]) or {}):
            found.append((FLOORPLAN_REFERENCE, key))
        for render in renders_db.list_renders(prop["id"]):
            found.append((RENDER, render["filePath"]))
            if render["sourcePlanPath"]:
                found.append((RENDER_PLAN, render["sourcePlanPath"]))
    if property_id is None:
        for proveedor in db_proveedores.get_proveedores():
            for photo in proveedor["photos"]:
                found.append((PROVEEDOR_PHOTO, photo["filePath"]))
    for node_file in process_db.get_all_node_files(property_id):
        found.append((NODE_FILE, node_file["filePath"]))
    for instance_file in process_db.get_all_instance_files(property_id):
        found.append((INSTANCE_FILE, instance_file["filePath"]))

    seen: set[str] = set()
    unique = []
    for source, key in found:
        if key not in seen:
            seen.add(key)
            unique.append((source, key))
    return unique


def backfill(apply: bool, property_id: int | None = None) -> dict[str, Counter]:
    keys = collect_keys(property_id)
    print(f"{'Reescribiendo' if apply else 'Revisando'} {len(keys)} archivos guardados"
          f"{'' if apply else ' — nada se escribe todavía'}\n")

    checked, fixed, failed, missing = Counter(), Counter(), Counter(), Counter()
    for source, key in keys:
        checked[source] += 1
        try:
            content, content_type = storage.stream(key)
        except FileNotFoundError:
            # La base puede referenciar un archivo que ya no está. Es un dato
            # roto de antes, no algo que este backfill deba arreglar ni motivo
            # para dejar sin revisar todo lo que falta.
            missing[source] += 1
            print(f"  ! sin archivo en storage: {key} — {source}")
            continue
        normalized = normalize_orientation(content)
        if normalized == content:
            continue
        if apply:
            try:
                storage.upload(key, normalized, content_type)
            except Exception as exc:
                # Una escritura que falla a media corrida —red, permisos— no se
                # puede llevar el recorrido entero: sin resumen nadie sabe qué
                # alcanzó a corregirse. Se anota cuál falló y se sigue.
                failed[source] += 1
                print(f"  ! no se pudo reescribir: {key} — {source}: {exc}")
                continue
        fixed[source] += 1
        print(f"  [{sum(fixed.values())}] {key} — {source}")

    _print_summary(checked, fixed, failed, missing, apply)
    return {"checked": checked, "fixed": fixed, "failed": failed, "missing": missing}


def _print_summary(checked: Counter, fixed: Counter, failed: Counter,
                   missing: Counter, apply: bool) -> None:
    label = "corregidos" if apply else "por corregir"
    rows = [(source, checked[source], fixed[source], failed[source], missing[source])
            for source in SOURCES]
    rows.append(("TOTAL", *(sum(c.values()) for c in (checked, fixed, failed, missing))))
    print("\nResumen")
    for name, revisados, corregidos, sin_escribir, sin_archivo in rows:
        print(f"  {name:<24} {revisados:>5} revisados   {corregidos:>4} {label}"
              f"   {sin_escribir:>4} sin escribir   {sin_archivo:>4} sin archivo")


def _confirmed(pending: int) -> bool:
    answer = input(f"\nSe van a reescribir {pending} imágenes sobre su propio key, sin dejar "
                   "copia de lo anterior. ¿Continuar? [y/N]: ")
    return answer.strip().lower() in _YES


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--apply", action="store_true",
                        help="reescribe las imágenes; sin esta bandera sólo las lista")
    parser.add_argument("--property-id", type=int,
                        help="limita el recorrido a una propiedad (deja fuera lo que no "
                             "cuelga de ninguna: proveedores, referencias de plantilla)")
    args = parser.parse_args(argv)

    # La simulación corre siempre. Con --apply es la cuenta que se confirma
    # antes de tocar storage: cuesta una lectura de más por imagen y es lo único
    # que puede decir cuántas se van a reescribir antes de reescribirlas.
    try:
        summary = backfill(apply=False, property_id=args.property_id)
    except properties_db.PropertyNotFound as exc:
        print(exc, file=sys.stderr)
        return 1

    pending = sum(summary["fixed"].values())
    if not args.apply:
        if pending:
            print("\nNada se escribió. Vuelve a correr con --apply para reescribirlas.")
        return 0
    if not pending:
        return 0
    if not _confirmed(pending):
        print("Cancelado: no se escribió nada.")
        return 0
    backfill(apply=True, property_id=args.property_id)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
