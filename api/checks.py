from dataclasses import dataclass
from datetime import date
from typing import Literal


@dataclass
class Issue:
    field: str
    message: str
    severity: Literal["error", "warning"]


def run_checks(p: dict) -> list[Issue]:
    issues: list[Issue] = []

    # Errors
    if not p.get("latitude"):
        issues.append(Issue("latitude", "Coordenada latitud es 0 o faltante", "error"))
    if not p.get("longitude"):
        issues.append(Issue("longitude", "Coordenada longitud es 0 o faltante", "error"))
    if not p.get("landPrice"):
        issues.append(Issue("landPrice", "Precio de terreno es 0", "error"))
    if not p.get("sqmLand"):
        issues.append(Issue("sqmLand", "Superficie de terreno (m²) es 0", "error"))
    if (p.get("roi") or 0) < 0:
        issues.append(Issue("roi", f"ROI negativo ({p['roi']:.1%})", "error"))
    sale = p.get("saleDate", "")
    inv = p.get("investmentDate", "")
    if sale and inv and sale <= inv:
        issues.append(Issue("saleDate", f"Fecha venta ({sale}) ≤ fecha inversión ({inv})", "error"))
    if (p.get("constructionOverhead") or 0) < 1.0:
        issues.append(Issue("constructionOverhead", f"Overhead {p.get('constructionOverhead')} < 1.0", "error"))

    # Warnings
    if not p.get("constructionCostPerSqm"):
        issues.append(Issue("constructionCostPerSqm", "Costo construcción/m² es 0", "warning"))
    if not p.get("rentMonthly"):
        issues.append(Issue("rentMonthly", "Renta mensual proyectada es 0", "warning"))
    if (p.get("acquisitionCostPct") or 0) > 0.10:
        issues.append(Issue("acquisitionCostPct", f"Costos adquisición altos ({p['acquisitionCostPct']:.1%})", "warning"))
    if (p.get("profit") or 0) < 500_000:
        issues.append(Issue("profit", f"Profit < $500k ({p.get('profit', 0):,.0f} MXN)", "warning"))

    return issues
