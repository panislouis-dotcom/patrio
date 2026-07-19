---
name: flip-quick-look
description: Use when asked to do a quick evaluation or screening of a real estate flip opportunity. Generates a 1-page HTML screening card with key metrics and traffic-light signal.
---

# Flip Quick Look — Screening Template

## Overview

Generates a single-page mobile-first HTML screening card for a real estate flip. Inputs: purchase price, renovation budget, expected sale price, and timeline in months. Output: investment breakdown, operator net profit, annualized ROI, and a traffic-light signal.

## Step 0 — Ask for inputs

Before generating anything, ask:

1. **Precio de compra** — MXN
2. **Presupuesto de obra** — MXN
3. **Precio de venta esperado** — MXN
4. **Plazo estimado** — meses (compra a venta)

If the user provides all four in the same message, proceed directly.

## Step 1 — Read design system

Read `docs/DESIGN.md` for color tokens and typography before generating HTML.

## Step 2 — Calculate in Python

**CRITICAL: Never guess numbers. Always compute with Python.**

```python
# Inputs from user
compra = <PURCHASE_PRICE>
obra = <RENOVATION_BUDGET>
venta = <SALE_PRICE>
meses = <MONTHS>

# Ratios (from Edificio Uno actuals)
adquisicion = compra * 1.065          # precio + closing costs (ISAI, notario, avalúo)
remodelacion = obra * 1.10            # obra + 10% contingencia
comercializacion = (0.03 * venta) + 45_000  # comisión broker + gastos cierre venta

# Core formulas
inversion_total = adquisicion + remodelacion + comercializacion
cuota_inversionista = inversion_total * 0.12 * (meses / 12)
utilidad_operador_bruta = (venta - inversion_total) - cuota_inversionista
utilidad_neta = utilidad_operador_bruta * 0.70   # ISR 30% persona física
roi_anualizado = (utilidad_neta / inversion_total) * (12 / meses)

# Traffic light
if utilidad_neta >= 400_000:
    semaforo = "🟢"
    semaforo_label = "VIABLE"
elif utilidad_neta >= 200_000:
    semaforo = "🟡"
    semaforo_label = "MARGINAL"
else:
    semaforo = "🔴"
    semaforo_label = "NO VIABLE"

# Print all values for use in HTML
print(f"adquisicion: {adquisicion:,.0f}")
print(f"remodelacion: {remodelacion:,.0f}")
print(f"comercializacion: {comercializacion:,.0f}")
print(f"inversion_total: {inversion_total:,.0f}")
print(f"cuota_inversionista: {cuota_inversionista:,.0f}")
print(f"utilidad_operador_bruta: {utilidad_operador_bruta:,.0f}")
print(f"utilidad_neta: {utilidad_neta:,.0f}")
print(f"roi_anualizado: {roi_anualizado:.1%}")
print(f"semaforo: {semaforo} {semaforo_label}")
```

## Step 3 — Generate HTML

Write the HTML file to `files/flip-quick-look.html`. Use this exact structure:

### HTML Template

