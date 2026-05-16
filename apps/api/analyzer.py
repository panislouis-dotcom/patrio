"""
Investment analyzer engine.

Given a prospect, calculates:
1. Market-estimated exit price from active comparables
2. Remodel cost from zone + intervention level
3. ARV (After Repair Value)
4. Flip metrics (ROI, gross margin, IRR)
5. Build & Hold metrics (NOI, cash-on-cash, NPV, IRR over 10 years)
6. Confidence score based on data quality

All results are saved as immutable snapshots in analysis_snapshots.
"""

import json
import math
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Optional

from api.db import get_db


# ─── Exceptions ──────────────────────────────────────

class ProspectNotFound(Exception):
    pass


class InsufficientData(Exception):
    pass


# ─── Result model ────────────────────────────────────

@dataclass
class AnalysisResult:
    snapshot_id: int
    prospect_id: int
    generated_at: str

    # Inputs
    purchase_price: float
    remodel_cost_estimate: float
    remodel_cost_per_m2: float
    intervention_level: str
    transaction_costs: float
    financing_costs: float
    total_cost: float
    holding_period_months: int

    # Exit prices
    exit_price_manual: Optional[float]
    exit_price_calculated_low: Optional[float]
    exit_price_calculated_mid: Optional[float]
    exit_price_calculated_high: Optional[float]
    exit_price_source: str
    exit_price_used: float
    manual_vs_market_delta_pct: Optional[float]
    arv_manual_override: Optional[float]

    # Comparables
    comparable_count: int
    comparable_ids: list[int]
    avg_comp_distance_km: Optional[float]

    # Flip metrics
    gross_margin: Optional[float]
    roi_pct: Optional[float]
    irr_pct: Optional[float]
    cap_rate_pct: Optional[float]

    # Build & Hold metrics
    noi_anual: Optional[float] = None
    debt_service_anual: Optional[float] = None
    cash_flow_anual: Optional[float] = None
    cash_on_cash_yr1_pct: Optional[float] = None
    break_even_months: Optional[int] = None
    npv_10yr: Optional[float] = None
    irr_10yr_pct: Optional[float] = None

    # Confidence
    confidence_score: int = 0
    confidence_level: str = "low"
    confidence_notes: str = ""
    data_quality_warnings: list[str] = field(default_factory=list)

    # Human-readable
    human_summary: str = ""


# ─── Helpers ─────────────────────────────────────────

def _percentile(values: list[float], p: float) -> float:
    """Calculate percentile using linear interpolation."""
    if not values:
        return 0.0
    sorted_v = sorted(values)
    k = (len(sorted_v) - 1) * p
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return sorted_v[int(k)]
    return sorted_v[f] * (c - k) + sorted_v[c] * (k - f)


def _irr_newton(cashflows: list[float], guess: float = 0.1, max_iter: int = 100, tol: float = 1e-6) -> Optional[float]:
    """Calculate IRR using Newton-Raphson method."""
    rate = guess
    for _ in range(max_iter):
        npv = sum(cf / (1 + rate) ** t for t, cf in enumerate(cashflows))
        dnpv = sum(-t * cf / (1 + rate) ** (t + 1) for t, cf in enumerate(cashflows))
        if abs(dnpv) < 1e-12:
            return None
        new_rate = rate - npv / dnpv
        if abs(new_rate - rate) < tol:
            return new_rate
        rate = new_rate
    return None


def _npv(rate: float, cashflows: list[float]) -> float:
    """Net present value."""
    return sum(cf / (1 + rate) ** t for t, cf in enumerate(cashflows))


def _monthly_payment(principal: float, annual_rate: float, months: int) -> float:
    """Fixed monthly payment for an amortizing loan."""
    if annual_rate <= 0 or months <= 0 or principal <= 0:
        return 0.0
    r = annual_rate / 12
    return principal * r * (1 + r) ** months / ((1 + r) ** months - 1)


# ─── Core functions ──────────────────────────────────

