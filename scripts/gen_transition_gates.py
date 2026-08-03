#!/usr/bin/env python3
"""Emite la tabla de compuertas de transición que vive en `use-refigan.md`.

La tabla es un espejo mecánico de dos cosas del código, así que se deriva de
ellas en vez de copiarse a mano:

  · `checks.stage_requirements(status, {})` — qué EXIGE la etapa. Con una fila
    vacía, cada regla de esa etapa dispara y ninguna de las cruzadas (las de
    orden de fechas necesitan fechas), así que lo que sale es exactamente la
    compuerta.
  · Los cuerpos tipados de `routes/properties.py` — qué ACEPTA el endpoint, y
    cuáles de esos campos son obligatorios ya en el esquema.

El cruce de las dos produce el único matiz que la tabla escrita a mano tenía que
recordar: un campo que la compuerta exige pero el cuerpo declara opcional es uno
que la propiedad puede traer ya capturado.

Escrita a mano, esta tabla afirmó durante dos commits que `desarrollo` exigía
`currentValuation` después de que el gate dejó de pedirla — y un agente que la
siguiera habría inventado un avalúo para satisfacer una compuerta inexistente,
que es precisamente la conducta que ese cambio existía para eliminar. Derivada
no puede volver a pasar: `test_use_refigan_gate_table_is_current` compara el
archivo contra lo que este script produce hoy.

    python scripts/gen_transition_gates.py            # imprime el bloque
    python scripts/gen_transition_gates.py --write    # lo escribe en la skill
"""
from pathlib import Path
import sys

_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT / "app"))

from api.checks import stage_requirements                      # noqa: E402
from api.routes import properties as routes                     # noqa: E402

SKILL = _ROOT / "app" / ".claude" / "skills" / "use-refigan.md"

BEGIN = "<!-- BEGIN GENERATED: transition-gates · scripts/gen_transition_gates.py -->"
END = "<!-- END GENERATED: transition-gates -->"

# Cada destino con el cuerpo que lo transporta. `prospecto` no aparece: toda
# propiedad nace ahí y nadie transiciona hacia él.
_BODIES = {
    "oferta": routes.ToOferta,
    "desarrollo": routes.ToDesarrollo,
    "en_renta": routes.ToEnRenta,
    "vendida": routes.ToVendida,
    "archivada": routes.ToArchivada,
}

# Lo que todo cuerpo lleva; se documenta en prosa aparte y no ensucia la tabla.
_COMMON = {"to", "effectiveOn", "notes"}


def _code(*groups) -> str:
    """(nombres, sufijo)… → «`a`, `b`†», o «—» si no hay ninguno."""
    parts = [f"`{n}`{suffix}" for names, suffix in groups for n in names]
    return ", ".join(parts) if parts else "—"


def _accepted(model) -> set[str]:
    return set(model.model_fields) - _COMMON


def _schema_required(model) -> set[str]:
    return {n for n, f in model.model_fields.items() if f.is_required()} - _COMMON


def _sources(status: str) -> tuple[list[str], list[str], list[str]]:
    """(exigidos siempre, exigidos salvo que ya estén capturados, aceptados)."""
    gate = set(stage_requirements(status, {}))
    schema = _schema_required(_BODIES[status])
    hard = sorted(gate & schema)
    soft = sorted(gate - schema)          # la compuerta los pide, el cuerpo no
    optional = sorted(_accepted(_BODIES[status]) - gate)
    return hard, soft, optional


def build() -> str:
    rows, marked = [], False
    for status in _BODIES:
        hard, soft, optional = _sources(status)
        marked = marked or bool(soft)
        rows.append(f"| `{status}` | {_code((hard, ''), (soft, '†'))} "
                    f"| {_code((optional, ''))} |")

    lines = [
        BEGIN,
        "",
        "| `to` | Required in the body | Accepted, not required |",
        "|---|---|---|",
        *rows,
        "",
    ]
    if marked:
        lines += [
            "† Demanded by the stage, optional in the body: the property may already "
            "carry it, and the gate reads the row *after* the body is merged in.",
            "",
        ]
    lines.append(END)
    return "\n".join(lines)


def _replace(text: str, block: str) -> str:
    start, end = text.index(BEGIN), text.index(END) + len(END)
    return text[:start] + block + text[end:]


def main() -> int:
    block = build()
    if "--write" in sys.argv:
        SKILL.write_text(_replace(SKILL.read_text(), block))
        print(f"escrito en {SKILL}")
    else:
        print(block)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
