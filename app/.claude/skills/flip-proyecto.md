---
name: flip-proyecto
description: Use when asked to generate a full project evaluation template for a real estate flip, extending the Patrio project format with operator/investor economics.
---

# Flip Proyecto — Full Project Evaluation Template

## Overview

Generates a comprehensive mobile-first HTML project evaluation for a committed flip opportunity. Extends the Patrio project format (plantilla_patrio_proyectos.xlsx) with Section 4 rewritten to reflect the operator/investor split model. Includes obra distribution breakdown, timeline, and full financial waterfall.

## Step 0 — Ask for inputs

Before generating anything, ask:

1. **Nombre del proyecto** — e.g., "Casa Centro"
2. **Dirección** — full address
3. **Precio de compra** — MXN
4. **Presupuesto de obra** — MXN
5. **Precio de venta esperado** — MXN
6. **Plazo estimado** — meses (compra a venta)
7. **m² terreno / m² construcción** — optional
8. **Notas adicionales** — optional (e.g., number of units, parking, special conditions)

If the user provides all required inputs in the same message, proceed directly.

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

# === SECTION 1: INVERSIÓN ===
adquisicion = compra * 1.065
remodelacion = obra * 1.10
comercializacion = (0.03 * venta) + 45_000
inversion_total = adquisicion + remodelacion + comercializacion

# === SECTION 2: DISTRIBUCIÓN DE OBRA ===
# Percentages from Edificio Uno actuals
distribucion = {
    "Mano de obra": 0.474,
    "Materiales": 0.309,
    "Herramienta": 0.054,
    "Servicios": 0.050,
    "Mobiliario": 0.047,
    "Ingeniería": 0.038,
    "Escombro": 0.034,
    "Logística": 0.015,
    "Predial": 0.012,
    "Impuestos": 0.006,
    "Otros": 0.004,
}

# Apply to remodelacion budget (includes contingency)
distribucion_montos = {k: round(remodelacion * v) for k, v in distribucion.items()}

# === SECTION 3: TIMELINE ===
# Milestones (user can customize, these are defaults)
# Month 0: Adquisición
# Month 1-X: Obra
# Month X+1: Comercialización
# Month N: Venta

# === SECTION 4: ECONOMÍA OPERADOR / INVERSIONISTA ===
cuota_inversionista = inversion_total * 0.12 * (meses / 12)
utilidad_operador_bruta = (venta - inversion_total) - cuota_inversionista
isr = utilidad_operador_bruta * 0.30
utilidad_neta = utilidad_operador_bruta * 0.70
roi_anualizado = (utilidad_neta / inversion_total) * (12 / meses)

# Investor return
retorno_inversionista = inversion_total + cuota_inversionista
tasa_inversionista_efectiva = (cuota_inversionista / inversion_total) * (12 / meses) * 100

# Summary metrics
margen_bruto = (venta - inversion_total) / venta * 100
multiplo = venta / inversion_total

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

# Print all
print(f"=== INVERSIÓN ===")
print(f"Adquisición: {adquisicion:,.0f}")
print(f"Remodelación: {remodelacion:,.0f}")
print(f"Comercialización: {comercializacion:,.0f}")
print(f"TOTAL: {inversion_total:,.0f}")
print()
print(f"=== DISTRIBUCIÓN OBRA ===")
for k, v in distribucion_montos.items():
    print(f"  {k}: {v:,.0f}")
print()
print(f"=== ECONOMÍA ===")
print(f"Cuota inversionista: {cuota_inversionista:,.0f}")
print(f"Utilidad operador bruta: {utilidad_operador_bruta:,.0f}")
print(f"ISR (30%): {isr:,.0f}")
print(f"Utilidad neta operador: {utilidad_neta:,.0f}")
print(f"ROI anualizado: {roi_anualizado:.1%}")
print(f"Margen bruto: {margen_bruto:.1f}%")
print(f"Múltiplo: {multiplo:.2f}x")
print(f"Semáforo: {semaforo} {semaforo_label}")
```

## Step 3 — Generate HTML

Write the HTML file to `files/flip-proyecto.html`. Use this structure:

### HTML Template

```html
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Proyecto — [PROJECT NAME]</title>
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
  padding-bottom: 64px;
}

