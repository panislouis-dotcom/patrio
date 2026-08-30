---
name: generate-prospectus
description: Use when asked to generate, update, or rebuild the Patrio investor prospectus document.
---

# Generate Patrio Investor Prospectus

## Overview

This skill is the only source of truth for prospectus generation. Do not create external scripts — Claude reads DESIGN.md and the DB, writes the HTML directly, then renders to PDF via Chromium. Any logic that lives outside this skill will drift.

## Step 1 — Read sources

Read these three files before touching anything else:

- `docs/glosario.md` — **the name of every number.** One concept, one name, on
  every surface. Do not invent a label; if the figure you are about to print has
  no entry there, you are about to publish a concept that does not exist.
- `docs/DESIGN.md` — all color tokens, typography, component rules
- `db/schema.sql` — field names before querying

## Step 2 — Read the favorited properties

There is one table, `properties`, and `status` is the stage of a building's life. **Prefer the API over SQL**: it returns every derived metric already computed for the stage, which is exactly what the document prints. Raw SQL would force you to re-derive them, and re-derived numbers drift.

```bash
curl -s "$REFIGAN_API/api/properties" -H "Authorization: Bearer $REFIGAN_API_KEY" \
  | jq '[.[] | select(.isFavorite)] | group_by(.status) | map({status: .[0].status, count: length})'
```

### The four buckets, and why they are four

The document does not have one "track record". It has two, because a closed deal and a held one are not presented with the same figures — one reports what it collected, the other what it is worth today:

Every label below is the canonical one from `docs/glosario.md`. This table is the
inventory of what each bucket may print — it mirrors `_sold_card`,
`_rented_card`, `_development_card` and `_opportunity` in
`app/api/lib/prospectus_html.py`, and it is verified against them, not
remembered.

| Bucket | `status` | Field → label |
|---|---|---|
| Track Record · closed | `vendida` | `totalInvestment` Inversión total · `salePrice` Precio de venta · `realizedGain`+`realizedGainPct` Ganancia realizada · `realizedRoi` ROI real anual · `holdMonthsActual` Plazo real |
| Track Record · held | `en_renta` | `totalInvestment` Inversión total · `currentValuation` Valuación · *(fechada con `valuationDate`)* · `roi` ROI anual · `unrealizedGainPct` Ganancia no realizada % · `capRateActual` Cap rate real s/ inversión |
| En Desarrollo | `desarrollo` | `totalInvestment` Inversión total · `projectedSale` Venta proyectada · `projectedRoi` ROI proy. anual · `projectedRoiTotal` Ganancia proyectada % · `capRate` Cap rate proy. s/ inversión |
| Oportunidad Activa | `oferta`, then `prospecto` | `holdMonths` Plazo proyectado · `totalInvestment` Inversión total · `projectedSale` Venta proyectada · `projectedProfit`+`projectedRoiTotal` Ganancia proyectada · `capRate` Cap rate proy. s/ inversión |

Ordering inside each bucket: sold first (a realised result is the strongest proof the firm has, and a valuation mark should never come ahead of a sale), each group sorted by gain descending. In the opportunity pages `oferta` leads — it is the deal the firm has already committed to; an unbid prospect is the weakest page in the deck and goes last.

**En Desarrollo prints no valuation.** A property bought last month has a
valuation that was born equal to its cost, and printing it reads as an appraisal
nobody performed. What that stage can honestly show is its projection.

**Never present a projection as a result.** `projectedProfit` / `projectedRoi`
are what the model says; `realizedGain` / `realizedRoi` are what the sale paid.
Both groups are computed on every property — the API stopped gating the
projection so the plan-vs-result pair stays readable — so the *labels* are what
keeps them apart. That is exactly why the table above is a field→label map and
not a list of fields.

**Two enums, never raw.** `assetType` (Casa · Departamento · Local · Edificio ·
Lote · Bodega) and `strategyType` (Reconversión · Obra nueva · Flip · Renta) are
two different questions. Print both, translated. «Adaptive reuse» and «Ground
up» are not words in this business.

> **Note:** If no properties are favorited the endpoint returns `400` and the document has nothing to say. Mark at least one property as favorite in the web app before running this skill.

> **Shortcut:** `POST /api/documents/prospectus` (operation_id `documents_prospectus`) already builds and renders this deck from the same partition. Use this skill when the layout itself is what needs to change; use the endpoint when you just need the current PDF.

## Step 3 — Write `files/prospectus.html`

