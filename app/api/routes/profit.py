from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from api.auth import get_current_user
from api.profit_db import (
    get_profit_template, upsert_profit_template,
    get_property_profit, upsert_property_profit,
    compute_waterfall,
)
from api.db import get_team_members
from api.investor_db import get_property_investors
from api.properties_db import PROFIT_STATUSES, get_property

router = APIRouter()


class ProfitConfigUpdate(BaseModel):
    exitPrice: Optional[float] = None
    investorCapital: Optional[float] = None
    investorRateAnnual: Optional[float] = None
    investorMonths: Optional[float] = None
    isrRate: Optional[float] = None
    finderFeePct: Optional[float] = None
    directorPct: Optional[float] = None
    responsablePct: Optional[float] = None
    liderPct: Optional[float] = None
    maestroPct: Optional[float] = None
    ayudantePct: Optional[float] = None
    finderMemberId: Optional[int] = None
    responsableMemberId: Optional[int] = None
    liderMemberId: Optional[int] = None
    maestroMemberIds: Optional[list[int]] = None
    ayudanteMemberIds: Optional[list[int]] = None
    maestroCount: Optional[int] = None
    ayudanteCount: Optional[int] = None
    plannedEndDate: Optional[str] = None
    actualEndDate: Optional[str] = None
    bufferDays: Optional[int] = None
    notes: Optional[str] = None


def _splittable(property_id: int) -> dict:
    """There is nothing to split before the money is committed: the waterfall
    opens with `desarrollo`."""
    prop = get_property(property_id)
    if prop is None:
        raise HTTPException(status_code=404, detail="Propiedad no encontrada")
    if prop["status"] not in PROFIT_STATUSES:
        raise HTTPException(
            status_code=422,
            detail="El reparto de utilidades aplica desde que la propiedad está en desarrollo.")
    return prop


@router.get("/api/profit/template", operation_id="profit_template_get")
def get_template_route(_: dict = Depends(get_current_user)):
    return get_profit_template()


@router.put("/api/profit/template", operation_id="profit_template_update")
def update_template_route(body: ProfitConfigUpdate, _: dict = Depends(get_current_user)):
    return upsert_profit_template(body.model_dump(exclude_unset=True))


@router.get("/api/properties/{property_id}/profit", operation_id="property_profit_get")
def get_property_profit_route(property_id: int, _: dict = Depends(get_current_user)):
    prop = _splittable(property_id)
    config = get_property_profit(property_id)
    waterfall = compute_waterfall(prop, config, get_team_members(),
                                  get_property_investors(property_id))
    return {"config": config, "waterfall": waterfall}


@router.put("/api/properties/{property_id}/profit", operation_id="property_profit_update")
def update_property_profit_route(property_id: int, body: ProfitConfigUpdate,
                                 _: dict = Depends(get_current_user)):
    prop = _splittable(property_id)
    config = upsert_property_profit(property_id, body.model_dump(exclude_unset=True))
    waterfall = compute_waterfall(prop, config, get_team_members(),
                                  get_property_investors(property_id))
    return {"config": config, "waterfall": waterfall}