/* --- HEADER --- */
.header {
  text-align: center;
  padding: 32px 0 24px;
  border-bottom: 1px solid #7A7260;
  margin-bottom: 32px;
}

.header .wordmark {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 0.65rem;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: #7A7260;
  margin-bottom: 16px;
}

.header h1 {
  font-family: 'EB Garamond', serif;
  font-size: 2rem;
  font-weight: 400;
  color: #1A2319;
}

.header .address {
  font-size: 0.85rem;
  color: #7A7260;
  margin-top: 4px;
}

.header .signal {
  margin-top: 16px;
  font-size: 2rem;
}

.header .signal-label {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 0.7rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #7A7260;
}

/* --- SECTIONS --- */
.section {
  margin-bottom: 32px;
}

.section-label {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 0.7rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #7A7260;
  margin-bottom: 8px;
}

.section h2 {
  font-family: 'EB Garamond', serif;
  font-size: 1.5rem;
  font-weight: 400;
  margin-bottom: 16px;
}

/* --- HERO METRICS --- */
.hero-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 12px;
  margin-bottom: 24px;
}

.hero-metric {
  text-align: center;
  background: white;
  border-radius: 4px;
  padding: 16px 8px;
}

.hero-metric .value {
  font-family: 'EB Garamond', serif;
  font-size: 1.3rem;
  color: #A2571D;
}

.hero-metric .label {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 0.6rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #7A7260;
  margin-top: 4px;
}

/* --- TABLE --- */
.table-card {
  background: white;
  border-radius: 4px;
  padding: 16px;
  margin-bottom: 16px;
}

.table-row {
  display: flex;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid #F2F0EB;
  font-size: 0.9rem;
}

.table-row:last-child {
  border-bottom: none;
}

.table-row.total {
  font-weight: 600;
  border-top: 2px solid #1A2319;
  border-bottom: none;
  padding-top: 12px;
  margin-top: 4px;
}

.table-row.subtotal {
  font-weight: 500;
  color: #A2571D;
}

.table-row .pct {
  font-size: 0.75rem;
  color: #7A7260;
  margin-left: 8px;
}

/* --- DISTRIBUTION BAR --- */
.dist-bar {
  display: flex;
  height: 8px;
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 16px;
}

.dist-bar span {
  display: block;
}

/* --- TIMELINE --- */
.timeline {
  padding-left: 16px;
  border-left: 2px solid #A2571D;
}

.timeline-item {
  padding: 12px 0;
  position: relative;
}

.timeline-item::before {
  content: '';
  position: absolute;
  left: -21px;
  top: 18px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #A2571D;
}

.timeline-item .date {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 0.7rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #7A7260;
}

.timeline-item .desc {
  font-size: 0.9rem;
  margin-top: 2px;
}

/* --- WATERFALL --- */
.waterfall-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid #F2F0EB;
  font-size: 0.9rem;
}

.waterfall-row:last-child {
  border-bottom: none;
}

.waterfall-row.highlight {
  background: #6B8A5E;
  color: white;
  margin: 8px -16px;
  padding: 12px 16px;
  border-radius: 4px;
  border-bottom: none;
  font-weight: 600;
}

.waterfall-row .op {
  color: #7A7260;
  font-size: 0.8rem;
  min-width: 16px;
}

/* --- NOTES --- */
.notes {
  background: white;
  border-radius: 4px;
  padding: 16px;
  border-left: 3px solid #6B8A5E;
  font-size: 0.8rem;
  color: #7A7260;
  line-height: 1.6;
}
</style>
</head>
<body>

<!-- HEADER -->
<div class="header">
  <div class="wordmark">R E F I G A N</div>
  <h1>[PROJECT NAME]</h1>
  <div class="address">[ADDRESS]</div>
  <div class="signal">[SEMÁFORO]</div>
  <div class="signal-label">[SEMÁFORO LABEL] · [MESES] MESES</div>
</div>

<!-- HERO METRICS -->
<div class="hero-row">
  <div class="hero-metric">
    <div class="value">$[UTILIDAD_NETA_SHORT]</div>
    <div class="label">UTILIDAD NETA</div>
  </div>
  <div class="hero-metric">
    <div class="value">[ROI]%</div>
    <div class="label">ROI ANUAL</div>
  </div>
  <div class="hero-metric">
    <div class="value">[MULTIPLO]x</div>
    <div class="label">MÚLTIPLO</div>
  </div>
