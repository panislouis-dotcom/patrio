# Refigan Dashboard — Design Spec
_2026-05-05_

## Context

Internal tool for evaluating and comparing real estate prospects in Monterrey. Data lives in `data/refigan.db` (SQLite), exposed through the `prospect_metrics` view. The goal is a fast analytical interface that surfaces the best opportunities and flags data quality problems before they become decisions based on bad inputs.

---

## Architecture

```
data/refigan.db (SQLite)
    ↓ prospect_metrics view
api/          FastAPI — Python, port 8000
    ↓ JSON REST
frontend/     React + Vite + TypeScript, port 5173
```

**Makefile targets to add:**
- `make api` — start FastAPI server (`uvicorn api.main:app --reload`)
- `make dev` — start React dev server (`cd frontend && npm run dev`)
- `make app` — both together (background api, foreground dev)

---

## Backend — `api/`

### Files
| File | Responsibility |
|------|---------------|
| `api/main.py` | FastAPI app, CORS, route registration |
| `api/db.py` | SQLite connection, `get_prospects()`, `get_prospect(id)` helpers |
| `api/checks.py` | Pure functions: `run_checks(prospect) → list[Issue]` |

### Endpoints
| Method | Path | Returns |
|--------|------|---------|
| GET | `/api/prospects` | All rows from `prospect_metrics` as JSON array |
| GET | `/api/prospects/{id}` | Single prospect + full check results |
| GET | `/api/quality` | All prospects with their issues, grouped |

All endpoints return camelCase JSON. CORS open to `localhost:5173`.

---

## Frontend — `frontend/`

### Stack
- Vite + React 18 + TypeScript
- Leaflet + react-leaflet (OpenStreetMap tiles, no API key)
- No UI component library — uses Refigan design tokens directly

### Design tokens (`src/lib/theme.ts`)
From `docs/DESIGN.md`:
```ts
colors: { primary: '#6B8A5E', tertiary: '#A2571D', neutral: '#F2F0EB', dark: '#1A2319', secondary: '#7A7260' }
fonts:  { serif: 'EB Garamond', sans: 'Public Sans', label: 'Space Grotesk' }
```

### Route structure
```
/                   → redirects to /tabla
/tabla              → ProspectTable + ProspectDrawer (drawer is a URL param: ?id=3)
/tabla/:id          → ProspectDetailPage
/mapa               → ProspectMap + ProspectDrawer
/calidad            → QualityTab
```

Tab bar is persistent across all routes.

---

## Tab 1 — Tabla

### ProspectTable (`src/components/ProspectTable.tsx`)
- Fetches `/api/prospects` on mount
- Default sort: composite score descending
- Click any column header → sort by that column (toggle asc/desc)
- Each row shows: name, score badge, ROI, cap rate, profit, total investment, quality indicator
- Inline quality indicator: 🔴 if any errors, ⚠️ if warnings only, nothing if clean
- Click row → opens ProspectDrawer (sets `?id=` query param)

**Score weight controls** (collapsible panel above table):
- Three sliders: ROI weight, Cap Rate weight, Profit weight (must sum to 100%)
- Default: ROI 50% / Cap Rate 30% / Profit 20%
- Score is computed client-side in `src/lib/scoring.ts`
- Score = weighted percentile rank across all prospects (0–100)

### ProspectDrawer (`src/components/ProspectDrawer.tsx`)
- Slides in from the right, table stays visible
- Shows: name, score, hero metrics (ROI, cap rate, profit, total investment)
- Quality issues for this prospect (errors first, then warnings)
- "Abrir detalle →" button → navigates to `/tabla/:id`
- Close button or click outside → clears `?id=` param

### ProspectDetailPage (`src/components/ProspectDetailPage.tsx`)
- Full-screen page. Back button → returns to `/tabla`
- Sections:
  1. **Hero bar** — ROI, profit, cap rate, score (large EB Garamond numbers in terracotta)
  2. **Cost breakdown** — land price, acquisition costs (6.5%), permits, subdivision, construction base, construction total, **total investment**
  3. **Map inset** — Leaflet mini-map, single pin, 400px tall
  4. **Timeline** — investment date → sale date, duration in months
  5. **Data quality** — all issues for this prospect
  6. **Raw data** — all stored fields in a two-column table

---

## Tab 2 — Mapa (`src/components/ProspectMap.tsx`)
- Leaflet map centered on Monterrey (25.6866, -100.3161), zoom 13
- One pin per prospect that has valid coordinates (lat ≠ 0, lng ≠ 0)
- Pin color: green (#6B8A5E) → terracotta (#A2571D) based on score quartile
- Pins with quality errors get a small ⚠ overlay icon
- Click pin → opens same ProspectDrawer (sets `?id=`)
- Prospects with lat=0/lng=0 shown in a warning banner below the map: "N prospects have no coordinates"

---

## Tab 3 — Calidad (`src/components/QualityTab.tsx`)
- Summary header: "X errores · Y advertencias en Z prospectos"
- List of prospects with issues, sorted by severity (errors first) then by score
- Each prospect card shows its issues as a list: field name + message
- Click prospect → opens drawer
- Prospects with no issues shown at the bottom as "✓ Sin problemas"

### Quality check rules (`api/checks.py` + mirrored in `src/lib/checks.ts`)

**Errors (🔴)** — data is clearly wrong:
| Field | Rule |
|-------|------|
| `latitude` / `longitude` | equals 0 |
| `land_price` | equals 0 |
| `sqm_land` | equals 0 |
| `roi` | less than 0 |
| `sale_date` | ≤ `investment_date` |
| `construction_overhead` | less than 1.0 |

**Warnings (⚠️)** — worth reviewing, may be intentional:
| Field | Rule |
|-------|------|
| `construction_cost_per_sqm` | equals 0 |
| `rent_monthly` | equals 0 |
| `acquisition_cost_pct` | greater than 0.10 |
| `investment_date` | already in the past |
| `profit` | less than 500,000 MXN |

Checks run on both backend (`/api/quality`, `/api/prospects/:id`) and client-side (for instant feedback without a round-trip).

---

## Scoring (`src/lib/scoring.ts`)

```ts
score(prospect, allProspects, weights = { roi: 0.5, capRate: 0.3, profit: 0.2 }): number
```

Algorithm: percentile rank each metric across all prospects, then weighted sum → normalize to 0–100. Prospects with quality errors are shown with their score but flagged visually.

---

## Out of scope (this phase)
- Automated opportunity discovery / scraping
- Authentication
- Projects tab (only prospects for now)
- Editing data through the UI
- Mobile-optimized layout (desktop-first, but responsive enough to use on phone in a pinch)

---

## Verification
```bash
make reset          # seed DB
make api            # confirm http://localhost:8000/api/prospects returns JSON
make dev            # confirm http://localhost:5173 loads
# Table: sort by ROI, confirm Lote 9811380 is top
# Map: confirm pins appear near Centro Monterrey
# Quality tab: confirm prospects with lat=0 show as errors
# Drawer: click a prospect, confirm metrics match DB
# Detail page: confirm cost breakdown sums correctly
```
