import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.auth import get_current_user
from api import analyzer
from api.analyzer import analyze_property, PropertyNotFound
from api.db import get_db, _row_to_dict
from api.properties_db import ANALYSIS_STATUSES, get_property

router = APIRouter()


def _parse_snapshot(row) -> dict | None:
    d = _row_to_dict(row)
    if d is None:
        return None
    for key in ("comparableIds", "dataQualityWarnings"):
        if isinstance(d.get(key), str):
            try:
                d[key] = json.loads(d[key])
            except (json.JSONDecodeError, TypeError):
                d[key] = []
    return d


# Los supuestos no se declaran aquí con su número: se toman de api.analyzer,
# que es donde viven con nombre. Repetir el 0.08 en la ruta era tener dos
# lugares que podían discrepar sobre lo que el modelo supone.
class AnalysisRequest(BaseModel):
    propertyId: int
    interventionLevel: str = "media"
    holdingPeriodMonths: int = 12
    transactionCostPct: float = analyzer.DEFAULT_TRANSACTION_COST_PCT
    exitPriceSource: str = "calculated"  # "manual" | "calculated" | "blended"
    arvManualOverride: Optional[float] = None
    listingHaircut: float = analyzer.DEFAULT_LISTING_HAIRCUT
    discountRate: float = analyzer.DEFAULT_DISCOUNT_RATE

    # Build & Hold
    rentaMensualEstimada: Optional[float] = None
    financiamientoPct: float = analyzer.DEFAULT_FINANCIAMIENTO_PCT
    tasaInteresCredito: float = analyzer.DEFAULT_TASA_INTERES_CREDITO
    plazoCreditoMeses: int = analyzer.DEFAULT_PLAZO_CREDITO_MESES
    gastosOperativosPct: float = analyzer.DEFAULT_GASTOS_OPERATIVOS_PCT


@router.post("/api/analyses", status_code=201, operation_id="analyses_create")
def run_analysis(body: AnalysisRequest, _: dict = Depends(get_current_user)):
    prop = get_property(body.propertyId)
    if prop is None:
        raise HTTPException(status_code=404, detail="Propiedad no encontrada")
    # The analyzer prices an acquisition, so it stops making sense once the
    # property is rented or sold — by then the market answer is the rent roll.
    if prop["status"] not in ANALYSIS_STATUSES:
        raise HTTPException(
            status_code=422,
            detail="El analizador aplica hasta la etapa de desarrollo.")
    try:
        result = analyze_property(
            property_id=body.propertyId,
            intervention_level=body.interventionLevel,
            holding_period_months=body.holdingPeriodMonths,
            transaction_cost_pct=body.transactionCostPct,
            exit_price_source=body.exitPriceSource,
            arv_manual_override=body.arvManualOverride,
            listing_haircut=body.listingHaircut,
            discount_rate=body.discountRate,
            renta_mensual_estimada=body.rentaMensualEstimada,
            financiamiento_pct=body.financiamientoPct,
            tasa_interes_credito=body.tasaInteresCredito,
            plazo_credito_meses=body.plazoCreditoMeses,
            gastos_operativos_pct=body.gastosOperativosPct,
        )
    except PropertyNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM analysis_snapshots WHERE id = %s", (result.snapshot_id,)
        ).fetchone()
    return _parse_snapshot(row)


@router.get("/api/analyses/{snapshot_id}", operation_id="analyses_get")
def get_analysis(snapshot_id: int, _: dict = Depends(get_current_user)):
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM analysis_snapshots WHERE id = %s", (snapshot_id,)
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    return _parse_snapshot(row)


@router.get("/api/analyses", operation_id="analyses_list")
def list_analyses(
    property_id: Optional[int] = None,
    _: dict = Depends(get_current_user),
):
    query = "SELECT * FROM analysis_snapshots"
    params = []
    if property_id is not None:
        query += " WHERE property_id = %s"
        params.append(property_id)
    query += " ORDER BY generated_at DESC"
    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()
    return [_parse_snapshot(r) for r in rows]