</div>

<!-- SECTION 1: INVERSIÓN -->
<div class="section">
  <div class="section-label">SECCIÓN 1</div>
  <h2>Inversión</h2>
  <div class="table-card">
    <div class="table-row">
      <span>Adquisición <span class="pct">(precio × 1.065)</span></span>
      <span>$[ADQUISICIÓN]</span>
    </div>
    <div class="table-row">
      <span>Remodelación <span class="pct">(obra + 10%)</span></span>
      <span>$[REMODELACIÓN]</span>
    </div>
    <div class="table-row">
      <span>Comercialización <span class="pct">(3% venta + $45K)</span></span>
      <span>$[COMERCIALIZACIÓN]</span>
    </div>
    <div class="table-row total">
      <span>Inversión total</span>
      <span>$[INVERSIÓN_TOTAL]</span>
    </div>
  </div>
</div>

<!-- SECTION 2: DISTRIBUCIÓN DE OBRA -->
<div class="section">
  <div class="section-label">SECCIÓN 2</div>
  <h2>Distribución de obra</h2>

  <!-- Visual bar -->
  <div class="dist-bar">
    <span style="width:47.4%; background:#6B8A5E;"></span>
    <span style="width:30.9%; background:#A2571D;"></span>
    <span style="width:5.4%; background:#654F6F;"></span>
    <span style="width:5.0%; background:#5C5D8D;"></span>
    <span style="width:4.7%; background:#7A7260;"></span>
    <span style="width:6.6%; background:#1A2319;"></span>
  </div>

  <div class="table-card">
    <div class="table-row">
      <span>Mano de obra <span class="pct">47.4%</span></span>
      <span>$[MANO_OBRA]</span>
    </div>
    <div class="table-row">
      <span>Materiales <span class="pct">30.9%</span></span>
      <span>$[MATERIALES]</span>
    </div>
    <div class="table-row">
      <span>Herramienta <span class="pct">5.4%</span></span>
      <span>$[HERRAMIENTA]</span>
    </div>
    <div class="table-row">
      <span>Servicios <span class="pct">5.0%</span></span>
      <span>$[SERVICIOS]</span>
    </div>
    <div class="table-row">
      <span>Mobiliario <span class="pct">4.7%</span></span>
      <span>$[MOBILIARIO]</span>
    </div>
    <div class="table-row">
      <span>Ingeniería <span class="pct">3.8%</span></span>
      <span>$[INGENIERÍA]</span>
    </div>
    <div class="table-row">
      <span>Escombro <span class="pct">3.4%</span></span>
      <span>$[ESCOMBRO]</span>
    </div>
    <div class="table-row">
      <span>Logística <span class="pct">1.5%</span></span>
      <span>$[LOGÍSTICA]</span>
    </div>
    <div class="table-row">
      <span>Predial <span class="pct">1.2%</span></span>
      <span>$[PREDIAL]</span>
    </div>
    <div class="table-row">
      <span>Impuestos <span class="pct">0.6%</span></span>
      <span>$[IMPUESTOS]</span>
    </div>
    <div class="table-row">
      <span>Otros <span class="pct">0.4%</span></span>
      <span>$[OTROS]</span>
    </div>
    <div class="table-row total">
      <span>Total remodelación</span>
      <span>$[REMODELACIÓN]</span>
    </div>
  </div>
</div>

<!-- SECTION 3: TIMELINE -->
<div class="section">
  <div class="section-label">SECCIÓN 3</div>
  <h2>Timeline</h2>
  <div class="timeline">
    <div class="timeline-item">
      <div class="date">MES 0</div>
      <div class="desc">Adquisición — firma escrituras</div>
    </div>
    <div class="timeline-item">
      <div class="date">MES 1–[MES_OBRA]</div>
      <div class="desc">Remodelación</div>
    </div>
    <div class="timeline-item">
      <div class="date">MES [MES_COMERCIALIZACIÓN]</div>
      <div class="desc">Inicio comercialización</div>
    </div>
    <div class="timeline-item">
      <div class="date">MES [MESES]</div>
      <div class="desc">Venta — exit</div>
    </div>
  </div>