Build the HTML using the design tokens from `docs/DESIGN.md`. Apply them directly in a `<style>` block — never hardcode colors or fonts that are already defined there.

### Document structure

```text
Cover page       → dark near-black background, wordmark, headline, date
Visión section   → problem → emotion → solution (see copywriting rules below)
Track Record     → ONE page-section per property, each with its own band showing the property name
                   Band label: "TRACK RECORD · 01", title: property name
                   Content: narrative h2 + paragraph + 3-col KPI grid + timeline
En Desarrollo    → same card shape, band label "EN DESARROLLO · 01" — works in progress
Oportunidad      → section band + KPI grid (Plazo proyectado, Inversión total, Venta proyectada,
                   Ganancia proyectada, Cap rate proy. sobre inversión) + two-col (financials | characteristics)
                   «Valuación proyectada» does not exist: that number is the Venta proyectada
                   (projectedSale). A valuación is a dated estimate of what the property is worth
                   TODAY, and no opportunity has one.
CTA              → dark near-black background, contact
```

> **Open question — how much margin the opportunity page shows.** This skill used
> to say "do NOT show ROI, it reveals internal margin", while
> `POST /api/documents/prospectus` prints **Ganancia proyectada** as an amount
> *and* a percentage on that very page — which discloses strictly more than a ROI
> would. The rule and the shipped document disagree, and which one wins is a
> product call, not a vocabulary one. Until it is decided, the endpoint is the
> truth and the bucket table above describes it. Do not resolve this by inventing
> a third behaviour.

### CSS rules (derive values from DESIGN.md tokens)

```css
/* Single global rule — margin: 0 everywhere. Sections control their own breathing room. */
/* DO NOT use @page bleed or named pages — Chromium headless ignores them unreliably. */
@page { size: A4; margin: 0; }

body { font-family: Inter; background: neutral; color: dark; font-size: 12pt; line-height: 1.75; }

/* Cover and back-cover: height: 297mm (exact A4) fills the full sheet */
/* page-break-after/before: always forces each onto its own dedicated page */
.cover          { height: 297mm; background: dark; padding: 72px 80px;
                  page-break-after: always; break-after: always;
                  display: flex; flex-direction: column; justify-content: space-between; }
.footer-section { height: 297mm; background: dark; padding: 64px 80px;
                  page-break-before: always; break-before: always;
                  display: flex; flex-direction: column; justify-content: space-between; }

/* Content sections: 48px top/bottom padding provides breathing room at page edges */
.section-header  { padding: 24px 80px; page-break-after: avoid; break-after: avoid; }
.content-section { padding: 48px 80px;
                   page-break-inside: avoid; break-inside: avoid; }
```

### Section header colors (one per section — vary using DESIGN.md tokens)

Each section uses a `--section-color` CSS custom property that controls both the band background AND the accent color within the section (strong text, metric values, figures). Set it on the `.page-section` container:

```css
.section-vision      { --section-color: #A16A3C; }  /* tertiary */
.section-track       { --section-color: #8C6D87; }  /* accent1  */
.section-oportunidad { --section-color: #697692; }  /* accent2  */
```

Then in the shared rules:
```css
.section-header  { background: var(--section-color); ... }
strong           { color: var(--section-color); }
.metric-value    { color: var(--section-color); }
.bnum            { color: var(--section-color); }
```

| Section | Class | Color token | Hex |
|---|---|---|---|
| Visión | .section-vision | tertiary | #A16A3C |
| Track Record | .section-track | accent1 | #8C6D87 |
| Oportunidad | .section-oportunidad | accent2 | #697692 |

