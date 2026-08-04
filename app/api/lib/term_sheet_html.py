from datetime import datetime
from markupsafe import escape as _esc

from api.lib.prospectus_html import _build_fonts_css


_MONTHS_ES = [
    "", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]


def _fmt_mxn(n: float) -> str:
    return f"${n:,.0f} MXN"


def _calc_return(amount: float, rate: float, months: int) -> float:
    return round(float(amount) * float(rate) * (months / 12))


def build_term_sheet_html(
    prop: dict,
    investor_name: str,
    investment_amount: float,
    rate: float,
) -> str:
    """La carta se levanta contra una propiedad concreta — en la práctica una en
    oferta, el trato al que la firma ya se comprometió. `holdMonths` es
    obligatorio: la ruta lo verifica antes de llamar aquí, porque un plazo
    inventado se propagaría a los tres escenarios de rendimiento.

    Su etiqueta es «Plazo proyectado», el nombre que `holdMonths` tiene en todo
    el sistema (ver docs/glosario.md). «Plazo estimado» lo confundía con el
    plazo real, que es otro campo y otra cosa."""
    # Coerce money at the boundary: callers may pass Decimal (NUMERIC columns),
    # and downstream '+'/'*' below mixes these with float literals.
    investment_amount = float(investment_amount)
    rate = float(rate)

    now = datetime.now()
    month_label = f"{_MONTHS_ES[now.month]} {now.year}"
    year_label = str(now.year)

    hold_months: int = prop["holdMonths"]
    scenarios = [
        ("En tiempo", hold_months),
        ("+6 meses", hold_months + 6),
        ("+12 meses", hold_months + 12),
    ]
    scenario_rows = []
    for label, months in scenarios:
        ret = _calc_return(investment_amount, rate, months)
        total = investment_amount + ret
        scenario_rows.append((label, months, ret, total))

    property_name = _esc(prop.get("name") or "")
    property_address = _esc(prop.get("address") or "")
    investor_escaped = _esc(investor_name)
    rate_pct = f"{rate * 100:.1f}%"

    fonts_css = _build_fonts_css()

    scenario_rows_html = "\n".join(
        f"""        <tr>
          <td>{_esc(label)}</td>
          <td>{months} meses</td>
          <td class="num">{_fmt_mxn(ret)}</td>
          <td class="num">{_fmt_mxn(total)}</td>
        </tr>"""
        for label, months, ret, total in scenario_rows
    )

    return f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<style>
{fonts_css}

