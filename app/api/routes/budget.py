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

`budget` viaja junto a `line` porque el total es la suma de los renglones y una
escritura acaba de moverla: devolver solo el renglón tocado dejaría al cliente
recalculando por su cuenta un total que el servidor ya sabe. Antes viajaba por
la razón contraria —toda escritura movía DOS renglones, el que se tocó y el
residual que lo absorbía— y esa segunda mitad ya no existe.
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
    OBJETIVO NO SE RECIBE, se lee. Ese total ya existe —la calculadora lo sembró
    como un renglón al dar de alta la obra, o alguien capturó renglones—, así que
    pedirlo aquí otra vez sería capturar por segunda vez un número que ya está, y
    la única novedad posible sería que las dos capturas discreparan.

    Que el modo sea un campo propio y no «vino un costo, luego es proporcional»
    es lo que evita elegirlo por omisión: un popup incompleto caería a copia
    directa en silencio, con el resultado equivocado y sin nada que se vea roto.

    EL OBJETIVO DIMENSIONA LO COPIADO, no congela el total: los renglones entran
    al tamaño que hace que ELLOS sumen ese objetivo, y se suman a los que ya
    estaban. El total del presupuesto es la suma de sus renglones, aquí como en
    todas partes."""
    budgetId: int
    chapters: Optional[list[str]] = None
    proportional: bool = False


# ─── La respuesta ─────────────────────────────────────────────────────────────

def _written(property_id: int, budget: dict, line: dict | None = None) -> dict:
    """La respuesta de toda escritura, armada en un solo lugar.

    `budgetIncrease` está DEPRECADO y SE QUEDÓ EN CERO, siempre. Lo retira
    **PR 2 · Contract**, el mismo que hace el `DROP COLUMN is_residual`, y por
    la misma razón: el cable necesita la misma disciplina expand/contract que la
    columna. El SPA y el API viajan en UNA imagen —no hay despliegue de frontend
    por separado— pero quien tenga la página abierta durante el rollout está
    corriendo el JS viejo contra el API nuevo, y ESA sesión en vuelo es toda la
    superficie de compatibilidad que hay. Quitarlo hoy la rompería.

    Decía cuánto había REBASADO el detalle al residual —la única forma en que el
    total podía moverse cuando detallar no lo movía— y esa condición ya no puede
    ocurrir: hoy toda escritura mueve el total exactamente su propio importe.
    Reportar el delta de verdad dispararía el toast «El detalle rebasó el
    estimado» del BudgetPanel VIEJO —el de la sesión en vuelo durante el
    rollout— en CADA renglón que se agregue, con un texto que ya no significa
    nada. En HEAD ese aviso ya no existe (murió con el residuo que lo hacía
    posible: `BudgetPanel.tsx:421`, y su ausencia está fijada en
    `BudgetPanel.test.tsx`), y precisamente por eso el cero no se puede quitar
    todavía: el único lector que aún reacciona al delta es el JS que ya no
    volveríamos a escribir. Cero es la respuesta correcta, y el `budget` y la
    `property` que viajan aquí al lado dicen el total con la cifra en la mano."""
    return {
        "line": line,
        "budget": budget,
        "property": properties.get_property(property_id),
        "budgetIncrease": Decimal(0),
    }


def _line_of(budget: dict, line_id: int) -> dict | None:
    return next((line for line in budget["lines"] if line["id"] == line_id), None)


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
    """Detallar: el costo de obra —y con él la inversión total— sube exactamente
    el importe de la partida. El presupuesto es la suma de sus renglones."""
    with get_db() as conn:
        # `exclude_none` aquí y `exclude_unset` en el PATCH, y la diferencia es
        # deliberada: al CREAR, «no vino» y «vino en null» dan la misma fila —la
        # columna nace NULL de todos modos— así que no hay nada que distinguir.
        # Al ACTUALIZAR sí lo hay, y ahí el null es la única forma de vaciar.
        line_id = budget_db.create_line(
            conn, property_id, body.model_dump(exclude_none=True), plan_id=planId)
        budget = budget_db.get_budget(conn, property_id, planId)
    return _written(property_id, budget, _line_of(budget, line_id))


@router.patch("/api/properties/{property_id}/budget/lines/{line_id}",
              operation_id="budget_line_update")
def update_line(property_id: int, line_id: int, body: LineUpdate,
                planId: str | None = None, _: dict = Depends(get_current_user)):
    with get_db() as conn:
        budget_db.update_line(
            conn, property_id, line_id, body.model_dump(exclude_unset=True), plan_id=planId)
        budget = budget_db.get_budget(conn, property_id, planId)
    return _written(property_id, budget, _line_of(budget, line_id))


@router.delete("/api/properties/{property_id}/budget/lines/{line_id}",
               operation_id="budget_line_delete")
def delete_line(property_id: int, line_id: int, planId: str | None = None,
                _: dict = Depends(get_current_user)):
    """Dejar de detallar es lo contrario de detallar: el total baja exactamente
    el importe que el renglón traía."""
    with get_db() as conn:
        line = budget_db.delete_line(conn, property_id, line_id, plan_id=planId)
        budget = budget_db.get_budget(conn, property_id, planId)
    # El renglón viaja tal como estaba: un borrado también es una escritura, y el
    # cliente tiene que poder decir qué fila quitar de la tabla.
    return _written(property_id, budget, line)


# ─── Arrancar desde algo que ya existe ────────────────────────────────────────
#
# La única puerta por la que un presupuesto entero entra a una obra que no es la
# captura manual: el presupuesto de la obra de al lado. COPIA — después no queda
# ninguna liga viva, el renglón lleva su propio texto y su propio importe, y
# editar el origen mañana no mueve un peso de lo que hoy se copió, porque aquí
# el objeto es dinero y tiene lectores fuera de la app.
#
# LOS RENGLONES COPIADOS SE SUMAN A LOS QUE YA HABÍA, y el total sube con ellos
# —es la suma de sus renglones y acaban de llegar renglones—, CON UNA EXCEPCIÓN:
# si lo único que hay en el destino es el estimado que sembró la calculadora al
# nacer la propiedad (`budget_lines.seeded`, sin nada de ejecución encima) y se
# copia el presupuesto entero, ese renglón se REEMPLAZA. El desglose no se agrega
# al estimado, ES el estimado dicho por partidas, y sumarlos contaría dos veces la
# misma obra. La regla vive en `budget_db.apply_budget`, que la explica entera.

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
        copied, skipped = budget_db.apply_budget(
            conn, property_id, body.budgetId, body.chapters,
            proportional=body.proportional, plan_id=planId)
        budget = budget_db.get_budget(conn, property_id, planId)
    return {**_written(property_id, budget),
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

    `lineCount` es lo que de verdad se va a copiar —todos sus renglones; ya no
    hay ninguno que quede fuera— y sin `includeEmpty` los presupuestos sin nada
    copiable no aparecen: uno del que no sale nada no es una respuesta a «de
    dónde puedo copiar» (como DESTINO de empuje sí lo es, y para eso existe la
    bandera). El `id` va directo a `POST .../budget/apply`."""
    with get_db() as conn:
        return budget_db.list_sources(conn, exclude_budget_id=excludeBudgetId,
                                      include_empty=includeEmpty)


