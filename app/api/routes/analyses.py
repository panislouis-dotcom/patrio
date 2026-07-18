import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.auth import get_current_user
from api.analyzer import analyze_prospect, ProspectNotFound
from api.db import get_db, _row_to_dict

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


class AnalysisRequest(BaseModel):
    prospectId: int
    interventionLevel: str = "media"
    holdingPeriodMonths: int = 12
    transactionCostPct: float = 0.08
    exitPriceSource: str = "calculated"  # "manual" | "calculated" | "blended"
    arvManualOverride: Optional[float] = None

    # Build & Hold
    rentaMensualEstimada: Optional[float] = None
    financiamientoPct: float = 0.60
    tasaInteresCredito: float = 0.13
    plazoCreditoMeses: int = 240
    gastosOperativosPct: float = 0.30


@router.post("/api/analyses", status_code=201, operation_id="analyses_create")
def run_analysis(body: AnalysisRequest, _: dict = Depends(get_current_user)):
    try:
        result = analyze_prospect(
            prospect_id=body.prospectId,
            intervention_level=body.interventionLevel,
            holding_period_months=body.holdingPeriodMonths,
            transaction_cost_pct=body.transactionCostPct,
            exit_price_source=body.exitPriceSource,
            arv_manual_override=body.arvManualOverride,
            renta_mensual_estimada=body.rentaMensualEstimada,
            financiamiento_pct=body.financiamientoPct,
            tasa_interes_credito=body.tasaInteresCredito,
            plazo_credito_meses=body.plazoCreditoMeses,
            gastos_operativos_pct=body.gastosOperativosPct,
        )
        with get_db() as conn:
            row = conn.execute(
                "SELECT * FROM analysis_snapshots WHERE id = %s", (result.snapshot_id,)
            ).fetchone()
        return _parse_snapshot(row)
    except ProspectNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))


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
    prospect_id: Optional[int] = None,
    _: dict = Depends(get_current_user),
):
    query = "SELECT * FROM analysis_snapshots"
    params = []
    if prospect_id is not None:
        query += " WHERE prospect_id = %s"
        params.append(prospect_id)
    query += " ORDER BY generated_at DESC"
    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()
    return [_parse_snapshot(r) for r in rows]