</div>

<!-- SECTION 4: ECONOMÍA OPERADOR / INVERSIONISTA -->
<div class="section">
  <div class="section-label">SECCIÓN 4</div>
  <h2>Economía</h2>

  <div class="table-card">
    <div class="section-label" style="margin-bottom:12px;">CASCADA DE UTILIDAD</div>

    <div class="waterfall-row">
      <span>Venta</span>
      <span>$[VENTA]</span>
    </div>
    <div class="waterfall-row">
      <span><span class="op">−</span> Inversión total</span>
      <span>$[INVERSIÓN_TOTAL]</span>
    </div>
    <div class="waterfall-row">
      <span><span class="op">=</span> Utilidad bruta del deal</span>
      <span>$[UTILIDAD_BRUTA_DEAL]</span>
    </div>
    <div class="waterfall-row">
      <span><span class="op">−</span> Cuota inversionista (12% × [MESES]/12)</span>
      <span>$[CUOTA_INVERSIONISTA]</span>
    </div>
    <div class="waterfall-row">
      <span><span class="op">=</span> Utilidad operador bruta</span>
      <span>$[UTILIDAD_OPERADOR_BRUTA]</span>
    </div>
    <div class="waterfall-row">
      <span><span class="op">−</span> ISR (30%)</span>
      <span>$[ISR]</span>
    </div>
    <div class="waterfall-row highlight">
      <span>Utilidad neta operador</span>
      <span>$[UTILIDAD_NETA]</span>
    </div>
  </div>

  <!-- Investor side -->
  <div class="table-card">
    <div class="section-label" style="margin-bottom:12px;">RETORNO INVERSIONISTA</div>

    <div class="table-row">
      <span>Capital invertido</span>
      <span>$[INVERSIÓN_TOTAL]</span>
    </div>
    <div class="table-row">
      <span>Cuota (12% anual × [MESES] meses)</span>
      <span>$[CUOTA_INVERSIONISTA]</span>
    </div>
    <div class="table-row total">
      <span>Retorno total inversionista</span>
      <span>$[RETORNO_INVERSIONISTA]</span>
    </div>
  </div>

  <!-- Summary -->
  <div class="hero-row" style="margin-top:16px;">
    <div class="hero-metric">
      <div class="value">[ROI]%</div>
      <div class="label">ROI ANUAL</div>
    </div>
    <div class="hero-metric">
      <div class="value">[MARGEN]%</div>
      <div class="label">MARGEN BRUTO</div>
    </div>
    <div class="hero-metric">
      <div class="value">12%</div>
      <div class="label">TASA INVERSIONISTA</div>
    </div>
  </div>
</div>

<!-- NOTES -->
<div class="notes">
  <strong>Supuestos:</strong><br>
  Adq = precio × 1.065 (ISAI + notario + avalúo) · Obra + 10% contingencia · Comercialización = 3% comisión + $45K cierre · Inversionista cobra 12% anual sobre capital · ISR 30% persona física · Distribución de obra basada en ratios reales de Edificio Uno.
</div>

</body>
</html>
```

### Rules

- Replace ALL bracketed placeholders with computed values
- Format numbers with commas: `$1,234,567`
- For hero metrics use abbreviated format if > 1M: `$561K` or `$4.5M`
- ROI and margins as percentage with 1 decimal
- Timeline months are estimates — user can customize
- Default obra period = ~70% of total months (rounded)
- Default comercialización start = obra end
- Never use Google Fonts CDN — local `@font-face` only

## Step 4 — Render PDF

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --headless --disable-gpu --no-pdf-header-footer \
  --print-to-pdf=files/flip-proyecto.pdf \
  files/flip-proyecto.html
```

Then open:
```bash
open files/flip-proyecto.pdf
```

## Step 5 — Announce result

Summarize the key economics:

```
🟢 VIABLE — Casa Centro
─────────────────────────
Inversión total:   $4,520,000
Utilidad neta:     $561,400
ROI anualizado:    9.9%
Cuota inversionista: $678,000
Plazo:             15 meses
```
