"""El presupuesto de obra de una propiedad.

Anidado bajo `/api/properties/{id}/budget` porque eso es: el presupuesto no
existe sin su propiedad y no se comparte con ninguna otra. Mismo molde que las
imágenes, y SIN COMPUERTA DE ETAPA — el presupuesto acompaña a la propiedad
desde `prospecto`, como el desglose de costos, no como una herramienta que se
abre en `desarrollo`. Hay que poder presupuestar antes de ofertar.

TODA ESCRITURA DEVUELVE `{line, budget, property}`.

La `property` viene recalculada para que la ficha entera se refresque con un
solo `setProperty`: cambiar una partida cambia el costo de obra, y con él la
inversión total, la ganancia proyectada, el ROI y el cap rate. Sin eso el
cliente tendría que saber qué cifras dependen del presupuesto —o volver a pedir
la propiedad— y esa es plomería que se puede no escribir.

`budget` viaja junto a `line` porque casi toda escritura mueve DOS renglones: el
que se tocó y el residual que lo absorbe. Devolver solo el primero le daría al
cliente la mitad cierta de un presupuesto cuadrado, y la mitad que falta es
justamente la que explica por qué el total no se movió.
"""
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from api import budget_db
from api import properties_db as properties
from api.auth import get_current_user
from api.db import get_db

router = APIRouter()


# ─── Bodies ───────────────────────────────────────────────────────────────────

class LineCreate(BaseModel):
    """Una partida nueva. Capítulo y nombre son obligatorios —una partida sin
    capítulo no se puede agrupar, y una sin nombre no dice qué se va a hacer—;
    lo demás se llena celda por celda con autoguardado."""
    chapterName: str
    name: str
    unit: str = "lote"
    quantity: float = 0
    unitPrice: float = 0
    supplierId: Optional[int] = None
    committedAmount: Optional[float] = None
    committedOn: Optional[str] = None
    actualQuantity: Optional[float] = None
    notes: str = ""


class LineUpdate(BaseModel):
    """Todo opcional: cada celda se guarda al cambiar, y el cuerpo describe SOLO
    lo que cambió.

    Aquí un `null` sí viaja y sí significa algo — «quítalo»— al revés que en la
    ficha, donde vaciar es su propia operación (`clear-fields`). La diferencia
    es que allá se edita con un botón GUARDAR y una caja en blanco quiere decir
    «no la toques», mientras que aquí el selector de proveedor tiene «— Sin
    proveedor» y elegirlo tiene que quitar el proveedor. Por eso la ruta usa
    `exclude_unset` y no `exclude_none`: lo que el cliente no mandó se queda
    fuera, y lo que mandó en null llega como null."""
    chapterName: Optional[str] = None
    name: Optional[str] = None
    unit: Optional[str] = None
    quantity: Optional[float] = None
    unitPrice: Optional[float] = None
    supplierId: Optional[int] = None
    committedAmount: Optional[float] = None
    committedOn: Optional[str] = None
    actualQuantity: Optional[float] = None
    notes: Optional[str] = None


class PaymentCreate(BaseModel):
    amount: float
    paidOn: Optional[str] = None
    notes: str = ""


class TotalUpdate(BaseModel):
    amount: float


class ChapterRename(BaseModel):
    name: str


# ─── La respuesta ─────────────────────────────────────────────────────────────

def _written(property_id: int, budget: dict, line: dict | None,
             budget_increase: Decimal) -> dict:
    """La respuesta de toda escritura, armada en un solo lugar.

    `budgetIncrease` es 0 en el caso normal y solo deja de serlo cuando el
    detalle rebasó el total: ahí el residual llega a 0 y el presupuesto SÍ
    crece. Eso es aumentar el presupuesto, no detallarlo, y se reporta en vez de
    dejarlo pasar en silencio — quien confunde las dos operaciones deja de poder
    contestar si el alcance creció o solo se abrió."""
    return {
        "line": line,
        "budget": budget,
        "property": properties.get_property(property_id),
        "budgetIncrease": budget_increase,
    }


def _line_of(budget: dict, line_id: int) -> dict | None:
    return next((line for line in budget["lines"] if line["id"] == line_id), None)


def _residual_of(budget: dict) -> dict | None:
    return next((line for line in budget["lines"] if line["isResidual"]), None)


# ─── Lectura ──────────────────────────────────────────────────────────────────

@router.get("/api/properties/{property_id}/budget", operation_id="budget_get")
def read_budget(property_id: int, _: dict = Depends(get_current_user)):
    with get_db() as conn:
        return budget_db.get_budget(conn, property_id)


# ─── Renglones ────────────────────────────────────────────────────────────────

@router.post("/api/properties/{property_id}/budget/lines", status_code=201,
             operation_id="budget_line_create")
def create_line(property_id: int, body: LineCreate, _: dict = Depends(get_current_user)):
    """Detallar: la partida sube lo mismo que el residual baja, así que el costo
    de obra —y con él la inversión total— no se mueve un peso."""
    with get_db() as conn:
        line_id, increase = budget_db.create_line(
            conn, property_id, body.model_dump(exclude_none=True))
        budget = budget_db.get_budget(conn, property_id)
    return _written(property_id, budget, _line_of(budget, line_id), increase)


