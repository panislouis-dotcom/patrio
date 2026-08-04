"""El directorio de migraciones, como contrato.

Dos migraciones con el mismo número son una migración que no se aplica, y no se
ve: dbmate registra el número pelón, da la segunda por hecha y se la salta sin
error. El porqué completo está en `scripts/check_migration_numbers.py`, que es
donde vive la comprobación — conftest la llama antes de migrar la base de
prueba, y aquí se afirma como prueba con nombre para que salga en la lista y
alguien pueda leer de qué se trata.
"""
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(_ROOT / "scripts"))

import check_migration_numbers as mig  # noqa: E402


def test_ninguna_migracion_comparte_numero_con_otra():
    assert mig.problem() is None, mig.problem()


def test_las_migraciones_van_en_orden_ascendente():
    """El orden en que dbmate las aplica es el de estos números, y ese orden es
    parte del contrato: una migración altera lo que creó otra anterior.

    Los HUECOS son legítimos y se dejan a propósito —renumerar esquivando los
    números que alguna base ya registró los produce—, así que esto no exige que
    sean consecutivos. Solo que el orden de los archivos sea el numérico, que es
    lo que se rompe el día que alguien nombre una con menos dígitos.
    """
    versiones = [v for v, _ in mig.versions()]
    assert versiones == sorted(versiones), (
        "El orden alfabético de los archivos no es el numérico. dbmate aplica en "
        "orden de versión, así que un archivo con distinto ancho de dígitos se "
        f"aplicaría fuera de lugar: {versiones}"
    )
