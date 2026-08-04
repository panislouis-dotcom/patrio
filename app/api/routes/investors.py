from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from api.auth import get_current_user
from api.investor_db import (
    get_investors, get_investor, create_investor, update_investor, delete_investor,
    get_property_investors, add_property_investor, update_property_investment,
    delete_property_investment,
)
from api.properties_db import INVESTOR_STATUSES, get_property

router = APIRouter()


class InvestorCreate(BaseModel):
    name: str
    apellidos: str = ''
    email: str = ''
    phone: str = ''
    notes: str = ''
    temperatura: Optional[str] = None
    capacidad: Optional[str] = None
    fuente: Optional[str] = None
    confianza: Optional[str] = None


class InvestorUpdate(BaseModel):
    name: Optional[str] = None
    apellidos: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    notes: Optional[str] = None
    temperatura: Optional[str] = None
    capacidad: Optional[str] = None
    fuente: Optional[str] = None
    confianza: Optional[str] = None


# `status` no se recibe: el embudo (interesado → comprometido → fondeado) es una
# lectura de los montos, y se deriva en el servidor en cada escritura.
class PropertyInvestorCreate(BaseModel):
    investorId: int
    interestedAmount: float = 0
    committedAmount: float = 0
    fundedAmount: float = 0
    interestRateAnnual: float = 0.12
    investmentDate: Optional[str] = None
    notes: str = ''


class PropertyInvestorUpdate(BaseModel):
    interestedAmount: Optional[float] = None
    committedAmount: Optional[float] = None
    fundedAmount: Optional[float] = None
    interestRateAnnual: Optional[float] = None
    investmentDate: Optional[str] = None
    returnAmount: Optional[float] = None
    returnDate: Optional[str] = None
    notes: Optional[str] = None


# ── Global investor routes ────────────────────────────────────────────────────

@router.get("/api/investors", operation_id="investors_list")
def list_investors(_: dict = Depends(get_current_user)):
    return get_investors()


@router.post("/api/investors", status_code=201, operation_id="investors_create")
def create_investor_route(body: InvestorCreate, _: dict = Depends(get_current_user)):
    return create_investor(body.model_dump())


@router.get("/api/investors/{investor_id}", operation_id="investors_get")
def get_investor_route(investor_id: int, _: dict = Depends(get_current_user)):
    inv = get_investor(investor_id)
    if inv is None:
        raise HTTPException(status_code=404, detail="Investor not found")
    return inv


@router.put("/api/investors/{investor_id}", operation_id="investors_update")
def update_investor_route(investor_id: int, body: InvestorUpdate, _: dict = Depends(get_current_user)):
    inv = get_investor(investor_id)
    if inv is None:
        raise HTTPException(status_code=404, detail="Investor not found")
    return update_investor(investor_id, body.model_dump(exclude_unset=True))


@router.delete("/api/investors/{investor_id}", status_code=204, operation_id="investors_delete")
def delete_investor_route(investor_id: int, _: dict = Depends(get_current_user)):
    inv = get_investor(investor_id)
    if inv is None:
        raise HTTPException(status_code=404, detail="Investor not found")
    delete_investor(investor_id)


# ── Per-property investor routes ──────────────────────────────────────────────

def _fundable(property_id: int) -> dict:
    """The funnel opens at `oferta`: you raise money for a deal you are actually
    bidding on, not for one you are still evaluating."""
    prop = get_property(property_id)
    if prop is None:
        raise HTTPException(status_code=404, detail="Propiedad no encontrada")
    if prop["status"] not in INVESTOR_STATUSES:
        raise HTTPException(
            status_code=422,
            detail="Los inversionistas se suman desde que la propiedad está en oferta.")
    return prop


@router.get("/api/properties/{property_id}/investors", operation_id="property_investors_list")
def list_property_investors(property_id: int, _: dict = Depends(get_current_user)):
    return get_property_investors(property_id)


@router.post("/api/properties/{property_id}/investors", status_code=201,
             operation_id="property_investors_add")
def add_property_investor_route(property_id: int, body: PropertyInvestorCreate,
                                _: dict = Depends(get_current_user)):
    _fundable(property_id)
    data = body.model_dump()
    investor_id = data.pop("investorId")
    return add_property_investor(property_id, investor_id, data)


@router.put("/api/properties/{property_id}/investors/{investment_id}",
            operation_id="property_investment_update")
def update_property_investment_route(property_id: int, investment_id: int,
                                     body: PropertyInvestorUpdate,
                                     _: dict = Depends(get_current_user)):
    try:
        return update_property_investment(investment_id, body.model_dump(exclude_unset=True))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/api/properties/{property_id}/investors/{investment_id}", status_code=204,
               operation_id="property_investment_delete")
def delete_property_investment_route(property_id: int, investment_id: int,
                                     _: dict = Depends(get_current_user)):
    delete_property_investment(investment_id)