# NO HAY RUTA PARA «EL TOTAL». `PUT .../budget/total` movía el residual hasta
# dejar el presupuesto en la cifra que le mandaran, y era la puerta por la que la
# ficha repreciaba obra cotizada a mano. El total es la suma de los renglones: se
# mueve moviendo renglones, con las rutas que ya están arriba.


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
    return _written(property_id, budget)


@router.delete("/api/properties/{property_id}/budget/chapters/{chapter}",
               operation_id="budget_chapter_delete")
def delete_chapter(property_id: int, chapter: str, planId: str | None = None,
                   _: dict = Depends(get_current_user)):
    with get_db() as conn:
        budget_db.delete_chapter(conn, property_id, chapter, plan_id=planId)
        budget = budget_db.get_budget(conn, property_id, planId)
    return _written(property_id, budget)


# ─── Pagos ────────────────────────────────────────────────────────────────────
#
# Un pago no toca el total: pagar no cambia lo que la obra estaba
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
    return _written(property_id, budget, _line_of(budget, line_id))


@router.delete("/api/properties/{property_id}/budget/lines/{line_id}/payments/{payment_id}",
               operation_id="budget_payment_delete")
def delete_payment(property_id: int, line_id: int, payment_id: int,
                   planId: str | None = None, _: dict = Depends(get_current_user)):
    """Un pago mal capturado se borra, no se reescribe: la tabla es append-only
    porque corregir en su lugar borraría que alguna vez se dijo otra cosa."""
    with get_db() as conn:
        budget_db.delete_payment(conn, property_id, line_id, payment_id, plan_id=planId)
        budget = budget_db.get_budget(conn, property_id, planId)
    return _written(property_id, budget, _line_of(budget, line_id))


# ─── Presupuesto-escenario por plan de proyecto (addendum 2026-08-24) ─────────

class PlanBudgetCreate(BaseModel):
    # De dónde nace: `sourceBudgetId` copia de ESE presupuesto (el de la
    # propiedad, el escenario de otro plan — el flujo real muchas veces arma
    # plan a plan y el de la propiedad se llena al final —, o el de otra obra);
    # sin él, `copyFromProperty` (default) copia del de la propiedad; con los
    # dos apagados, nace vacío. La copia es la maquinaria de siempre: copy_lines.
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
    dinero ya capturado no se pisa — y se reporta cuánto entró y cuánto ya
    estaba. El escenario queda intacto: es la propuesta, y la
    propuesta se califica."""
    with get_db() as conn:
        copied, skipped = budget_db.use_plan_budget(conn, property_id, plan_id)
        budget = budget_db.get_budget(conn, property_id)
    return {**_written(property_id, budget),
            "linesAdded": copied, "linesSkipped": skipped}
