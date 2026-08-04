---
name: generate-term-sheet
description: Use when asked to generate a Carta de Términos de Inversión (investment term sheet) for a specific investor and amount.
---

# Generate Carta de Términos de Inversión

## Overview

Generates a personalized 3-page investment term sheet for a specific investor and capital amount. Complements the prospectus (marketing) with exact deal terms, a return scenario table, risk disclosures, and signature blocks.

**This skill must ask for investor name and amount before generating anything.** These are required — there is no sensible default.

## Step 0 — Ask for inputs

Before reading any file or querying the DB, ask:

1. **Nombre del inversionista** — full name, as it should appear on the document
2. **Monto de inversión** — in MXN pesos

If the user provides both in the same message that invokes the skill, proceed directly. Otherwise, wait for both before continuing.

## Step 1 — Read sources

Read these before touching the DB or writing HTML:

- `docs/glosario.md` — the name of every number. The letter names a property's
  term, and it must call it what the app calls it.
- `docs/DESIGN.md` — color tokens, typography
- `db/schema.sql` — field names before querying

## Step 2 — Pick the property

**The pool is `oferta`.** A term sheet commits the firm to terms, so it is raised against a deal the firm is actually bidding on — never against a `prospecto` it is still evaluating. Within that pool, the highest projected ROI wins.

Use the API rather than SQL: it returns `projectedRoi`, `totalInvestment` and `capRate` already computed, and re-deriving them in a query is how the letter ends up disagreeing with the app.

```bash
curl -s "$REFIGAN_API/api/properties?status=oferta" -H "Authorization: Bearer $REFIGAN_API_KEY" \
  | jq 'max_by(.projectedRoi // 0)
        | {name, address, holdMonths, totalInvestment, projectedSale, projectedRoi, capRate}'
```

If the user names a property, use that one instead — but check its status and say so out loud if it is not in `oferta`.

**`holdMonths` is mandatory.** It is the **Plazo proyectado** — the spine of the
document: the summary declares it and all three return scenarios are computed on
it. If it is `null`, stop and ask for the term. Never substitute a default — an
invented term propagates into every number on page 2.

Call it *Plazo proyectado*, not *Plazo estimado*: `holdMonthsActual` is the
**Plazo real**, a different field measuring a different thing, and one letter
should not make the reader guess which of the two they are being quoted.

> **Shortcut:** `POST /api/documents/term-sheet` (operation_id `documents_term_sheet`) with `{"investor_name", "investment_amount", "property_id": null, "rate"}` applies exactly this selection rule and renders the PDF. Use this skill when the letter's content or layout needs to change.

## Step 3 — Calculate return scenarios in Python

**CRITICAL: Never eyeball or estimate numbers. Use Python.**

```python
# Inputs
amount = <INVESTOR_AMOUNT>  # from user
rate = 0.12  # annual

# From DB: hold_months is an integer — use directly
base_months = <HOLD_MONTHS>  # from DB query result

def calc_return(amount, months):
    return round(amount * rate * (months / 12))

def fmt(n):
    return f"${n:,.0f}"

scenarios = [
    ("En tiempo", base_months),
    ("+6 meses", base_months + 6),
    ("+12 meses", base_months + 12),
]

for label, months in scenarios:
    ret = calc_return(amount, months)
    total = amount + ret
    print(f"{label}: {months} meses | Rendimiento: {fmt(ret)} | Total: {fmt(total)}")

print(f"Capital: {fmt(amount)}")
```

Print all values and embed them directly in the HTML. Do not re-calculate in your head.

## Step 4 — Write the HTML

Build a single HTML file. Use Python to write it (avoids bash escaping issues with Spanish characters):

```python
html = """<!DOCTYPE html>..."""
with open('/tmp/term_sheet_XXXXXX.html', 'w') as f:
    f.write(html)
```

### Font declarations — always @font-face, never CDN

```css
@font-face {
  font-family: 'Playfair Display';
  font-style: normal;
  font-weight: 400;
  src: url('file:///Users/eduardo/Documents/repos/patrio/app/api/fonts/playfair-display-regular.woff2') format('woff2');
}
@font-face {
  font-family: 'Playfair Display';
  font-style: italic;
  font-weight: 400;
  src: url('file:///Users/eduardo/Documents/repos/patrio/app/api/fonts/playfair-display-italic.woff2') format('woff2');
}
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 100 900;
  src: url('file:///Users/eduardo/Documents/repos/patrio/app/api/fonts/inter-400.woff2') format('woff2');
}
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 300 700;
  src: url('file:///Users/eduardo/Documents/repos/patrio/app/api/fonts/inter-600.woff2') format('woff2');
}
```

