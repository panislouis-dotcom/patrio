"""El catálogo de obra y las plantillas.

NO va anidado bajo una propiedad, al revés que `/api/properties/{id}/budget`, y
la diferencia dice lo que son: un presupuesto no existe sin su obra, mientras que
el catálogo es lo que todas las obras comparten — la memoria de qué partidas
existen y cómo se llaman.

Que compartan memoria y no números es exactamente la línea que este módulo
cuida. Aplicar catálogo a un presupuesto COPIA el texto al renglón; a partir de
ahí el renglón es de la propiedad y editar el catálogo no lo toca. Por eso aquí
no hay una sola ruta que devuelva `property`: nada de lo que se hace en el
catálogo puede mover un peso de ninguna obra. Las que sí lo hacen —aplicar una
plantilla, aplicar un capítulo— viven en `routes/budget.py`, del lado de la
propiedad, y devuelven la ficha recalculada como toda escritura de presupuesto.

BORRAR NO EXISTE PARA EL CATÁLOGO. `DELETE` da de baja lógicamente (`is_active =
FALSE`) y contesta la fila apagada. Un renglón del catálogo borrado de verdad se
llevaría la procedencia de los presupuestos que lo citan, incluidos los de
propiedades ya vendidas.
"""
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from api import budget_catalog_db as catalog
from api.auth import get_current_user
from api.db import get_db

router = APIRouter()


# ─── Bodies ───────────────────────────────────────────────────────────────────

class ChapterCreate(BaseModel):
    name: str
    sortOrder: int = 0


class ChapterUpdate(BaseModel):
    name: Optional[str] = None
    sortOrder: Optional[int] = None
    isActive: Optional[bool] = None


class ItemCreate(BaseModel):
    chapterId: int
    name: str
    unit: str
    sortOrder: int = 0


class ItemUpdate(BaseModel):
    chapterId: Optional[int] = None
    name: Optional[str] = None
    unit: Optional[str] = None
    sortOrder: Optional[int] = None
    isActive: Optional[bool] = None


class PromoteRequest(BaseModel):
    """El renglón suelto que se cura, y las dos formas de curarlo.

    Con `itemId` se LIGA a una partida que ya existe —la fusión, que es la
    operación que de verdad hacía falta— y con `chapterId` se crea en un capítulo
    distinto del que el renglón traía escrito. Sin ninguno de los dos, la partida
    nace en el capítulo que el renglón ya decía."""
    lineId: int
    chapterId: Optional[int] = None
    itemId: Optional[int] = None


class TemplateCreate(BaseModel):
    name: str
    fromBudgetId: Optional[int] = None


class TemplateUpdate(BaseModel):
    name: Optional[str] = None
    notes: Optional[str] = None


# ─── El catálogo ──────────────────────────────────────────────────────────────

@router.get("/api/budget/catalog", operation_id="budget_catalog_get")
def read_catalog(includeInactive: bool = False, _: dict = Depends(get_current_user)):
    """Capítulos con sus partidas. Por omisión solo los vivos: lo apagado sigue
    existiendo —esa es la baja lógica— pero no se ofrece para obra nueva."""
    with get_db() as conn:
        return catalog.get_catalog(conn, include_inactive=includeInactive)


@router.post("/api/budget/catalog/chapters", status_code=201,
             operation_id="budget_catalog_chapter_create")
def create_chapter(body: ChapterCreate, _: dict = Depends(get_current_user)):
    with get_db() as conn:
        return catalog.create_chapter(conn, body.name, body.sortOrder)


@router.patch("/api/budget/catalog/chapters/{chapter_id}",
              operation_id="budget_catalog_chapter_update")
def update_chapter(chapter_id: int, body: ChapterUpdate,
                   _: dict = Depends(get_current_user)):
    with get_db() as conn:
        return catalog.update_chapter(conn, chapter_id, body.model_dump(exclude_unset=True))


@router.delete("/api/budget/catalog/chapters/{chapter_id}",
               operation_id="budget_catalog_chapter_deactivate")
def deactivate_chapter(chapter_id: int, _: dict = Depends(get_current_user)):
    """Da de baja, no borra. Los renglones que lo nombran no se enteran: su
    capítulo es una copia de texto en su propia fila."""
    with get_db() as conn:
        return catalog.deactivate_chapter(conn, chapter_id)


@router.post("/api/budget/catalog/items", status_code=201,
             operation_id="budget_catalog_item_create")
def create_item(body: ItemCreate, _: dict = Depends(get_current_user)):
    with get_db() as conn:
        return catalog.create_item(conn, body.chapterId, body.name, body.unit, body.sortOrder)


@router.patch("/api/budget/catalog/items/{item_id}",
              operation_id="budget_catalog_item_update")
def update_item(item_id: int, body: ItemUpdate, _: dict = Depends(get_current_user)):
    """Corregir el catálogo no toca ningún presupuesto ya capturado — ni el texto
    ni el importe. Es el invariante central de esta fase y no cuesta código:
    instanciar copia, y nada vuelve a leer esta fila."""
    with get_db() as conn:
        return catalog.update_item(conn, item_id, body.model_dump(exclude_unset=True))


