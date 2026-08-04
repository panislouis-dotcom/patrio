#!/usr/bin/env python3
"""¿Hay dos migraciones con el mismo número?

El número de una migración es un identificador **global** que cada rama asigna
**localmente**. Dos ramas miran sus propios archivos, ven que la última es la
027, y las dos toman la 028. Ninguna puede notarlo: para git son archivos con
nombres distintos, así que no hay conflicto que resolver y el merge pasa limpio.

Y el resultado no se ve. dbmate registra en `schema_migrations` el número pelón,
no el nombre, así que en una base que ya tiene ese número aplicado da la segunda
por hecha y **se la salta sin error**. Sus tablas nunca se crean y el módulo
truena mucho después, en otro ambiente, contra tablas que no existen.

Pasó —`028_renders.sql` y `028_budget.sql`— y renumerar arregló esa colisión,
no la siguiente. Esto arregla la siguiente.

Vive en scripts/ y no dentro de las pruebas porque hacen falta dos llamadas: la
suite lo afirma como prueba con nombre, y conftest lo llama ANTES de migrar la
base de prueba — si no, la colisión revienta el bootstrap de dbmate y la sesión
muere antes de llegar a la prueba, con un error que no dice cuál es la causa.
"""
import re
import sys
from collections import defaultdict
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parent.parent / "db" / "migrations"

# El mismo criterio que dbmate: la versión son los dígitos con los que empieza el
# nombre, y lo que sigue es decoración para humanos. Si esto deja de espejarlo,
# se vigila algo distinto de lo que se aplica.
_VERSION = re.compile(r"^(\d+)")


def versions(directory: Path = MIGRATIONS) -> list[tuple[str, str]]:
    """(versión, nombre) por cada .sql, en el orden en que dbmate los lee."""
    out = []
    for f in sorted(directory.glob("*.sql")):
        m = _VERSION.match(f.name)
        if not m:
            raise ValueError(
                f"«{f.name}» no empieza con dígitos, así que dbmate no le ve "
                "versión y no la aplica nunca. Nómbrala NNN_lo_que_hace.sql."
            )
        out.append((m.group(1), f.name))
    return out


def collisions(directory: Path = MIGRATIONS) -> dict[str, list[str]]:
    """Los números usados por más de un archivo."""
    por_numero: dict[str, list[str]] = defaultdict(list)
    for version, name in versions(directory):
        por_numero[version].append(name)
    return {n: fs for n, fs in por_numero.items() if len(fs) > 1}


def problem(directory: Path = MIGRATIONS) -> str | None:
    """La queja, ya redactada, o None si el directorio está sano."""
    dupes = collisions(directory)
    if not dupes:
        return None
    detalle = "\n".join(f"  {n} → {', '.join(fs)}" for n, fs in sorted(dupes.items()))
    return (
        "Dos migraciones comparten número:\n"
        f"{detalle}\n\n"
        "dbmate identifica una migración por su NÚMERO, no por su nombre: en una "
        "base que ya tenga ese número aplicado, la segunda se salta SIN ERROR y "
        "sus tablas no se crean nunca. El módulo truena después, en otro "
        "ambiente, contra tablas que no existen.\n\n"
        "Renumera la que llegó después al primer número libre por encima de "
        "TODOS los usados — no al hueco más cercano: un número que alguna base "
        "ya tenga registrado vuelve a colisionar, ahora del otro lado. Si la "
        "cadena trae varias, muévelas juntas y conserva su orden relativo, "
        "porque unas alteran lo que crean las otras."
    )


if __name__ == "__main__":
    queja = problem()
    if queja:
        print(queja, file=sys.stderr)
        raise SystemExit(1)
    print(f"✓ {len(versions())} migraciones, ningún número repetido")