### Global CSS

```css
@page { size: A4; margin: 0; }

body {
  font-family: 'Inter', sans-serif;
  background: #F2F0EB;
  color: #1A1A1A;
  font-size: 12pt;
  line-height: 1.75;
  margin: 0;
}
```

### Cover — Page 1

Dark full-bleed page. Three direct flex children: wordmark (top), cover-main (middle), cover-footer (bottom).

```css
.cover {
  height: 297mm;
  background: #1A1A1A;
  padding: 72px 80px;
  page-break-after: always;
  break-after: always;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}
/* cover-main: NO flex rules — space-between on parent handles placement */
.cover-main {}
```

```html
<div class="cover">
  <div class="wordmark">R E F I G A N</div>

  <div class="cover-main">
    <div class="cover-prelabel">Carta de Términos de Inversión · [Mes Año]</div>
    <h1 class="cover-investor">[Nombre del Inversionista]</h1>
    <div class="cover-property">[Nombre de la Propiedad]</div>
    <div class="cover-meta">Documento Confidencial · Solo para uso del destinatario</div>
  </div>

  <div class="cover-footer">Distribución Restringida · Patrio · [Año]</div>
</div>
```

```css
.wordmark {
  font-family: 'Inter', sans-serif;
  font-size: 10pt;
  font-weight: 400;
  letter-spacing: 0.55em;
  text-transform: uppercase;
  color: #F2F0EB;
}
.cover-prelabel {
  font-family: 'Inter', sans-serif;
  font-size: 7pt;
  font-weight: 400;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: rgba(242,240,235,0.8);
  margin-bottom: 20px;
}
.cover-investor {
  font-family: 'Playfair Display', serif;
  font-size: 36pt;
  font-weight: 400;
  color: #F2F0EB;
  line-height: 1.1;
  margin: 0 0 16px 0;
}
.cover-property {
  font-family: 'Inter', sans-serif;
  font-size: 9pt;
  font-weight: 400;
  letter-spacing: 0.08em;
  color: rgba(242,240,235,0.7);
  margin-bottom: 12px;
}
.cover-meta {
  font-family: 'Inter', sans-serif;
  font-size: 7pt;
  font-weight: 400;
  letter-spacing: 0.08em;
  color: rgba(242,240,235,0.45);
}
.cover-footer {
  font-family: 'Inter', sans-serif;
  font-size: 7pt;
  font-weight: 400;
  letter-spacing: 0.08em;
  color: rgba(242,240,235,0.35);
}
```

### Band component — all bands sage

**Difference from prospectus:** every section band uses the same sage green `#6B8A5E`. This creates a contractual, document-like uniformity rather than the prospectus's varied editorial colors.

```css
.section-band {
  background: #6B8A5E;
  padding: 24px 80px;
  page-break-after: avoid;
  break-after: avoid;
}
.band-label {
  font-family: 'Inter', sans-serif;
  font-size: 7pt;
  font-weight: 400;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: rgba(242,240,235,0.8);
  margin-bottom: 8px;
}
.band-title {
  font-family: 'Playfair Display', serif;
  font-size: 30pt;
  font-weight: 400;
  color: #F2F0EB;
  line-height: 1.1;
  margin: 0;
}
```

```html
<div class="section-band">
  <div class="band-label">TÉRMINOS</div>
  <h2 class="band-title">Condiciones de la Inversión</h2>
</div>
```

### Content section wrapper

```css
.page-section {
  page-break-inside: avoid;
  break-inside: avoid;
}
.content-section {
  padding: 48px 80px;
  page-break-inside: avoid;
  break-inside: avoid;
}
```

Always wrap each `section-band` + `content-section` pair in a `.page-section`:

```html
<div class="page-section">
  <div class="section-band">...</div>
  <div class="content-section">...</div>
</div>
```

### Section typography

```css
.section-label {
  font-family: 'Inter', sans-serif;
  font-size: 7pt;
  font-weight: 400;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #6B6B6B;
  margin-bottom: 12px;
}
.section-h2 {
  font-family: 'Playfair Display', serif;
  font-size: 16pt;
  font-weight: 400;
  color: #1A1A1A;
  line-height: 1.2;
  margin: 0 0 20px 0;
}
p {
  max-width: 560px;
  margin-bottom: 14px;
  color: #1A1A1A;
}
```

### Page 2 — Summary table + Terms + Return scenarios

**Section 1: Resumen de la Inversión** (no band, plain content at top of page)

