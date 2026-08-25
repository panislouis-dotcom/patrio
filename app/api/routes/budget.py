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
    lo demás se llena celda por celda con autoguardado.

    Captura manual, siempre: no hay de dónde más nacer una partida. Es el hueco
    que el sistema de procesos nunca llenó, donde agregar algo a una obra
    obliga a editar la plantilla de todas.

    `supplierCategoryId` es el OFICIO —de qué tipo de proveedor es la partida— y
    `supplierId` es a quién se le dio. Se saben en ese orden y con semanas de
    diferencia: al presupuestar ya se sabe que es plomería, y quién la hace se
    decide después."""
    chapterName: Optional[str] = None
    name: Optional[str] = None
    unit: str = "lote"
    quantity: float = 0
    unitPrice: float = 0
    supplierCategoryId: Optional[int] = None
    supplierId: Optional[int] = None
    committedAmount: Optional[float] = None
    committedOn: Optional[str] = None
    actualQuantity: Optional[float] = None
    notes: str = ""
    # ¿Crece con el tamaño de la obra? Casi todas sí —de ahí el default— y las
    # que no (permisos, licencias, conexiones) cuestan lo que cuestan. Se captura
    # aquí y no al copiar porque es verdad de la partida, no de una copia.
    isProportional: bool = True


class LineUpdate(BaseModel):
    """Todo opcional: cada celda se guarda al cambiar, y el cuerpo describe SOLO
    lo que cambió.

    Aquí un `null` sí viaja y sí significa algo — «quítalo»— al revés que en la
    ficha, donde vaciar es su propia operación (`clear-fields`). La diferencia
    es que allá se edita con un botón GUARDAR y una caja en blanco quiere decir
    «no la toques», mientras que aquí el selector de proveedor tiene «— Sin
    proveedor» y elegirlo tiene que quitar el proveedor. Por eso la ruta usa
    `exclude_unset` y no `exclude_none`: lo que el cliente no mandó se queda
    fuera, y lo que mandó en null llega como null.

    `supplierCategoryId` se corrige por renglón como cualquier otra celda, y un
    null lo quita. Que un renglón tenga oficio y todavía no proveedor es el
    estado normal de una obra que se está presupuestando, no un renglón a
    medias."""
    chapterName: Optional[str] = None
    name: Optional[str] = None
    unit: Optional[str] = None
    quantity: Optional[float] = None
    unitPrice: Optional[float] = None
    supplierCategoryId: Optional[int] = None
    supplierId: Optional[int] = None
    committedAmount: Optional[float] = None
    committedOn: Optional[str] = None
    actualQuantity: Optional[float] = None
    notes: Optional[str] = None
    isProportional: Optional[bool] = None


class PaymentCreate(BaseModel):
    amount: float
    paidOn: Optional[str] = None
    notes: str = ""


class TotalUpdate(BaseModel):
    amount: float


class ChapterRename(BaseModel):
    name: str


class BudgetApply(BaseModel):
    """El presupuesto de otra obra que se copia sobre éste.

    `chapters` ausente —o `null`— es el presupuesto COMPLETO, que es lo que esta
    ruta hizo siempre. Una lista lo recorta a esos capítulos, tal como el origen
    los nombra: se eligen de los que su propio `GET .../budget` publica, no se
    teclean, así que se comparan exactos.

    Copiar a VARIAS obras es esta misma ruta llamada una vez por destino, no un
    `broadcast`. Cada presupuesto es independiente y la atomicidad correcta es
    por propiedad: si el cuarto destino falla, revertir los otros tres sería
    incorrecto, no seguro.

    `proportional` pide la copia DIMENSIONADA: los importes del origen se ajustan
    al costo de obra que esta propiedad YA tiene —el total de su presupuesto—, en
    vez de entrar tal cual. Es lo único que el cuerpo dice del modo: EL COSTO
    OBJETIVO NO SE RECIBE, se lee. Toda propiedad lo trae ya capturado (la ficha
    lo siembra como `m² × $/m²`), así que pedirlo aquí otra vez sería capturar por
    segunda vez un número que ya existe, y la única novedad posible sería que las
    dos capturas discreparan.

    Que el modo sea un campo propio y no «vino un costo, luego es proporcional»
    es lo que evita elegirlo por omisión: un popup incompleto caería a copia
    directa en silencio, con el resultado equivocado y sin nada que se vea roto.

    EL COSTO OBJETIVO TAMPOCO SE MUEVE. El total del presupuesto sigue siendo la
    suma de sus renglones; lo que la copia proporcional hace es entrar los
    renglones al tamaño que hace que esa suma siga dando el mismo total."""
    budgetId: int
    chapters: Optional[list[str]] = None
    proportional: bool = False


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
def read_budget(property_id: int, planId: str | None = None,
                _: dict = Depends(get_current_user)):
    """`planId` cambia el ámbito al presupuesto-escenario de ese plan (addendum
    2026-08-24). Sin él, el de la propiedad — el único que alimenta finanzas."""
    with get_db() as conn:
        return budget_db.get_budget(conn, property_id, planId)


# ─── Renglones ────────────────────────────────────────────────────────────────

@router.post("/api/properties/{property_id}/budget/lines", status_code=201,
             operation_id="budget_line_create")
def create_line(property_id: int, body: LineCreate, planId: str | None = None,
                _: dict = Depends(get_current_user)):
    """Detallar: la partida sube lo mismo que el residual baja, así que el costo
    de obra —y con él la inversión total— no se mueve un peso."""
    with get_db() as conn:
        # `exclude_none` aquí y `exclude_unset` en el PATCH, y la diferencia es
        # deliberada: al CREAR, «no vino» y «vino en null» dan la misma fila —la
        # columna nace NULL de todos modos— así que no hay nada que distinguir.
        # Al ACTUALIZAR sí lo hay, y ahí el null es la única forma de vaciar.
        line_id, increase = budget_db.create_line(
            conn, property_id, body.model_dump(exclude_none=True), plan_id=planId)
        budget = budget_db.get_budget(conn, property_id, planId)
    return _written(property_id, budget, _line_of(budget, line_id), increase)


@router.patch("/api/properties/{property_id}/budget/lines/{line_id}",
              operation_id="budget_line_update")
def update_line(property_id: int, line_id: int, body: LineUpdate,
                planId: str | None = None, _: dict = Depends(get_current_user)):
    with get_db() as conn:
        increase = budget_db.update_line(
            conn, property_id, line_id, body.model_dump(exclude_unset=True), plan_id=planId)
        budget = budget_db.get_budget(conn, property_id, planId)
    return _written(property_id, budget, _line_of(budget, line_id), increase)


@router.delete("/api/properties/{property_id}/budget/lines/{line_id}",
               operation_id="budget_line_delete")
def delete_line(property_id: int, line_id: int, planId: str | None = None,
                _: dict = Depends(get_current_user)):
    """Dejar de detallar es lo contrario de detallar: el importe vuelve al
    residual y el total tampoco se mueve."""
    with get_db() as conn:
        line = budget_db.delete_line(conn, property_id, line_id, plan_id=planId)
        budget = budget_db.get_budget(conn, property_id, planId)
    # El renglón viaja tal como estaba: un borrado también es una escritura, y el
    # cliente tiene que poder decir qué fila quitar de la tabla.
    return _written(property_id, budget, line, Decimal(0))


# ─── Arrancar desde algo que ya existe ────────────────────────────────────────
#
# La única puerta por la que un presupuesto entero entra a una obra que no es la
# captura manual: el presupuesto de la obra de al lado. COPIA — después no queda
# ninguna liga viva, el renglón lleva su propio texto y su propio importe, y
# editar el origen mañana no mueve un peso de lo que hoy se copió, porque aquí
# el objeto es dinero y tiene lectores fuera de la app.
#
# No mueve el total: los renglones copiados salen del residuo, igual que al
# detallar a mano. `budgetIncrease` solo deja de ser 0 si lo copiado rebasa lo
# que la obra tenía presupuestado, que ya no es detallar sino aumentar el
# presupuesto, y por eso se reporta.

@router.post("/api/properties/{property_id}/budget/apply", status_code=201,
             operation_id="budget_apply")
def apply_budget(property_id: int, body: BudgetApply, planId: str | None = None,
                 _: dict = Depends(get_current_user)):
    """Copia el presupuesto de otra obra sobre éste, o solo los capítulos que se
    pidan.

    LO QUE ESTA OBRA YA TIENE NO SE TOCA. Un renglón del origen cuyo
    `(capítulo, nombre)` ya exista aquí se SALTA, nunca se actualiza: el de acá
    puede traer proveedor, monto comprometido, pagos o cierre, y pisarle el
    precio o la cantidad reescribiría dinero ya capturado sin que nada se vea
    roto. Por eso aplicar dos veces la misma fuente no duplica nada y la segunda
    vez no mueve un peso.

    Y no se hace en silencio: `linesAdded` dice cuántos entraron y `linesSkipped`
    cuántos ya estaban. Un copiado que contesta «listo» sin decir que se saltó la
    mitad es peor que uno que falla.

    CON `proportional` LA COPIA VIENE DIMENSIONADA al costo de obra que esta
    propiedad ya tiene capturado —el total de su presupuesto— en vez de traer los
    importes de la otra. Las partidas marcadas como no proporcionales entran con
    su monto original, y el resto se ajusta para que la suma dé exactamente ese
    costo. El factor lo calcula el servidor contra un total que él mismo lee: el
    cliente no manda ni el objetivo ni el multiplicador.

    LA DEDUP NO CAMBIA EN NINGUNO DE LOS DOS MODOS. Un renglón que ya está aquí
    se salta —no se escala, no se actualiza— por la misma razón de siempre."""
    with get_db() as conn:
        copied, skipped, increase = budget_db.apply_budget(
            conn, property_id, body.budgetId, body.chapters,
            proportional=body.proportional, plan_id=planId)
        budget = budget_db.get_budget(conn, property_id, planId)
    return {**_written(property_id, budget, None, increase),
            "linesAdded": copied, "linesSkipped": skipped}


# ─── De dónde se puede copiar ─────────────────────────────────────────────────
#
# La única ruta de este archivo que NO va anidada bajo una propiedad, y la
# diferencia dice lo que es: no se pregunta por el presupuesto de una obra sino
# por cuáles hay. Tampoco devuelve `property`, porque leer no mueve un peso de
# ninguna — lo que sí lo hace, `apply`, vive arriba, del lado de la propiedad.

@router.get("/api/budget/sources", operation_id="budget_sources_list")
def list_sources(excludeBudgetId: Optional[int] = None,
                 includeEmpty: bool = False,
                 _: dict = Depends(get_current_user)):
    """Los presupuestos entre los que se puede copiar — el de cada obra y los
    escenarios de plan, etiquetados con su plan.

    `lineCount` es lo que de verdad se va a copiar —el residuo queda fuera— y
    sin `includeEmpty` los presupuestos sin nada copiable no aparecen: uno del
    que no sale nada no es una respuesta a «de dónde puedo copiar» (como
    DESTINO de empuje sí lo es, y para eso existe la bandera). El `id` va
    directo a `POST .../budget/apply`."""
    with get_db() as conn:
        return budget_db.list_sources(conn, exclude_budget_id=excludeBudgetId,
                                      include_empty=includeEmpty)


# ─── El total ─────────────────────────────────────────────────────────────────

@router.put("/api/properties/{property_id}/budget/total", operation_id="budget_set_total")
def set_total(property_id: int, body: TotalUpdate, planId: str | None = None,
              _: dict = Depends(get_current_user)):
    """Ajusta cuánto va a costar la obra, moviendo el residual.

    Es la operación que SÍ mueve el total, y existe aparte de detallar
    justamente para que las dos se distingan. Aquí es también donde aterriza la
    calculadora `m² × $/m² × overhead` cuando alguien la vuelve a correr después
    de la captura: produce un número, y el número entra por esta puerta —no por
    un campo que se quede guardado compitiendo con el presupuesto."""
    with get_db() as conn:
        budget_db.set_total(conn, property_id, body.amount, plan_id=planId)
        budget = budget_db.get_budget(conn, property_id, planId)
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
                   planId: str | None = None, _: dict = Depends(get_current_user)):
    with get_db() as conn:
        budget_db.rename_chapter(conn, property_id, chapter, body.name, plan_id=planId)
        budget = budget_db.get_budget(conn, property_id, planId)
    return _written(property_id, budget, None, Decimal(0))


@router.delete("/api/properties/{property_id}/budget/chapters/{chapter}",
               operation_id="budget_chapter_delete")
def delete_chapter(property_id: int, chapter: str, planId: str | None = None,
                   _: dict = Depends(get_current_user)):
    with get_db() as conn:
        budget_db.delete_chapter(conn, property_id, chapter, plan_id=planId)
        budget = budget_db.get_budget(conn, property_id, planId)
    return _written(property_id, budget, None, Decimal(0))


# ─── Pagos ────────────────────────────────────────────────────────────────────
#
# Un pago no toca el residual ni el total: pagar no cambia lo que la obra estaba
# planeada a costar. La brecha entre las dos cifras es la información útil, y
# corregir el presupuestado para que empate sería borrarla.

@router.post("/api/properties/{property_id}/budget/lines/{line_id}/payments",
             status_code=201, operation_id="budget_payment_create")
def add_payment(property_id: int, line_id: int, body: PaymentCreate,
                planId: str | None = None, _: dict = Depends(get_current_user)):
    with get_db() as conn:
        budget_db.add_payment(conn, property_id, line_id, body.amount,
                              paid_on=body.paidOn, notes=body.notes, plan_id=planId)
        budget = budget_db.get_budget(conn, property_id, planId)
    return _written(property_id, budget, _line_of(budget, line_id), Decimal(0))


@router.delete("/api/properties/{property_id}/budget/lines/{line_id}/payments/{payment_id}",
               operation_id="budget_payment_delete")
def delete_payment(property_id: int, line_id: int, payment_id: int,
                   planId: str | None = None, _: dict = Depends(get_current_user)):
    """Un pago mal capturado se borra, no se reescribe: la tabla es append-only
    porque corregir en su lugar borraría que alguna vez se dijo otra cosa."""
    with get_db() as conn:
        budget_db.delete_payment(conn, property_id, line_id, payment_id, plan_id=planId)
        budget = budget_db.get_budget(conn, property_id, planId)
    return _written(property_id, budget, _line_of(budget, line_id), Decimal(0))


# ─── Presupuesto-escenario por plan de proyecto (addendum 2026-08-24) ─────────

class PlanBudgetCreate(BaseModel):
    # De dónde nace: `sourceBudgetId` copia de ESE presupuesto (el de la
    # propiedad, el escenario de otro plan — el flujo real muchas veces arma
    # plan a plan y el de la propiedad se llena al final —, o el de otra obra);
    # sin él, `copyFromProperty` (default) copia del de la propiedad; con los
    # dos apagados, nace vacío. La copia es la maquinaria de siempre:
    # copy_lines, con su residuo asentado.
    copyFromProperty: bool = True
    sourceBudgetId: int | None = None


@router.post("/api/properties/{property_id}/budget/plans/{plan_id}", status_code=201,
             operation_id="budget_plan_create")
def create_plan_budget(property_id: int, plan_id: str, body: PlanBudgetCreate | None = None,
                       _: dict = Depends(get_current_user)):
    """El escenario de un plan nace por acción explícita, nunca al leer."""
    opts = body or PlanBudgetCreate()
    with get_db() as conn:
        if opts.sourceBudgetId is not None:
            source_id = opts.sourceBudgetId
        elif opts.copyFromProperty:
            source_id = budget_db._require_budget(conn, property_id)
        else:
            source_id = None
        _, copied, skipped = budget_db.create_plan_budget(
            conn, property_id, plan_id, source_budget_id=source_id)
        budget = budget_db.get_budget(conn, property_id, plan_id)
    return {"budget": budget, "linesAdded": copied, "linesSkipped": skipped}


@router.post("/api/properties/{property_id}/budget/plans/{plan_id}/use",
             operation_id="budget_plan_use")
def use_plan_budget(property_id: int, plan_id: str, _: dict = Depends(get_current_user)):
    """«Usar este plan»: sus renglones entran al presupuesto de LA PROPIEDAD por
    la misma puerta que copiar de otra obra (apply): deduplicar es saltar — el
    dinero ya capturado no se pisa —, el residuo no viaja, y se reporta cuánto
    entró y cuánto ya estaba. El escenario queda intacto: es la propuesta, y la
    propuesta se califica."""
    with get_db() as conn:
        copied, skipped, increase = budget_db.use_plan_budget(conn, property_id, plan_id)
        budget = budget_db.get_budget(conn, property_id)
    return {**_written(property_id, budget, None, increase),
            "linesAdded": copied, "linesSkipped": skipped}