@router.delete("/api/budget/catalog/items/{item_id}",
               operation_id="budget_catalog_item_deactivate")
def deactivate_item(item_id: int, _: dict = Depends(get_current_user)):
    with get_db() as conn:
        return catalog.deactivate_item(conn, item_id)


# ─── El precio que se aprendió ────────────────────────────────────────────────

@router.get("/api/budget/catalog/items/{item_id}/price",
            operation_id="budget_catalog_item_price")
def item_price(item_id: int, _: dict = Depends(get_current_user)):
    """Lo que esta partida ha costado de verdad, para mostrarse al capturarla.

    La cifra sugerida es la MEDIANA de lo PAGADO en renglones cerrados de obra
    real —nunca de lo presupuestado, que sería el catálogo aprendiendo el número
    que él mismo puso— y viaja con lo que la respalda: el rango, cuántas
    observaciones son y de cuántas obras, la última vez con su proveedor, y el
    sesgo entre lo presupuestado y lo pagado.

    SIN HISTORIA NO CONTESTA `null` A SECAS. Devuelve la misma forma con las
    cifras en `null` y los contadores en cero, más cuántas obras faltan y cuántos
    renglones ya citan la partida sin haberse cerrado: durante los primeros meses
    ése es el estado normal, y es cuando la pantalla más necesita poder decir qué
    hay que capturar —cerrar los renglones con su cantidad real y sus pagos— para
    que algún día haya algo que sugerir."""
    with get_db() as conn:
        return catalog.item_price(conn, item_id)


# ─── Deduplicación y promoción ────────────────────────────────────────────────

@router.get("/api/budget/catalog/suggest", operation_id="budget_catalog_suggest")
def suggest(name: str, limit: int = 5, lineId: Optional[int] = None,
            _: dict = Depends(get_current_user)):
    """«¿Es la misma que ésta?», para mostrarse mientras alguien escribe.

    `lineId` excluye el renglón que se está editando, para que no se sugiera a sí
    mismo. Al crear una partida nueva no hace falta: todavía no existe."""
    with get_db() as conn:
        return catalog.suggest(conn, name, limit=limit, exclude_line_id=lineId)


@router.get("/api/budget/catalog/promotion-queue",
            operation_id="budget_catalog_promotion_queue")
def promotion_queue(limit: int = 20, _: dict = Depends(get_current_user)):
    """Lo que se ha tecleado suelto, agrupado y ordenado por frecuencia. Ordena,
    no decide: promover es un clic de una persona."""
    with get_db() as conn:
        return catalog.promotion_queue(conn, limit=limit)


@router.post("/api/budget/catalog/promote", status_code=201,
             operation_id="budget_catalog_promote")
def promote(body: PromoteRequest, _: dict = Depends(get_current_user)):
    """Sube un renglón suelto al catálogo y religa hacia atrás su grupo entero.

    Devuelve `{item, created, relinked}`. `relinked` es lo que hace que la
    promoción valga: la partida nace al catálogo con toda la historia que ya
    existía apuntándole, en vez de empezar a contar desde cero."""
    with get_db() as conn:
        return catalog.promote(conn, body.lineId, chapter_id=body.chapterId,
                               item_id=body.itemId)


# ─── Plantillas ───────────────────────────────────────────────────────────────
#
# Una plantilla es un presupuesto sin propiedad, así que su `id` es un id de
# presupuesto y se puede pasar tal cual a `POST /api/properties/{id}/budget/apply`
# — lo mismo que el `id` del presupuesto de otra obra. Ésa es toda la maquinaria
# que hay detrás de «arrancar desde plantilla» y «arrancar desde otra obra».

@router.get("/api/budget/templates", operation_id="budget_templates_list")
def list_templates(_: dict = Depends(get_current_user)):
    with get_db() as conn:
        return catalog.list_templates(conn)


@router.post("/api/budget/templates", status_code=201,
             operation_id="budget_template_create")
def create_template(body: TemplateCreate, _: dict = Depends(get_current_user)):
    """Nace vacía, o copiando cualquier presupuesto: el de una obra —«guarda ésta
    como plantilla»— o el de otra plantilla."""
    with get_db() as conn:
        return catalog.create_template(conn, body.name, from_budget_id=body.fromBudgetId)


@router.get("/api/budget/templates/{template_id}", operation_id="budget_template_get")
def read_template(template_id: int, _: dict = Depends(get_current_user)):
    with get_db() as conn:
        return catalog.get_template(conn, template_id)


@router.patch("/api/budget/templates/{template_id}", operation_id="budget_template_update")
def update_template(template_id: int, body: TemplateUpdate,
                    _: dict = Depends(get_current_user)):
    with get_db() as conn:
        return catalog.update_template(conn, template_id, body.model_dump(exclude_unset=True))


@router.delete("/api/budget/templates/{template_id}", operation_id="budget_template_delete")
def delete_template(template_id: int, _: dict = Depends(get_current_user)):
    """Se borra de verdad, y no contradice la baja lógica del catálogo: después
    de copiar, nada cita a una plantilla. Los renglones que salieron de ella se
    llevaron el texto."""
    with get_db() as conn:
        return catalog.delete_template(conn, template_id)