```html
<div class="content-section" style="padding-top: 52px;">
  <div class="section-label">INVERSIÓN</div>
  <h2 class="section-h2">Resumen de la Inversión</h2>
  <table class="summary-table">
    <tr><td class="summary-key">Inversionista</td><td class="summary-val">[Nombre completo]</td></tr>
    <tr><td class="summary-key">Propiedad</td><td class="summary-val">[Nombre] · [Dirección]</td></tr>
    <tr><td class="summary-key">Capital</td><td class="summary-val">$[Monto] MXN</td></tr>
    <tr><td class="summary-key">Rendimiento</td><td class="summary-val">12.0% anual acumulado</td></tr>
    <tr><td class="summary-key">Pago</td><td class="summary-val">Al cierre de venta de la propiedad</td></tr>
    <tr><td class="summary-key">Plazo proyectado</td><td class="summary-val">[N] meses (sujeto a venta de la propiedad)</td></tr>
  </table>
</div>
```

```css
.summary-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 0;
  max-width: 560px;
  break-inside: avoid;
}
.summary-table tr {
  border-bottom: 1px solid rgba(26,26,26,0.08);
}
.summary-table tr:last-child {
  border-bottom: none;
}
.summary-key {
  font-family: 'Inter', sans-serif;
  font-size: 7pt;
  font-weight: 400;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #6B6B6B;
  padding: 10px 24px 10px 0;
  width: 38%;
  vertical-align: top;
}
.summary-val {
  font-family: 'Inter', sans-serif;
  font-size: 9.5pt;
  color: #1A1A1A;
  padding: 10px 0;
  vertical-align: top;
}
```

**Section 2: Términos de la Inversión** (sage band)

```html
<div class="page-section">
  <div class="section-band">
    <div class="band-label">TÉRMINOS</div>
    <h2 class="band-title">Condiciones de la Inversión</h2>
  </div>
  <div class="content-section">
    <p><strong>Capital:</strong> $[Monto] MXN aportado por el inversionista al inicio del plazo.</p>
    <p><strong>Rendimiento:</strong> 12% anual acumulado, calculado sobre el capital desde la fecha de inicio hasta la fecha de venta de la propiedad.</p>
    <p><strong>Mecanismo de pago:</strong> El capital y todos los rendimientos acumulados se liquidan en un único pago al cierre de la venta de la propiedad. No existen pagos intermedios ni distribuciones parciales.</p>
    <p><strong>Plazo:</strong> El rendimiento corre desde la fecha de inicio hasta que se concrete la venta. Si la venta se retrasa, el 12% anual continúa acumulando — un plazo mayor resulta en un mayor rendimiento total para el inversionista.</p>
  </div>
</div>
```

```css
strong {
  color: #6B8A5E;  /* sage — matches bands, reads as "term label" */
  font-weight: 500;
}
```

**Section 3: Cálculo Ilustrativo del Rendimiento** (below terms, same page)

```html
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
        <tr>
          <td>En tiempo</td>
          <td>[N] meses</td>
          <td class="num">[Rendimiento base]</td>
          <td class="num">[Capital + rendimiento base]</td>
        </tr>
        <tr>
          <td>+6 meses de retraso</td>
          <td>[N+6] meses</td>
          <td class="num">[Rendimiento +6]</td>
          <td class="num">[Total +6]</td>
        </tr>
        <tr>
          <td>+12 meses de retraso</td>
          <td>[N+12] meses</td>
          <td class="num">[Rendimiento +12]</td>
          <td class="num">[Total +12]</td>
        </tr>
      </tbody>
    </table>
    <p class="scenario-note">El rendimiento continúa acumulando a la misma tasa mientras la propiedad no se haya vendido. Un plazo mayor resulta en un mayor rendimiento total.</p>
  </div>
</div>
```

```css
.scenario-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 20px;
  break-inside: avoid;
}
.scenario-table th {
  font-family: 'Inter', sans-serif;
  font-size: 7pt;
  font-weight: 400;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #6B6B6B;
  padding: 8px 12px 8px 0;
  border-bottom: 1px solid rgba(26,26,26,0.15);
  text-align: left;
}
.scenario-table td {
  font-family: 'Inter', sans-serif;
  font-size: 9.5pt;
  color: #1A1A1A;
  padding: 10px 12px 10px 0;
  border-bottom: 1px solid rgba(26,26,26,0.07);
}
.scenario-table .num {
  font-family: 'Inter', sans-serif;
  font-size: 9.5pt;
  color: #6B8A5E;
  text-align: right;
  font-weight: 500;
}
.scenario-note {
  font-size: 9pt;
  color: #6B6B6B;
  font-style: italic;
  max-width: 480px;
  margin-top: 4px;
}
```

### Page 3 — Exit + Risks + Agreement + Signatures

**Section 4: Mecanismo de Salida** (sage band)

```html
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
```