```html
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Quick Look — [PROPERTY NAME OR ADDRESS]</title>
<style>
@font-face { font-family: 'EB Garamond'; src: url('fonts/eb-garamond-regular.woff2') format('woff2'); }
@font-face { font-family: 'Public Sans'; src: url('fonts/public-sans.woff2') format('woff2'); }
@font-face { font-family: 'Space Grotesk'; src: url('fonts/space-grotesk.woff2') format('woff2'); }

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: 'Public Sans', sans-serif;
  background: #F2F0EB;
  color: #1A2319;
  padding: 16px;
  max-width: 480px;
  margin: 0 auto;
}

.header {
  text-align: center;
  padding: 32px 0 16px;
}

.header h1 {
  font-family: 'EB Garamond', serif;
  font-size: 1.5rem;
  font-weight: 400;
  color: #1A2319;
  margin-bottom: 4px;
}

.header .label {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 0.75rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #7A7260;
}

.signal {
  text-align: center;
  padding: 24px 0;
}

.signal .emoji {
  font-size: 3rem;
  line-height: 1;
}

.signal .signal-label {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 0.75rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #7A7260;
  margin-top: 8px;
}

.hero-metric {
  text-align: center;
  padding: 16px 0 32px;
}

.hero-metric .value {
  font-family: 'EB Garamond', serif;
  font-size: 2.5rem;
  color: #A2571D;
  font-weight: 400;
}

.hero-metric .label {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 0.75rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #7A7260;
  margin-top: 4px;
}

.metrics-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  padding: 16px 0;
}

.metric-card {
  background: white;
  border-radius: 4px;
  padding: 16px;
  text-align: center;
}

.metric-card .value {
  font-family: 'EB Garamond', serif;
  font-size: 1.5rem;
  color: #1A2319;
}

.metric-card .label {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 0.65rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #7A7260;
  margin-top: 4px;
}

.breakdown {
  background: white;
  border-radius: 4px;
  padding: 16px;
  margin-top: 16px;
}

.breakdown h2 {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 0.75rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #7A7260;
  margin-bottom: 12px;
}

.breakdown-row {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid #F2F0EB;
  font-size: 0.9rem;
}

.breakdown-row:last-child {
  border-bottom: none;
}

.breakdown-row.total {
  font-weight: 600;
  border-top: 2px solid #1A2319;
  border-bottom: none;
  padding-top: 12px;
  margin-top: 4px;
}

.assumptions {
  margin-top: 16px;
  padding: 12px 16px;
  background: white;
  border-radius: 4px;
  border-left: 3px solid #6B8A5E;
}

.assumptions p {
  font-size: 0.75rem;
  color: #7A7260;
  line-height: 1.5;
}
</style>
</head>
<body>

<div class="header">
  <div class="label">QUICK LOOK</div>
  <h1>[Property Name]</h1>
</div>

<div class="signal">
  <div class="emoji">[SEMÁFORO EMOJI]</div>
  <div class="signal-label">[SEMÁFORO LABEL]</div>
</div>

<div class="hero-metric">
  <div class="value">$[UTILIDAD_NETA]</div>
  <div class="label">UTILIDAD NETA OPERADOR</div>
</div>

<div class="metrics-grid">
  <div class="metric-card">
    <div class="value">$[INVERSIÓN_TOTAL]</div>
    <div class="label">INVERSIÓN TOTAL</div>
  </div>
  <div class="metric-card">
    <div class="value">[ROI]%</div>
    <div class="label">ROI ANUALIZADO</div>
  </div>
  <div class="metric-card">
    <div class="value">$[CUOTA_INVERSIONISTA]</div>
    <div class="label">CUOTA INVERSIONISTA</div>
  </div>
  <div class="metric-card">
    <div class="value">[MESES] mo</div>
    <div class="label">PLAZO</div>
  </div>
</div>

<div class="breakdown">
  <h2>DESGLOSE DE INVERSIÓN</h2>
  <div class="breakdown-row">
    <span>Adquisición</span>
    <span>$[ADQUISICIÓN]</span>
  </div>
  <div class="breakdown-row">
    <span>Remodelación</span>
    <span>$[REMODELACIÓN]</span>
  </div>
  <div class="breakdown-row">
    <span>Comercialización</span>
    <span>$[COMERCIALIZACIÓN]</span>
  </div>
  <div class="breakdown-row total">
    <span>Total</span>
    <span>$[INVERSIÓN_TOTAL]</span>
  </div>
</div>

<div class="breakdown">
  <h2>CASCADA DE UTILIDAD</h2>
  <div class="breakdown-row">
    <span>Venta</span>
    <span>$[VENTA]</span>
  </div>
  <div class="breakdown-row">
    <span>− Inversión</span>
    <span>$[INVERSIÓN_TOTAL]</span>
  </div>
  <div class="breakdown-row">
    <span>− Cuota inversionista (12% anual)</span>
    <span>$[CUOTA_INVERSIONISTA]</span>
  </div>
  <div class="breakdown-row">
    <span>= Utilidad bruta operador</span>
    <span>$[UTILIDAD_BRUTA]</span>
  </div>
  <div class="breakdown-row">
    <span>− ISR (30%)</span>
    <span>$[ISR]</span>
  </div>
  <div class="breakdown-row total">
    <span>Utilidad neta operador</span>
    <span>$[UTILIDAD_NETA]</span>
  </div>
</div>

<div class="assumptions">
  <p>Adq = precio × 1.065 · Obra + 10% contingencia · Com = 3% venta + $45K · Inversionista 12% anual · ISR 30%</p>
</div>

</body>
</html>
```

### Rules

- Replace ALL bracketed placeholders with computed values
- Format numbers with commas: `$1,234,567`
- ROI as percentage with 1 decimal: `9.9%`
- Property name comes from user input or defaults to "Oportunidad"
- Never use Google Fonts CDN — local `@font-face` only

## Step 4 — Render PDF

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --headless --disable-gpu --no-pdf-header-footer \
  --print-to-pdf=files/flip-quick-look.pdf \
  files/flip-quick-look.html
```

Then open with:
```bash
open files/flip-quick-look.pdf
```

## Step 5 — Announce result

Tell the user the key numbers and the traffic-light result. Keep it brief:

```
🟢 VIABLE — Centro Monterrey
Utilidad neta operador: $561,400
ROI anualizado: 9.9%
Inversión total: $4,520,000
```