def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in km between two lat/lng points."""
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def find_comparables(
    zone_id: int,
    property_type: str = "casa",
    prospect_lat: float | None = None,
    prospect_lng: float | None = None,
    prospect_sqm: float | None = None,
    max_km: float = 5.0,
    listing_haircut: float = 0.06,
) -> tuple[list[dict], float | None]:
    """
    Find active comparables for a zone with distance/size/type filtering.

    Returns (comps, avg_comp_distance_km).
    Applies a 6% listing-to-sale haircut on prices.
    """
    with get_db() as conn:
        rows = conn.execute(
            """SELECT id, price, m2, price_per_m2, lat, lng,
                      listed_at, last_seen_active, property_type
               FROM comparables
               WHERE zone_id = %s
                 AND status = 'active'
                 AND last_seen_active >= NOW() - INTERVAL '6 months'
               ORDER BY captured_at DESC""",
            (zone_id,),
        ).fetchall()

    comps = [dict(r) for r in rows]

    # Filter by property type
    comps = [c for c in comps if (c.get("property_type") or "casa").lower() == property_type.lower()]

    # Filter by size ±25%
    if prospect_sqm and prospect_sqm > 0:
        comps = [
            c for c in comps
            if c.get("m2") and 0.75 * prospect_sqm <= c["m2"] <= 1.25 * prospect_sqm
        ]

    # Filter by distance, attach _dist_km for sorting.
    # Comps without coordinates are kept as valid data (we can't measure distance, not exclude them).
    avg_dist_km: float | None = None
    if prospect_lat is not None and prospect_lng is not None:
        with_dist = []
        no_coords = []
        for c in comps:
            if c.get("lat") is not None and c.get("lng") is not None:
                d = _haversine_km(prospect_lat, prospect_lng, c["lat"], c["lng"])
                if d <= max_km:
                    c["_dist_km"] = round(d, 3)
                    with_dist.append(c)
            else:
                no_coords.append(c)
        comps = sorted(with_dist, key=lambda c: c["_dist_km"]) + no_coords
        if with_dist:
            avg_dist_km = round(sum(c["_dist_km"] for c in with_dist) / len(with_dist), 2)

    # Apply listing-to-sale haircut
    factor = 1.0 - listing_haircut
    for c in comps:
        if c.get("price_per_m2") is not None:
            c["price_per_m2"] = c["price_per_m2"] * factor
        if c.get("price") is not None:
            c["price"] = c["price"] * factor

    return comps, avg_dist_km


def get_remodel_cost(zone_id: int, intervention_level: str) -> dict | None:
    """Get the current remodel cost for a zone + intervention level."""
    with get_db() as conn:
        row = conn.execute(
            """SELECT cost_per_m2_mxn, updated_at
               FROM remodel_costs
               WHERE zone_id = %s AND intervention_level = %s
                 AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)
               ORDER BY valid_from DESC
               LIMIT 1""",
            (zone_id, intervention_level),
        ).fetchone()
    return dict(row) if row else None


def compute_confidence(
    comp_count: int,
    remodel_zone_match: bool,
    remodel_updated_at: Optional[datetime] = None,
    comp_price_per_m2_values: list[float] | None = None,
) -> tuple[int, str, list[str]]:
    """
    Confidence score (0-100) based on data quality.

    Weights:
      - Comparable count:    40 pts (0 comps=0, 3=20, 5=30, 8+=40)
      - Remodel zone match:  20 pts (exact match=20, fallback=5)
      - Remodel freshness:   15 pts (< 90 days=15, < 180=10, older=0)
      - Price dispersion:    25 pts (CV < 0.15=25, < 0.30=15, higher=5)
    """
    score = 0
    notes_parts = []
    warnings = []

    # 1. Comparable count (40 pts)
    if comp_count == 0:
        score += 0
        notes_parts.append("0 comps (0/40)")
        warnings.append("Sin comparables: análisis basado solo en estimación manual")
    elif comp_count < 3:
        score += 10
        notes_parts.append(f"{comp_count} comps insuficientes (10/40)")
        warnings.append(f"Solo {comp_count} comparables, mínimo recomendado: 3")
    elif comp_count < 5:
        pts = 20 + (comp_count - 3) * 5  # 20-30
        score += pts
        notes_parts.append(f"{comp_count} comps (medium) ({pts}/40)")
    else:
        pts = min(40, 30 + (comp_count - 5) * 3)
        score += pts
        notes_parts.append(f"{comp_count} comps ({pts}/40)")

    # 2. Remodel zone match (20 pts)
    if remodel_zone_match:
        score += 20
    else:
        score += 5
        warnings.append("Costo de remodelación no tiene match exacto de zona")

    # 3. Remodel freshness (15 pts)
    if remodel_updated_at:
        now = datetime.now(timezone.utc)
        if remodel_updated_at.tzinfo is None:
            from datetime import timezone as tz
            remodel_updated_at = remodel_updated_at.replace(tzinfo=tz.utc)
        days_old = (now - remodel_updated_at).days
        if days_old <= 90:
            score += 15
        elif days_old <= 180:
            score += 10
        else:
            score += 0
            warnings.append(f"Costos de remodelación tienen {days_old} días sin actualizar (>90)")
    else:
        score += 0
        warnings.append("Sin datos de actualización de costos de remodelación")

    # 4. Price dispersion (25 pts)
    if comp_price_per_m2_values and len(comp_price_per_m2_values) >= 2:
        mean = sum(comp_price_per_m2_values) / len(comp_price_per_m2_values)
        variance = sum((x - mean) ** 2 for x in comp_price_per_m2_values) / len(comp_price_per_m2_values)
        cv = (variance ** 0.5) / mean if mean > 0 else 1.0
        if cv < 0.15:
            score += 25
            notes_parts.append(f"CV={cv:.2f} (baja dispersión, 25/25)")
        elif cv < 0.30:
            score += 15
            notes_parts.append(f"CV={cv:.2f} (dispersión moderada, 15/25)")
        else:
            score += 5
            notes_parts.append(f"CV={cv:.2f} (alta dispersión, 5/25)")
            warnings.append(f"Alta dispersión en precios de comparables (CV={cv:.2f})")
    elif comp_count > 0:
        score += 10
        notes_parts.append("1 comp, dispersión no calculable (10/25)")

    # Confidence level
    if score >= 65:
        level = "high"
    elif score >= 40:
        level = "medium"
    else:
        level = "low"

    notes = f"Score {score}/100 ({level}). " + "; ".join(notes_parts)
    return score, notes, warnings


def analyze_prospect(
    prospect_id: int,
    *,
    intervention_level: str = "media",
    holding_period_months: int = 12,
    transaction_cost_pct: float = 0.08,
    exit_price_source: str = "calculated",
    arv_manual_override: float | None = None,
    # Build & Hold params
    renta_mensual_estimada: float | None = None,
    financiamiento_pct: float = 0.60,
    tasa_interes_credito: float = 0.13,
    plazo_credito_meses: int = 240,
    gastos_operativos_pct: float = 0.30,
    discount_rate: float = 0.10,
) -> AnalysisResult:
    """
    Run full investment analysis on a prospect.

    Returns an AnalysisResult and saves an immutable snapshot.
    """
    now = datetime.now(timezone.utc)
    warnings: list[str] = []

    # ── 1. Load prospect ─────────────────────────────
    with get_db() as conn:
        prospect = conn.execute(
            """SELECT id, name, city, type, sqm_land, sqm_construction, land_price,
                      acquisition_cost_pct, projected_sale, rent_monthly,
                      latitude, longitude
               FROM prospects WHERE id = %s""",
            (prospect_id,),
        ).fetchone()

    if prospect is None:
        raise ProspectNotFound(f"Prospect {prospect_id} not found")

    p = dict(prospect)
    purchase_price = p["land_price"]
    sqm_construction = p["sqm_construction"]
    projected_sale = p["projected_sale"]
    rent_monthly = p["rent_monthly"] or 0

    # Data quality check: projected_sale placeholder
    if projected_sale and projected_sale < purchase_price * 0.10:
        warnings.append(
            f"projected_sale (${projected_sale:,.0f}) parece placeholder "
            f"(< 10% de land_price ${purchase_price:,.0f})"
        )

    # ── 2. Determine zone ────────────────────────────
    city = p["city"]
    zone_map = {
        "Monterrey": "centro_monterrey",
        "San Pedro Garza García": "san_pedro",
    }
    zone_name = zone_map.get(city, "monterrey_general")

    with get_db() as conn:
        zone_row = conn.execute(
            "SELECT id FROM zones WHERE name = %s", (zone_name,)
        ).fetchone()
    if zone_row is None:
        # Fallback
        with get_db() as conn:
            zone_row = conn.execute(
                "SELECT id FROM zones WHERE name = 'monterrey_general'"
            ).fetchone()
        warnings.append(f"Zona '{zone_name}' no encontrada, usando monterrey_general")
    zone_id = zone_row["id"]

    # ── 3. Remodel cost ──────────────────────────────
    # Detect obra_nueva: sqm_construction = 0
    actual_intervention = intervention_level
    remodel_area = sqm_construction
    if sqm_construction == 0:
        actual_intervention = "obra_nueva"
        remodel_area = p["sqm_land"]
        warnings.append("sqm_construction=0 → usando obra_nueva sobre sqm_land")

    remodel_data = get_remodel_cost(zone_id, actual_intervention)
    remodel_zone_match = True
    remodel_updated_at = None

    if remodel_data is None:
        # Fallback to monterrey_general
        with get_db() as conn:
            fallback_zone = conn.execute(
                "SELECT id FROM zones WHERE name = 'monterrey_general'"
            ).fetchone()
        if fallback_zone:
            remodel_data = get_remodel_cost(fallback_zone["id"], actual_intervention)
        remodel_zone_match = False
        warnings.append("Sin costo de remodelación para zona exacta, usando fallback")

    if remodel_data:
        cost_per_m2 = remodel_data["cost_per_m2_mxn"]
        remodel_updated_at = remodel_data.get("updated_at")
    else:
        cost_per_m2 = 9000  # absolute fallback
        warnings.append("Sin datos de remodel_costs, usando $9,000/m² por defecto")

    remodel_cost = remodel_area * cost_per_m2

    # ── 4. Total cost ────────────────────────────────
    transaction_costs = purchase_price * transaction_cost_pct
    total_cost_before_financing = purchase_price + remodel_cost + transaction_costs

    # Financing costs for flip (interest on financed portion during holding)
    financed_amount = total_cost_before_financing * financiamiento_pct
    financing_costs = financed_amount * tasa_interes_credito * (holding_period_months / 12) if financiamiento_pct > 0 else 0
    total_cost = total_cost_before_financing + financing_costs

    # ── 5. Find comparables & calculate exit price ───
    sale_sqm = sqm_construction if sqm_construction > 0 else p["sqm_land"]
    prop_type = (p.get("type") or "casa").lower()
    comps, avg_comp_distance_km = find_comparables(
        zone_id,
        property_type=prop_type,
        prospect_lat=p["latitude"],
        prospect_lng=p["longitude"],
        prospect_sqm=sale_sqm,
    )
    comp_ids = [c["id"] for c in comps]
    comp_ppm2 = [c["price_per_m2"] for c in comps if c.get("price_per_m2")]

    exit_low = exit_mid = exit_high = None
    if len(comp_ppm2) >= 1:
        exit_low = _percentile(comp_ppm2, 0.25) * sale_sqm
        exit_mid = _percentile(comp_ppm2, 0.50) * sale_sqm
        exit_high = _percentile(comp_ppm2, 0.75) * sale_sqm

    # Determine which exit price to use
    if exit_price_source == "calculated" and exit_mid is not None:
        exit_used = arv_manual_override if arv_manual_override else exit_mid
    elif exit_price_source == "manual":
        exit_used = arv_manual_override if arv_manual_override else (projected_sale or 0)
    elif exit_price_source == "blended" and exit_mid is not None and projected_sale:
        exit_used = (exit_mid + projected_sale) / 2
    else:
        # Fallback to manual
        exit_used = arv_manual_override if arv_manual_override else (projected_sale or 0)
        if not arv_manual_override and exit_mid is None:
            warnings.append("Sin comparables ni ARV override: usando projected_sale manual")

    # Delta manual vs market
    delta_pct = None
    if exit_mid and projected_sale and projected_sale > 0:
        delta_pct = round(((projected_sale - exit_mid) / exit_mid) * 100, 2)

    # ── 6. Flip metrics ──────────────────────────────
    gross_margin = exit_used - total_cost if exit_used else None
    # Annualized ROI (CAGR): ((exit/cost)^(12/months) - 1) — always moves with holding period
    roi_pct = round((((exit_used / total_cost) ** (12 / holding_period_months)) - 1) * 100, 2) \
        if exit_used and exit_used > 0 and total_cost > 0 and holding_period_months > 0 else None

    # IRR for flip: -total_cost at t=0, +exit_used at t=holding_period (in years)
    irr_pct = None
    if exit_used and total_cost > 0:
        # Monthly cashflows: invest at month 0, receive at month N
        cashflows = [-total_cost] + [0.0] * (holding_period_months - 1) + [exit_used]
        monthly_irr = _irr_newton(cashflows, guess=0.01)
        if monthly_irr is not None:
            irr_pct = round(((1 + monthly_irr) ** 12 - 1) * 100, 2)

    # ── 7. Build & Hold (10 year analysis) ───────────
    cap_rate_pct = None
    noi_anual = None
    debt_service_anual = None
    cash_flow_anual = None
    cash_on_cash_yr1 = None
    break_even = None
    npv_10yr = None
    irr_10yr = None

    rent_estimate = renta_mensual_estimada or rent_monthly
    if rent_estimate > 0:
        gross_rental_income = rent_estimate * 12
        opex = gross_rental_income * gastos_operativos_pct
        noi_anual = gross_rental_income - opex

        # Cap rate uses NOI (not gross rent), so compute it here after noi_anual
        if noi_anual and noi_anual > 0 and exit_used and exit_used > 0:
            cap_rate_pct = round((noi_anual / exit_used) * 100, 2)

        # Debt service
        loan_amount = total_cost * financiamiento_pct
        equity = total_cost - loan_amount
        if loan_amount > 0:
            monthly_pmt = _monthly_payment(loan_amount, tasa_interes_credito, plazo_credito_meses)
            debt_service_anual = monthly_pmt * 12
        else:
            debt_service_anual = 0.0
            equity = total_cost

        cash_flow_anual = noi_anual - debt_service_anual

        # Cash-on-cash year 1
        if equity > 0:
            cash_on_cash_yr1 = round((cash_flow_anual / equity) * 100, 2)

        # Break-even: months until cumulative cash flow > 0
        if cash_flow_anual > 0:
            monthly_cf = cash_flow_anual / 12
            break_even = math.ceil(equity / monthly_cf) if monthly_cf > 0 else None

        # NPV and IRR over 10 years (annual cashflows)
        # Year 0: -equity, Years 1-9: cash_flow, Year 10: cash_flow + exit_used (sale)
        terminal_value = exit_used if exit_used else 0
        annual_cfs = [-equity] + [cash_flow_anual] * 9 + [cash_flow_anual + terminal_value]
        npv_10yr = round(_npv(discount_rate, annual_cfs), 0)
        irr_10yr_raw = _irr_newton(annual_cfs, guess=0.08)
        if irr_10yr_raw is not None:
            irr_10yr = round(irr_10yr_raw * 100, 2)

    # ── 8. Confidence score ──────────────────────────
    score, conf_notes, conf_warnings = compute_confidence(
        comp_count=len(comps),
        remodel_zone_match=remodel_zone_match,
        remodel_updated_at=remodel_updated_at,
        comp_price_per_m2_values=comp_ppm2,
    )
    warnings.extend(conf_warnings)

    if score >= 65:
        confidence_level = "high"
    elif score >= 40:
        confidence_level = "medium"
    else:
        confidence_level = "low"

    # ── 9. Save snapshot ─────────────────────────────
    with get_db() as conn:
        cur = conn.execute(
            """INSERT INTO analysis_snapshots (
                prospect_id, generated_at,
                purchase_price, remodel_cost_estimate, remodel_cost_per_m2,
                intervention_level, transaction_costs, financing_costs,
                total_cost, holding_period_months,
                exit_price_manual,
                exit_price_calculated_low, exit_price_calculated_mid, exit_price_calculated_high,
                exit_price_source, exit_price_used, manual_vs_market_delta_pct,
                arv_manual_override,
                comparable_count, comparable_ids, avg_comp_distance_km,
                gross_margin, roi_pct, irr_pct, cap_rate_pct,
                confidence_score, confidence_notes, data_quality_warnings,
                renta_mensual_estimada, tasa_interes_credito, plazo_credito_meses,
                financiamiento_pct, gastos_operativos_pct,
                noi_anual, debt_service_anual, cash_flow_anual,
                cash_on_cash_yr1_pct, break_even_months, npv_10yr, irr_10yr_pct
            ) VALUES (
                %s, %s,
                %s, %s, %s,
                %s, %s, %s,
                %s, %s,
                %s,
                %s, %s, %s,
                %s, %s, %s,
                %s,
                %s, %s, %s,
                %s, %s, %s, %s,
                %s, %s, %s,
                %s, %s, %s,
                %s, %s,
                %s, %s, %s,
                %s, %s, %s, %s
            ) RETURNING id""",
            (
                prospect_id, now,
                purchase_price, remodel_cost, cost_per_m2,
                actual_intervention, transaction_costs, financing_costs,
                total_cost, holding_period_months,
                projected_sale,
                exit_low, exit_mid, exit_high,
                exit_price_source if exit_mid is not None else "manual",
                exit_used, delta_pct,
                arv_manual_override,
                len(comps), json.dumps(comp_ids), avg_comp_distance_km,
                gross_margin, roi_pct, irr_pct, cap_rate_pct,
                score, conf_notes, json.dumps(warnings),
                rent_estimate if rent_estimate > 0 else None,
                tasa_interes_credito if rent_estimate > 0 else None,
                plazo_credito_meses if rent_estimate > 0 else None,
                financiamiento_pct if rent_estimate > 0 else None,
                gastos_operativos_pct if rent_estimate > 0 else None,
                noi_anual, debt_service_anual, cash_flow_anual,
                cash_on_cash_yr1, break_even, npv_10yr, irr_10yr,
            ),
        )
        snapshot_id = cur.fetchone()["id"]

    # ── 10. Build human summary ──────────────────────
    summary_parts = [f"Análisis #{snapshot_id} para prospect #{prospect_id}"]
    if roi_pct is not None:
        summary_parts.append(f"ROI flip: {roi_pct:.1f}%")
    if exit_mid:
        summary_parts.append(f"Precio mercado (mediana): ${exit_mid:,.0f}")
    if projected_sale and delta_pct is not None:
        direction = "optimista" if delta_pct > 0 else "pesimista"
        summary_parts.append(f"Manual vs mercado: {delta_pct:+.1f}% ({direction})")
    if cash_on_cash_yr1 is not None:
        summary_parts.append(f"Cash-on-cash yr1: {cash_on_cash_yr1:.1f}%")
    summary_parts.append(f"Confianza: {confidence_level} ({score}/100, {len(comps)} comps)")
    human_summary = ". ".join(summary_parts) + "."

    return AnalysisResult(
        snapshot_id=snapshot_id,
        prospect_id=prospect_id,
        generated_at=now.isoformat(),
        purchase_price=purchase_price,
        remodel_cost_estimate=remodel_cost,
        remodel_cost_per_m2=cost_per_m2,
        intervention_level=actual_intervention,
        transaction_costs=transaction_costs,
        financing_costs=financing_costs,
        total_cost=total_cost,
        holding_period_months=holding_period_months,
        exit_price_manual=projected_sale,
        exit_price_calculated_low=exit_low,
        exit_price_calculated_mid=exit_mid,
        exit_price_calculated_high=exit_high,
        exit_price_source=exit_price_source if exit_mid is not None else "manual",
        exit_price_used=exit_used,
        manual_vs_market_delta_pct=delta_pct,
        arv_manual_override=arv_manual_override,
        comparable_count=len(comps),
        comparable_ids=comp_ids,
        avg_comp_distance_km=avg_comp_distance_km,
        gross_margin=gross_margin,
        roi_pct=roi_pct,
        irr_pct=irr_pct,
        cap_rate_pct=cap_rate_pct,
        noi_anual=noi_anual,
        debt_service_anual=debt_service_anual,
        cash_flow_anual=cash_flow_anual,
        cash_on_cash_yr1_pct=cash_on_cash_yr1,
        break_even_months=break_even,
        npv_10yr=npv_10yr,
        irr_10yr_pct=irr_10yr,
        confidence_score=score,
        confidence_level=confidence_level,
        confidence_notes=conf_notes,
        data_quality_warnings=warnings,
        human_summary=human_summary,
    )