**Section 5: Riesgos de la Inversión** (terracotta left border — same treatment as impact block in prospectus)

```html
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
```

```css
.risk-section {
  border-left: 3px solid #A16A3C;
  padding-left: 44px;  /* 80px - 3px border - 33px offset = 44px to keep text aligned */
  margin-left: 33px;
}
.risk-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
  break-inside: avoid;
}
.risk-item {
  break-inside: avoid;
}
.risk-title {
  font-family: 'Inter', sans-serif;
  font-size: 8pt;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #A16A3C;
  margin-bottom: 4px;
}
.risk-body {
  font-family: 'Inter', sans-serif;
  font-size: 10pt;
  color: #1A1A1A;
  line-height: 1.6;
  max-width: 480px;
}
```

**Section 6: Acuerdo de Confianza + Firmas** (must stay together — break-inside: avoid on wrapper)

```html
<div class="agreement-block">
  <div class="section-label">ACUERDO</div>
  <h2 class="section-h2">Límite de Pago</h2>
  <p class="agreement-text">El total a recibir por el inversionista — capital más rendimientos acumulados — está limitado por los recursos netos obtenidos de la venta de la propiedad. En caso de que el producto de la venta sea insuficiente para liquidar el monto completo, el pago quedará acotado a lo disponible de dicha operación. El inversionista acepta estos términos con pleno conocimiento.</p>

  <div class="signatures">
    <div class="sig-block">
      <div class="sig-name">[Nombre del Inversionista]</div>
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
```

```css
.agreement-block {
  padding: 48px 80px;
  break-inside: avoid;
  page-break-inside: avoid;
}
.agreement-text {
  font-style: italic;
  color: #6B6B6B;
  max-width: 520px;
  margin-bottom: 48px;
}
.signatures {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 64px;
  break-inside: avoid;
}
.sig-block {
  break-inside: avoid;
}
.sig-name {
  font-family: 'Playfair Display', serif;
  font-size: 13pt;
  font-weight: 400;
  color: #1A1A1A;
  margin-bottom: 40px;
}
.sig-line {
  border-bottom: 1px solid #1A1A1A;
  margin-bottom: 10px;
}
.sig-label {
  font-family: 'Inter', sans-serif;
  font-size: 7pt;
  font-weight: 400;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #6B6B6B;
  margin-bottom: 8px;
}
.sig-date {
  font-family: 'Inter', sans-serif;
  font-size: 9pt;
  color: #6B6B6B;
}
```

### Pagination rules (inherited from prospectus)

Same rules apply — see generate-prospectus.md for rationale:

- `@page { size: A4; margin: 0; }` globally
- Cover: `height: 297mm; page-break-after: always;`
- Every band + content pair wrapped in `.page-section { break-inside: avoid; }`
- `.section-band { page-break-after: avoid; break-after: avoid; }` — band never orphans
- Agreement + signatures block: `break-inside: avoid; page-break-inside: avoid;` on `.agreement-block`
- Scenario table and risk list: `break-inside: avoid`

## Step 5 — Render to PDF

The example investor used throughout this skill for illustration purposes is **Jaime Gutierrez**, $500,000 MXN. Use this name in all HTML/CSS code examples within this skill file.

```bash
SLUG=$(echo "[nombre]" | iconv -f utf-8 -t ascii//TRANSLIT | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-')
TMPFILE=$(mktemp /tmp/term_sheet_XXXXXX.html)
# ... write HTML to $TMPFILE via Python, then:
rm -f files/term-sheet-${SLUG}.pdf
google-chrome --headless --disable-gpu --no-sandbox \
  --disable-dev-shm-usage \
  --allow-file-access-from-files \
  --print-to-pdf="files/term-sheet-${SLUG}.pdf" \
  --print-to-pdf-no-header \
  "$TMPFILE"
rm "$TMPFILE"
```

Confirm `files/term-sheet-[slug].pdf` exists and is non-zero before reporting done.

## What this skill does NOT do

- Does not generate without investor name and amount — ask first
- Does not raise a letter against a `prospecto` — the pool is `oferta`
- Does not invent a term when `holdMonths` is null — ask for it
- Does not show ROI (reveals internal margin — same rule as prospectus; see the
  open question flagged in `generate-prospectus.md`, which the shipped prospectus
  endpoint contradicts)
- Does not use Google Fonts CDN — always @font-face with local files
- Does not hardcode colors — derive from DESIGN.md tokens
- Does not invent a label — every name comes from `docs/glosario.md`
- Does not generate a formal pagaré or legal instrument
- Does not eyeball or estimate numbers — Python does all calculations
- Does not use uppercase on cover-property or cover-footer — mixed case, modest tracking
