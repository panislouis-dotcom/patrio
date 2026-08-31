#!/usr/bin/env python3
"""Deja el `.env` de ESTE worktree listo para entrar a la app.

Un worktree recién creado no tiene `.env` —está en `.gitignore`— así que se
copia de `.env.example`. Encima se vuelcan las credenciales personales, que
viven FUERA del repo (`~/.config/patrio/dev.env`, o `$PATRIO_DEV_ENV`) porque
son secretas y porque así valen para todos los worktrees a la vez: se escriben
una vez y cada árbol nuevo las hereda con un `make dev-env`.

No imprime valores, sólo nombres. Un script que ayuda a manejar secretos y los
escupe al log ya perdió.
"""
import os
import shutil
import sys
from pathlib import Path

PERSONAL = Path(os.environ.get(
    "PATRIO_DEV_ENV", os.path.expanduser("~/.config/patrio/dev.env")))


def parse(text: str) -> dict[str, str]:
    """`KEY=VALUE` por línea. Se ignoran comentarios y líneas sin `=`, y se
    quitan las comillas que envuelven al valor —las pone quien escribe a mano
    para que el shell no se coma un `!`—, no las que van adentro."""
    out: dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.split(" #")[0].strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        out[key.strip()] = value
    return out


def merge(env_text: str, overrides: dict[str, str]) -> str:
    """Reemplaza en su sitio lo que ya está y añade al final lo que falta.

    En su sitio y no al final porque el `.env` está ordenado por secciones con
    sus comentarios, y un valor que aparece dos veces deja al lector sin saber
    cuál gana —dotenv se queda con el último, el shell también, pero eso hay
    que saberlo—.
    """
    lines = env_text.splitlines()
    pending = dict(overrides)
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key = stripped.partition("=")[0].strip()
        if key in pending:
            lines[i] = f"{key}='{pending.pop(key)}'"
    if pending:
        lines.append("")
        lines.append("# ─── Credenciales personales (vertidas por `make dev-env`) ───")
        lines.extend(f"{k}='{v}'" for k, v in pending.items())
    return "\n".join(lines) + "\n"


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    env, example = root / ".env", root / ".env.example"

    if not env.exists():
        if not example.exists():
            print(f"No hay {env} ni {example} de dónde copiarlo.", file=sys.stderr)
            return 1
        shutil.copy(example, env)
        print(f"  .env creado desde .env.example")

    if not PERSONAL.exists():
        print(f"  sin credenciales personales en {PERSONAL} — se deja el .env como está.")
        print(f"  Para fijarlas: escribe ahí SMOKE_EMAIL y SMOKE_PASS (chmod 600).")
        return 0

    overrides = parse(PERSONAL.read_text())
    if not overrides:
        print(f"  {PERSONAL} no define ninguna variable.")
        return 0

    env.write_text(merge(env.read_text(), overrides))
    env.chmod(0o600)
    print(f"  .env <- {PERSONAL}: {', '.join(sorted(overrides))}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