@page {{ size: A4; margin: 0; }}
html {{ margin: 0; padding: 0; background: #F2F0EB; }}
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{
  font-family: 'Inter', sans-serif;
  background: #F2F0EB;
  color: #1A1A1A;
  font-size: 12pt;
  line-height: 1.75;
  width: 210mm;
  overflow: hidden;
}}

/* ── Cover ─────────────────────────────────────────────────────────────── */
.cover {{
  height: 297mm;
  background: #1A1A1A;
  padding: 72px 80px;
  page-break-after: always;
  break-after: always;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}}
.cover-main {{}}
.wordmark {{
  font-family: 'Inter', sans-serif;
  font-size: 10pt;
  font-weight: 400;
  letter-spacing: 0.55em;
  text-transform: uppercase;
  color: #F2F0EB;
}}
.cover-prelabel {{
  font-family: 'Inter', sans-serif;
  font-size: 7pt;
  font-weight: 400;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: rgba(242,240,235,0.8);
  margin-bottom: 20px;
}}
.cover-investor {{
  font-family: 'Playfair Display', serif;
  font-size: 36pt;
  font-weight: 400;
  color: #F2F0EB;
  line-height: 1.1;
  margin: 0 0 16px 0;
}}
.cover-property {{
  font-family: 'Inter', sans-serif;
  font-size: 9pt;
  font-weight: 400;
  letter-spacing: 0.08em;
  color: rgba(242,240,235,0.7);
  margin-bottom: 12px;
}}
.cover-meta {{
  font-family: 'Inter', sans-serif;
  font-size: 7pt;
  font-weight: 400;
  letter-spacing: 0.08em;
  color: rgba(242,240,235,0.45);
}}
.cover-footer {{
  font-family: 'Inter', sans-serif;
  font-size: 7pt;
  font-weight: 400;
  letter-spacing: 0.08em;
  color: rgba(242,240,235,0.35);
}}

/* ── Section band ───────────────────────────────────────────────────────── */
.section-band {{
  background: #6B8A5E;
  padding: 24px 80px;
  page-break-after: avoid;
  break-after: avoid;
}}
.band-label {{
  font-family: 'Inter', sans-serif;
  font-size: 7pt;
  font-weight: 400;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: rgba(242,240,235,0.8);
  margin-bottom: 8px;
}}
.band-title {{
  font-family: 'Playfair Display', serif;
  font-size: 30pt;
  font-weight: 400;
  color: #F2F0EB;
  line-height: 1.1;
  margin: 0;
}}

/* ── Page / content sections ────────────────────────────────────────────── */
.page-section {{
  page-break-inside: avoid;
  break-inside: avoid;
}}
.content-section {{
  padding: 48px 80px;
  page-break-inside: avoid;
  break-inside: avoid;
}}

/* ── Section typography ─────────────────────────────────────────────────── */
.section-label {{
  font-family: 'Inter', sans-serif;
  font-size: 7pt;
  font-weight: 400;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #6B6B6B;
  margin-bottom: 12px;
}}
.section-h2 {{
  font-family: 'Playfair Display', serif;
  font-size: 16pt;
  font-weight: 400;
  color: #1A1A1A;
  line-height: 1.2;
  margin: 0 0 20px 0;
}}
p {{
  max-width: 560px;
  margin-bottom: 14px;
  color: #1A1A1A;
}}
strong {{
  color: #6B8A5E;
  font-weight: 500;
}}

/* ── Summary table ──────────────────────────────────────────────────────── */
.summary-table {{
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 0;
  max-width: 560px;
  break-inside: avoid;
}}
.summary-table tr {{
  border-bottom: 1px solid rgba(26,26,26,0.08);
}}
.summary-table tr:last-child {{
  border-bottom: none;
}}
.summary-key {{
  font-family: 'Inter', sans-serif;
  font-size: 7pt;
  font-weight: 400;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #6B6B6B;
  padding: 10px 24px 10px 0;
  width: 38%;
  vertical-align: top;
}}
.summary-val {{
  font-family: 'Inter', sans-serif;
  font-size: 9.5pt;
  color: #1A1A1A;
  padding: 10px 0;
  vertical-align: top;
}}

/* ── Scenario table ─────────────────────────────────────────────────────── */
.scenario-table {{
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 20px;
  break-inside: avoid;
}}
.scenario-table th {{
  font-family: 'Inter', sans-serif;
  font-size: 7pt;
  font-weight: 400;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #6B6B6B;
  padding: 8px 12px 8px 0;
  border-bottom: 1px solid rgba(26,26,26,0.15);
  text-align: left;
}}
.scenario-table td {{
  font-family: 'Inter', sans-serif;
  font-size: 9.5pt;
  color: #1A1A1A;
  padding: 10px 12px 10px 0;
  border-bottom: 1px solid rgba(26,26,26,0.07);
}}
.scenario-table .num {{
  font-family: 'Inter', sans-serif;
  font-size: 9.5pt;
  color: #6B8A5E;
  text-align: right;
  font-weight: 500;
}}
.scenario-note {{
  font-size: 9pt;
  color: #6B6B6B;
  font-style: italic;
  max-width: 480px;
  margin-top: 4px;
}}

/* ── Risks ──────────────────────────────────────────────────────────────── */
.risk-section {{
  border-left: 3px solid #A16A3C;
  padding-left: 44px;
  margin-left: 33px;
}}
.risk-list {{
  display: flex;
  flex-direction: column;
  gap: 16px;
  break-inside: avoid;
}}
.risk-item {{
  break-inside: avoid;
}}
.risk-title {{
  font-family: 'Inter', sans-serif;
  font-size: 8pt;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #A16A3C;
  margin-bottom: 4px;
}}
.risk-body {{
  font-family: 'Inter', sans-serif;
  font-size: 10pt;
  color: #1A1A1A;
  line-height: 1.6;
  max-width: 480px;
}}

/* ── Agreement + signatures ─────────────────────────────────────────────── */
.agreement-block {{
  padding: 48px 80px;
  break-inside: avoid;
  page-break-inside: avoid;
}}
.agreement-text {{
  font-style: italic;
  color: #6B6B6B;
  max-width: 520px;
  margin-bottom: 48px;
}}
.signatures {{
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 64px;
  break-inside: avoid;
}}
.sig-block {{
  break-inside: avoid;
}}
.sig-name {{
  font-family: 'Playfair Display', serif;
  font-size: 13pt;
  font-weight: 400;
  color: #1A1A1A;
  margin-bottom: 40px;
}}
.sig-line {{
  border-bottom: 1px solid #1A1A1A;
  margin-bottom: 10px;
}}
.sig-label {{
  font-family: 'Inter', sans-serif;
  font-size: 7pt;
  font-weight: 400;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #6B6B6B;
  margin-bottom: 8px;
}}
.sig-date {{
  font-family: 'Inter', sans-serif;
  font-size: 9pt;
  color: #6B6B6B;
}}
</style>
</head>
<body>

<!-- PAGE 1: Cover -->
<div class="cover">
  <div class="wordmark">R E F I G A N</div>

  <div class="cover-main">
    <div class="cover-prelabel">Carta de Términos de Inversión · {month_label}</div>
    <h1 class="cover-investor">{investor_escaped}</h1>
    <div class="cover-property">{property_name}</div>
    <div class="cover-meta">Documento Confidencial · Solo para uso del destinatario</div>
  </div>

  <div class="cover-footer">Distribución Restringida · Patrio · {year_label}</div>
</div>

<!-- PAGE 2: Summary + Terms + Scenarios -->
<div class="content-section" style="padding-top: 52px;">
  <div class="section-label">INVERSIÓN</div>
  <h2 class="section-h2">Resumen de la Inversión</h2>
  <table class="summary-table">
    <tr><td class="summary-key">Inversionista</td><td class="summary-val">{investor_escaped}</td></tr>
    <tr><td class="summary-key">Propiedad</td><td class="summary-val">{property_name} · {property_address}</td></tr>
    <tr><td class="summary-key">Capital</td><td class="summary-val">{_fmt_mxn(investment_amount)}</td></tr>
    <tr><td class="summary-key">Rendimiento</td><td class="summary-val">{rate_pct} anual acumulado</td></tr>
    <tr><td class="summary-key">Pago</td><td class="summary-val">Al cierre de venta de la propiedad</td></tr>
    <tr><td class="summary-key">Plazo proyectado</td><td class="summary-val">{hold_months} meses (sujeto a venta de la propiedad)</td></tr>
  </table>
</div>

<div class="page-section">
  <div class="section-band">
    <div class="band-label">TÉRMINOS</div>
    <h2 class="band-title">Condiciones de la Inversión</h2>
  </div>
  <div class="content-section">
    <p><strong>Capital:</strong> {_fmt_mxn(investment_amount)} aportado por el inversionista al inicio del plazo.</p>
    <p><strong>Rendimiento:</strong> {rate_pct} anual acumulado, calculado sobre el capital desde la fecha de inicio hasta la fecha de venta de la propiedad.</p>
    <p><strong>Mecanismo de pago:</strong> El capital y todos los rendimientos acumulados se liquidan en un único pago al cierre de la venta de la propiedad. No existen pagos intermedios ni distribuciones parciales.</p>
    <p><strong>Plazo:</strong> El rendimiento corre desde la fecha de inicio hasta que se concrete la venta. Si la venta se retrasa, el {rate_pct} anual continúa acumulando — un plazo mayor resulta en un mayor rendimiento total para el inversionista.</p>
  </div>
</div>

<div class="page-section">
  <div class="section-band">
    <div class="band-label">PROYECCIÓN</div>
    <h2 class="band-title">Cálculo Ilustrativo del Rendimiento</h2>
  </div>
  <div class="content-section">
    <table class="scenario-table">
      <thead>
        <tr>
          <th>Escenario</th>
          <th>Meses</th>
          <th>Rendimiento Total</th>
          <th>Total a Recibir</th>
        </tr>
      </thead>
      <tbody>
{scenario_rows_html}
      </tbody>
    </table>
    <p class="scenario-note">El rendimiento continúa acumulando a la misma tasa mientras la propiedad no se haya vendido. Un plazo mayor resulta en un mayor rendimiento total.</p>
  </div>
</div>

<!-- PAGE 3: Exit + Risks + Agreement + Signatures -->
<div class="page-section">
  <div class="section-band">
    <div class="band-label">SALIDA</div>
    <h2 class="band-title">Mecanismo de Salida</h2>
  </div>
  <div class="content-section">
    <p>El único evento de salida es la <strong>venta de la propiedad</strong>. No existe un mecanismo de rescate anticipado ni reembolso parcial antes de ese evento.</p>
    <p>Una vez concretada la venta, Patrio liquidará el capital más los rendimientos acumulados dentro de los <strong>5 días hábiles</strong> siguientes al cierre de la operación.</p>
    <p>La fecha de venta no está garantizada y depende de condiciones de mercado fuera del control de Patrio.</p>
  </div>
</div>

<div class="content-section risk-section">
  <div class="section-label">RIESGOS</div>
  <h2 class="section-h2">Riesgos de la Inversión</h2>
  <div class="risk-list">
    <div class="risk-item">
      <div class="risk-title">Riesgo de plazo</div>
      <div class="risk-body">La venta puede tomar más tiempo del estimado. Este plazo está fuera del control de Patrio. El rendimiento sigue acumulando durante cualquier retraso.</div>
    </div>
    <div class="risk-item">
      <div class="risk-title">Iliquidez</div>
      <div class="risk-body">El capital no puede recuperarse antes de la venta de la propiedad. No existe un mercado secundario para esta participación.</div>
    </div>
  </div>
</div>

<div class="agreement-block">
  <div class="section-label">ACUERDO</div>
  <h2 class="section-h2">Límite de Pago</h2>
  <p class="agreement-text">El total a recibir por el inversionista — capital más rendimientos acumulados — está limitado por los recursos netos obtenidos de la venta de la propiedad. En caso de que el producto de la venta sea insuficiente para liquidar el monto completo, el pago quedará acotado a lo disponible de dicha operación. El inversionista acepta estos términos con pleno conocimiento.</p>

  <div class="signatures">
    <div class="sig-block">
      <div class="sig-name">{investor_escaped}</div>
      <div class="sig-line"></div>
      <div class="sig-label">INVERSIONISTA</div>
      <div class="sig-date">Fecha: _______________</div>
    </div>
    <div class="sig-block">
      <div class="sig-name">Patrio</div>
      <div class="sig-line"></div>
      <div class="sig-label">REPRESENTANTE</div>
      <div class="sig-date">Cargo: _______________</div>
    </div>
  </div>
</div>

</body>
</html>"""