@router.patch("/api/properties/{property_id}/budget/lines/{line_id}",
              operation_id="budget_line_update")
def update_line(property_id: int, line_id: int, body: LineUpdate,
                _: dict = Depends(get_current_user)):
    with get_db() as conn:
        increase = budget_db.update_line(
            conn, property_id, line_id, body.model_dump(exclude_unset=True))
        budget = budget_db.get_budget(conn, property_id)
    return _written(property_id, budget, _line_of(budget, line_id), increase)


@router.delete("/api/properties/{property_id}/budget/lines/{line_id}",
               operation_id="budget_line_delete")
def delete_line(property_id: int, line_id: int, _: dict = Depends(get_current_user)):
    """Dejar de detallar es lo contrario de detallar: el importe vuelve al
    residual y el total tampoco se mueve."""
    with get_db() as conn:
        line = budget_db.delete_line(conn, property_id, line_id)
        budget = budget_db.get_budget(conn, property_id)
    # El renglón viaja tal como estaba: un borrado también es una escritura, y el
    # cliente tiene que poder decir qué fila quitar de la tabla.
    return _written(property_id, budget, line, Decimal(0))


# ─── El total ─────────────────────────────────────────────────────────────────

@router.put("/api/properties/{property_id}/budget/total", operation_id="budget_set_total")
def set_total(property_id: int, body: TotalUpdate, _: dict = Depends(get_current_user)):
    """Ajusta cuánto va a costar la obra, moviendo el residual.

    Es la operación que SÍ mueve el total, y existe aparte de detallar
    justamente para que las dos se distingan. Aquí es también donde aterriza la
    calculadora `m² × $/m² × overhead` cuando alguien la vuelve a correr después
    de la captura: produce un número, y el número entra por esta puerta —no por
    un campo que se quede guardado compitiendo con el presupuesto."""
    with get_db() as conn:
        budget_db.set_total(conn, property_id, body.amount)
        budget = budget_db.get_budget(conn, property_id)
    return _written(property_id, budget, _residual_of(budget), Decimal(0))


# ─── Capítulos ────────────────────────────────────────────────────────────────
#
# Un capítulo es el nombre que copian sus renglones, no una fila: nace al crear
# el primer renglón que lo nombre, y por eso no hay un POST que lo cree vacío.
# Lo que sí necesita puerta propia es renombrarlo y quitarlo — las dos únicas
# operaciones que tocan varios renglones a la vez, y hacerlas una por una
# dejaría el presupuesto a medio renombrar si algo falla en medio.

@router.patch("/api/properties/{property_id}/budget/chapters/{chapter}",
              operation_id="budget_chapter_rename")
def rename_chapter(property_id: int, chapter: str, body: ChapterRename,
                   _: dict = Depends(get_current_user)):
    with get_db() as conn:
        budget_db.rename_chapter(conn, property_id, chapter, body.name)
        budget = budget_db.get_budget(conn, property_id)
    return _written(property_id, budget, None, Decimal(0))


@router.delete("/api/properties/{property_id}/budget/chapters/{chapter}",
               operation_id="budget_chapter_delete")
def delete_chapter(property_id: int, chapter: str, _: dict = Depends(get_current_user)):
    with get_db() as conn:
        budget_db.delete_chapter(conn, property_id, chapter)
        budget = budget_db.get_budget(conn, property_id)
    return _written(property_id, budget, None, Decimal(0))


# ─── Pagos ────────────────────────────────────────────────────────────────────
#
# Un pago no toca el residual ni el total: pagar no cambia lo que la obra estaba
# planeada a costar. La brecha entre las dos cifras es la información útil, y
# corregir el presupuestado para que empate sería borrarla.

@router.post("/api/properties/{property_id}/budget/lines/{line_id}/payments",
             status_code=201, operation_id="budget_payment_create")
def add_payment(property_id: int, line_id: int, body: PaymentCreate,
                _: dict = Depends(get_current_user)):
    with get_db() as conn:
        budget_db.add_payment(conn, property_id, line_id, body.amount,
                              paid_on=body.paidOn, notes=body.notes)
        budget = budget_db.get_budget(conn, property_id)
    return _written(property_id, budget, _line_of(budget, line_id), Decimal(0))


@router.delete("/api/properties/{property_id}/budget/lines/{line_id}/payments/{payment_id}",
               operation_id="budget_payment_delete")
def delete_payment(property_id: int, line_id: int, payment_id: int,
                   _: dict = Depends(get_current_user)):
    """Un pago mal capturado se borra, no se reescribe: la tabla es append-only
    porque corregir en su lugar borraría que alguna vez se dijo otra cosa."""
    with get_db() as conn:
        budget_db.delete_payment(conn, property_id, line_id, payment_id)
        budget = budget_db.get_budget(conn, property_id)
    return _written(property_id, budget, _line_of(budget, line_id), Decimal(0))
