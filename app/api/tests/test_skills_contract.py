"""Las skills afirman cosas sobre el contrato del API. Aquí se comprueban.

La distinción que ordena este archivo: una skill mezcla **prosa de dominio**
(por qué una etapa exige lo que exige) con **espejos mecánicos** del código (qué
exige, y qué endpoints existen). La prosa se escribe a mano y no se puede
verificar. El espejo sí, y si no se verifica se desincroniza — ya pasó: la tabla
de compuertas afirmó durante dos commits que `desarrollo` exigía
`currentValuation` después de que el gate dejó de pedirla, y un agente que la
siguiera habría **inventado un avalúo** para satisfacer una compuerta que ya no
existía, que es justo la conducta que ese cambio eliminó.

Un doc que miente sobre el contrato es peor que uno que falta: al que falta se
le va a leer el código.
"""
import re
import sys
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(_ROOT / "scripts"))

SKILLS = _ROOT / "app" / ".claude" / "skills"
USE_REFIGAN = SKILLS / "use-refigan.md"


def test_the_gate_table_is_what_the_code_enforces():
    """El bloque generado del archivo contra lo que el generador produce hoy."""
    import gen_transition_gates as gen

    text = USE_REFIGAN.read_text()
    start, end = text.index(gen.BEGIN), text.index(gen.END) + len(gen.END)
    assert text[start:end] == gen.build(), (
        "La tabla de compuertas de use-refigan.md no coincide con checks.py + "
        "routes/properties.py. Regenérala:\n"
        "    python scripts/gen_transition_gates.py --write"
    )


def test_every_operation_id_the_skills_cite_exists():
    """Los `operation_id` son el índice por el que un agente encuentra una ruta
    sin adivinar la URL. Uno que no existe manda a buscar algo que no está.

    Se compara contra las rutas montadas en la app, no contra un openapi.json
    descargado: así corre sin stack levantado y falla en el commit que borra o
    renombra la ruta, no semanas después."""
    from api.main import app

    live = {r.operation_id for r in app.routes if getattr(r, "operation_id", None)}
    assert live, "la app no expone ningún operation_id — el test no probaría nada"

    cited: dict[str, set[str]] = {}
    for skill in sorted(SKILLS.glob("*.md")):
        # El índice vive bajo «Key `operation_id`s:» y termina con su lista.
        # Acotarlo así evita confundir un nombre de rama (`main`, `qa`) con una
        # ruta sólo porque el renglón también empieza con viñeta y backtick.
        in_index = False
        for line in skill.read_text().splitlines():
            if "operation_id`s" in line:
                in_index = True
                continue
            if in_index and not line.startswith("- "):
                in_index = False
            names = set(re.findall(r"operation_id `([a-z0-9_]+)`", line))
            if in_index:
                names |= set(re.findall(r"`([a-z0-9_]+)`", line.split("—")[0]))
            for name in names:
                cited.setdefault(name, set()).add(skill.name)

    unknown = {n: sorted(f) for n, f in cited.items() if n not in live}
    assert not unknown, f"operation_id citados que no existen en la app: {unknown}"


@pytest.mark.parametrize("banned, instead", [
    ("Plusvalía", "Ganancia no realizada % / Ganancia proyectada %"),
    ("Valuación proyectada", "Venta proyectada"),
    ("Inversión desarrollo", "Obra, permisos y subdivisión"),
    ("meses en cartera", "Plazo real"),
])
def test_the_skills_do_not_teach_a_retired_name(banned, instead):
    """Una skill es lo que otro agente va a copiar. Si conserva un nombre
    retirado, lo reintroduce en la superficie que toque.

    Las líneas que PROHÍBEN el término no cuentan — es el único lugar donde
    tiene que aparecer."""
    offenders = []
    for skill in sorted(SKILLS.glob("*.md")):
        for n, line in enumerate(skill.read_text().splitlines(), 1):
            if banned.lower() in line.lower() and "*" not in line and "«" not in line:
                offenders.append(f"{skill.name}:{n}")
    assert not offenders, (
        f"«{banned}» sigue vivo en {offenders} — el nombre es «{instead}» "
        f"(docs/glosario.md)"
    )