Text on all bands stays `neutral` (#F2F0EB) — all three backgrounds are dark enough for legibility.

### Page break & pagination rules

**CRITICAL — never skip these:**

**Why not `@page bleed` / named pages?** Chromium headless print does not reliably apply named page margins, so `page: bleed` with `@page bleed { margin: 0 }` produces inconsistent results — the dark background stops short of the page edge. The reliable pattern is `@page { margin: 0 }` globally with explicit `height: 297mm` on full-bleed sections.

1. **Wrap every (band + content) pair** in `<div class="page-section">`:

   ```html
   <div class="page-section">
     <div class="section-header">…</div>
     <section class="content-section">…</section>
   </div>
   ```

   ```css
   .page-section { page-break-inside: avoid; break-inside: avoid; }
   ```

   This keeps the colored band glued to its content — it will never be the last thing on a page with the content starting on the next.

   **CRITICAL: each `.page-section` must fit on one page.** When `break-inside: avoid` is applied to a container taller than a page, Chromium fills the entire previous page with the element's background color before rendering it — producing a solid-color blank page. The fix: never put multiple properties inside one `.page-section`. Give each property its own band + wrapper. For Track Record, each property is its own `<div class="page-section section-track">` with its own `<div class="section-header">` showing the property name as the band title.

2. **`page-break-after: avoid` on `.section-header`** — belt-and-suspenders so the band never orphans even outside a wrapper.

3. **Content sections use `page-break-inside: avoid; break-inside: avoid;`** — prevents a section from splitting mid-table or mid-column.

4. **Metric grids and two-col blocks also get `break-inside: avoid`** so tables and KPI cards don't split across pages.

5. **Cover uses `height: 297mm`** (exact A4) not `100vh` — `100vh` in Chromium print mode may not equal the full sheet when `@page bleed { margin: 0 }` is active.

6. **Use `@page { margin: 0 }` globally** — sections control their own breathing room via padding. Named pages are unreliable in Chromium headless.

### Type scale

All sizes are for print (pt units). Never use px for type.

```text
Cover h1         36pt  Playfair Display  color: neutral   line-height: 1.05  NO max-width (full content width so heading fits in 2 lines)
Band title       30pt  Playfair Display  color: neutral   line-height: 1.1
Section h2       16pt  Playfair Display  color: dark      line-height: 1.2  margin-bottom: 20px  NO max-width (full width so long headings fit in 1 line)
Section label h3  7pt  Inter     color: secondary  letter-spacing: 0.18em  uppercase  margin-bottom: 12px
Wordmark         10pt  Inter     color: neutral   letter-spacing: 0.55em  uppercase
Band label        7pt  Inter     color: neutral@80%  letter-spacing: 0.25em  uppercase  margin-bottom: 8px
Body p          12pt  Inter      color: dark      max-width: 540px  margin-bottom: 14px
Caption p        9pt   Inter       color: secondary
Metric value hero 28pt  Playfair Display  color: tertiary  line-height: 1
Metric value compact 20pt  Playfair Display  color: tertiary  (use in 4-col grids so long numbers fit)
Metric label      6.5pt  Inter   color: secondary  letter-spacing: 0.18em  uppercase  margin-top: 6px
Table body        9.5pt  Inter
Table num         9.5pt  Inter   color: tertiary   text-align: right  font-weight: 500
Timeline date     7pt   Inter    color: secondary  letter-spacing: 0.12em  uppercase
```

### Spacing rules

- **Horizontal margin:** 80px on all sections (cover, bands, content, footer) — consistent gutter throughout
- **Vertical padding:** cover 72px, content 52px, bands 24px, footer 64px
- **Metric card padding:** 24px 20px — tighter horizontal so numbers breathe
- **Two-column gap:** 56px
- **Timeline date column:** width 88px, padding-left 14px, padding-right 32px, border-left 2px solid primary
- **h3 label → h2 gap:** h3 margin-bottom 12px (label sits visually close to its title)
- **Metric grid:** border 1px solid rgba(dark,0.1) around whole grid; same border between cards; no outer margin collapse

### Grid layouts

**3-col metric grid** (track record KPIs): `grid-template-columns: repeat(3, 1fr)`

**4-col metric grid** (opportunity highlights): `grid-template-columns: repeat(4, 1fr)` — use `metric-value compact` (20pt) so "$10,095,000" doesn't overflow

**2-col content**: `grid-template-columns: 1fr 1fr; gap: 56px` — left col gets financials, right col gets characteristics

### Component: metric card

```html
<div class="metric-card">
  <div class="metric-value">$19,000,000</div>   <!-- 28pt tertiary -->
  <div class="metric-label">VALUACIÓN ACTUAL</div>  <!-- 6.5pt secondary Inter -->
</div>
```

### Component: timeline row

Left border 2px solid primary (sage). Date in Inter 7pt secondary. Description in Inter 9.5pt dark.

### Typography extras

```css
strong { color: tertiary; font-weight: 500; }
p.secondary { color: secondary; }
.footer-section strong { color: primary; }  /* sage on dark bg */
```

### Cover layout

The `.cover` has **three direct flex children**: wordmark (top), cover-main (middle), cover-footer (bottom). `justify-content: space-between` on `.cover` handles vertical placement automatically. **Do NOT give `.cover-main` `flex: 1` or `justify-content: flex-end`** — that collapses everything to the bottom of the page.

```html
<div class="cover">
  <div class="wordmark">R E F I G A N</div>

  <div class="cover-main">
    <div class="cover-prelabel">Prospecto de Inversión · Mayo 2026</div>
    <h1>Renta Fija con Garantía Inmobiliaria</h1>
    <div class="cover-meta">San Pedro Garza García, NL · Distribución Restringida</div>
  </div>

  <div class="cover-footer">Documento Confidencial · Solo para uso de prospectos e inversionistas autorizados</div>
</div>
```

```css
.cover {
  height: 297mm;
  background: #1A1A1A;
  padding: 72px 80px;
  page-break-after: always;
  break-after: always;
  display: flex;
  flex-direction: column;
  justify-content: space-between;  /* distributes: wordmark top · cover-main middle · footer bottom */
}
/* cover-main needs NO flex rules — let space-between handle placement */
.cover-main {}

.cover-prelabel {
  font-family: 'Inter', sans-serif;
  font-size: 7pt;
  font-weight: 400;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: rgba(242,240,235,0.8);
  margin-bottom: 16px;
}
```

The `cover-prelabel` sits directly above the h1 — it anchors the document type and date before the reader hits the headline. Update the year/month whenever regenerating.

**Cover-meta and cover-footer must NOT use `text-transform: uppercase`.** They are mixed-case body-size text (not label caps). Using uppercase makes them look heavy and bureaucratic. They are set in Inter at 7pt with modest letter-spacing but no case transformation:

```css
.cover-meta   { font-family: 'Inter'; font-size: 7pt; font-weight: 400; letter-spacing: 0.08em; color: rgba(242,240,235,0.6); }
.cover-footer { font-family: 'Inter'; font-size: 7pt; font-weight: 400; letter-spacing: 0.08em; color: rgba(242,240,235,0.4); }
```

**Impact block uses Playfair Display Italic** — the editorial pull-quote treatment that sets it apart from body copy:

```css
.impact-block p { font-family: 'Playfair Display'; font-style: italic; font-size: 11pt; color: #6B6B6B; line-height: 1.7; margin-bottom: 0; }
```

### Cover title

`Renta Fija con Garantía Inmobiliaria` — frames the product as fixed-income debt; real estate is collateral, not the product. Keep this framing.

### Cover subtitle (below the city/date line)

`Distribución Restringida` — legal/privacy framing on the cover meta line (city · Distribución Restringida). Shared with prospects and clients; not public. Avoid marketing language here. The footer already carries "Documento Confidencial" — do not duplicate on the cover. Both words always capitalized.

### Visión section — exact copy

Use this verbatim copy every time. Do not paraphrase.

**Band:**
- Label: `PROPUESTA DE VALOR`
- h2: `Tu capital merece más que CETES`

**Content section:**
- Section label (h3): `VISIÓN`
- Content h2: `La brecha entre lo que recibes y lo que genera el mercado`
- p1: `CETES ronda el 9% anual. Los bancos prestan al 15% a desarrolladores. La diferencia existe, y alguien la captura. Ese espacio es donde Patrio opera.`
- p2: `Patrio ofrece rendimiento fijo ~12% anual, respaldado por inmuebles reales en el Centro de Monterrey y otras zonas de oportunidad. Plazo definido, activo tangible, salida clara — sin la volatilidad de mercados financieros.`
- p3: `Cada inversión financia un edificio real. Patrio identifica y desarrolla oportunidades en el Centro de Monterrey y otras zonas de oportunidad, siguiendo una metodología de adquisición probada.`
- Impact block (Playfair Display italic, left border in section color): `Restaurar un edificio histórico no es solo una operación financiera. Es devolver vida a una estructura que guarda la historia de una ciudad. Cada proyecto de Patrio rescata una pieza del patrimonio urbano de Monterrey — y la convierte en un espacio digno, habitado, vivo.`

### CTA / Footer section — exact copy

- h2: `Hablemos de su próxima inversión`
- p1: `Patrio opera desde **San Pedro Garza García** e invierte en el Centro de Monterrey y otras zonas con oportunidades. Fondeos cerrados, plazos definidos, rendimientos fijos.`
- p2: `Documento preparado exclusivamente para prospectos e inversionistas autorizados. Los rendimientos proyectados son estimados y no constituyen una garantía.`
- Disclaimer (bottom): `Documento Confidencial · Distribución Restringida · [Month Year]` + second line about confidentiality.

### Data rendering rules

- **Milestones JSON:** parse `{"YYYY-MM": "description"}` from the `milestones` column, render as `<table class="timeline">` sorted by key
- **Numbers:** always formatted as `$X,XXX,XXX` — never raw floats
- **Labels:** taken from `docs/glosario.md`, never improvised. A metric label
  names one API field; if two cards show the same field they use the same words,
  and if one label would fit two fields it is the wrong label. Banned outright:
  *Plusvalía*, *Valuación proyectada*, *Inversión desarrollo*, *Ganancia est.*,
  *meses en cartera*, *Obra a ejecutar (base)* / *(total)* — the fields behind
  those two are gone, and the cost of works is `constructionBudgeted`, «Obra
  presupuestada» — and *Cap rate* without its denominator (the formula is
  yield on cost, and «cap rate» alone means NOI over market value).
- **Construction figures are read, never rebuilt.** The cost of works is the sum
  of the property's budget; `sqmConstruction` is physical footage and is printed
  with a m² unit, never multiplied by a price. Do not reach for
  `constructionCostPerSqm` (a captured assumption that prices nothing),
  `budgetedCostPerSqm` (derived, display-only) or an overhead multiplier —
  the ×1.3 is already inside the amount, and applying it again inflates every
  works figure by 30% with nothing looking broken.
- **Enums:** `assetType` and `strategyType` are translated, never printed raw and
  never de-underscored into fake Spanish
- **Headings:** always single line — no `<br>` tags inside `<h2>` or `<h1>`

### Font loading — always use local @font-face, never Google Fonts CDN

**Do NOT use `<link>` to fonts.googleapis.com.** Headless Chrome cannot reliably load external CDN fonts during PDF rendering and falls back to Liberation Serif/Sans, which renders headings as bold (ugly). Always use `@font-face` with the pre-downloaded files in `files/fonts/`.

Font files are stored at `files/fonts/` (already downloaded — do not re-download):
```
files/fonts/playfair-display-regular.woff2  ← Playfair Display Regular
files/fonts/playfair-display-italic.woff2   ← Playfair Display Italic (impact block)
files/fonts/inter-400.woff2          ← Inter variable (100–900)
files/fonts/inter-600.woff2        ← Inter variable (300–700)
```

Declare them in the HTML `<style>` block before any other CSS:

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

**Always add `font-weight: 400` explicitly to every heading rule** (h1, h2, band h2, metric-value). Without it, browsers synthesize bold when the intended weight isn't available, making the elegant Playfair Display look heavy.

Add `--allow-file-access-from-files` to the Chrome render command so local font paths load correctly.

## Step 4 — Render to PDF

Write the HTML to a temp file, render via Playwright (ships its own Chromium — no system Chrome needed), delete temp file. Only the PDF survives.

Save the snippet below as a temp script, run it, then delete the script:

```python
import asyncio, os, tempfile
from playwright.async_api import async_playwright

html = open('files/prospectus.html').read()

async def render():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        with tempfile.NamedTemporaryFile(suffix='.html', delete=False, mode='w') as f:
            f.write(html)
            tmp = f.name
        try:
            await page.goto(f'file://{tmp}', wait_until='networkidle')
            await page.pdf(path='files/prospectus.pdf', format='A4', print_background=True)
        finally:
            os.unlink(tmp)
        await browser.close()
        print('Done:', os.path.getsize('files/prospectus.pdf'), 'bytes')

asyncio.run(render())
```

If playwright is not installed: `pip install playwright && playwright install chromium`.

Confirm `files/prospectus.pdf` exists before reporting done.

## What NOT to do

- Do not create `scripts/generate_prospectus.py` or any external script
- Do not invent a label — read them from `docs/glosario.md`; a number whose name
  you had to make up is a number the reader cannot check
- Do not print a raw enum (`adaptive_reuse`) or a half-translated one ("Adaptive reuse")
- Do not put a valuation on an `En Desarrollo` card — nobody appraised it
- Do not hardcode colors — read them from `docs/DESIGN.md`
- Do not put `<br>` inside headings
- Do not show raw float numbers — always format as currency
- Do not use `<link href="fonts.googleapis.com">` — headless Chrome can't load CDN fonts; use local `@font-face` instead
- Do not omit `font-weight: 400` from heading rules — without it the browser synthesizes bold, making Playfair Display look heavy
