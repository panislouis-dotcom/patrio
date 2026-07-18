# Refigan Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a FastAPI + React/Vite dashboard that reads `data/refigan.db`, ranks real estate prospects by a composite score, visualizes them on a map, and flags data quality issues.

**Architecture:** Python FastAPI (port 8000) reads SQLite via a JOIN of `prospect_metrics` + `prospects` tables and serves three JSON endpoints. React/Vite (port 5173) consumes those endpoints across three tabs: Tabla (sortable scored table + drawer + detail page), Mapa (Leaflet), Calidad (quality checks).

**Tech Stack:** Python 3.11+, FastAPI, uvicorn, React 18, TypeScript, Vite 5, React Router v6, Leaflet + react-leaflet, vitest, pytest

---

## File Map

```
api/
  requirements.txt          new — Python deps
  main.py                   new — FastAPI app, CORS, routes
  db.py                     new — SQLite helpers, row → camelCase dict
  checks.py                 new — pure quality check functions
  tests/
    test_checks.py          new — pytest unit tests for checks
    test_routes.py          new — pytest API integration tests

frontend/
  package.json              new
  vite.config.ts            new
  tsconfig.json             new
  index.html                new
  src/
    main.tsx                new — React entry point
    App.tsx                 new — TabBar + router outlet
    lib/
      types.ts              new — Prospect, Issue, ScoreWeights interfaces
      theme.ts              new — Refigan design tokens
      api.ts                new — fetch wrappers
      scoring.ts            new — composite score (percentile rank)
      checks.ts             new — client-side quality checks (mirrors api/checks.py)
    components/
      TabBar.tsx            new — persistent nav
      ScoreWeights.tsx      new — collapsible weight sliders
      ProspectTable.tsx     new — sortable table with score + quality badges
      ProspectDrawer.tsx    new — right-side slide-in panel
      ProspectDetailPage.tsx new — full detail: metrics, breakdown, map, quality
      ProspectMap.tsx       new — Leaflet map, colored pins
      QualityTab.tsx        new — grouped quality issues

makefile                    modify — add api, dev, app targets + fix DB name
```

---

## Task 1: Python API — setup + db helpers

**Files:**
- Create: `api/requirements.txt`
- Create: `api/db.py`

- [ ] **Step 1: Create `api/requirements.txt`**

```
fastapi==0.111.0
uvicorn[standard]==0.29.0
```

- [ ] **Step 2: Create `api/db.py`**

```python
import sqlite3
import re
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "data" / "refigan.db"

PROSPECTS_QUERY = """
SELECT
    pm.*,
    p.latitude,
    p.longitude,
    p.construction_cost_per_sqm,
    p.construction_overhead
FROM prospect_metrics pm
JOIN prospects p ON pm.id = p.id
"""


def _snake_to_camel(name: str) -> str:
    parts = name.split("_")
    return parts[0] + "".join(p.title() for p in parts[1:])


def _row_to_dict(row: sqlite3.Row) -> dict:
    return {_snake_to_camel(k): v for k, v in dict(row).items()}


def get_prospects() -> list[dict]:
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(PROSPECTS_QUERY).fetchall()
    return [_row_to_dict(r) for r in rows]


def get_prospect(prospect_id: int) -> dict | None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            f"{PROSPECTS_QUERY} WHERE pm.id = ?", (prospect_id,)
        ).fetchone()
    return _row_to_dict(row) if row else None
```

- [ ] **Step 3: Verify DB path resolves**

```bash
cd /path/to/refigan
python3 -c "from api.db import get_prospects; p = get_prospects(); print(len(p), p[0]['name'])"
```

Expected: `11 Casa Casco Urbano SPGG` (or similar — 11 rows, first name printed)

- [ ] **Step 4: Commit**

```bash
git add api/requirements.txt api/db.py
git commit -m "feat: add FastAPI db helpers with prospect_metrics JOIN"
```

---

## Task 2: Quality checks

**Files:**
- Create: `api/checks.py`
- Create: `api/tests/test_checks.py`

- [ ] **Step 1: Create `api/tests/__init__.py`** (empty file)

```bash
mkdir -p api/tests && touch api/tests/__init__.py
```

- [ ] **Step 2: Write failing tests in `api/tests/test_checks.py`**

```python
from api.checks import run_checks, Issue

def _base() -> dict:
    """A valid prospect — no issues expected."""
    return {
        "id": 1, "name": "Test", "latitude": 25.68, "longitude": -100.33,
        "landPrice": 3000000, "sqmLand": 100, "roi": 0.25,
        "saleDate": "2027-01-01", "investmentDate": "2025-06-01",
        "constructionOverhead": 1.3, "constructionCostPerSqm": 6000,
        "rentMonthly": 20000, "acquisitionCostPct": 0.06, "profit": 1000000,
    }

def test_no_issues_on_valid_prospect():
    assert run_checks(_base()) == []

def test_error_on_zero_latitude():
    p = _base(); p["latitude"] = 0
    issues = run_checks(p)
    assert any(i.field == "latitude" and i.severity == "error" for i in issues)

def test_error_on_zero_longitude():
    p = _base(); p["longitude"] = 0
    issues = run_checks(p)
    assert any(i.field == "longitude" and i.severity == "error" for i in issues)

def test_error_on_zero_land_price():
    p = _base(); p["landPrice"] = 0
    assert any(i.severity == "error" for i in run_checks(p))

def test_error_on_zero_sqm_land():
    p = _base(); p["sqmLand"] = 0
    assert any(i.field == "sqmLand" and i.severity == "error" for i in run_checks(p))

def test_error_on_negative_roi():
    p = _base(); p["roi"] = -0.05
    assert any(i.field == "roi" and i.severity == "error" for i in run_checks(p))

def test_error_on_bad_date_order():
    p = _base(); p["saleDate"] = "2024-01-01"; p["investmentDate"] = "2025-01-01"
    assert any(i.field == "saleDate" and i.severity == "error" for i in run_checks(p))

def test_error_on_low_overhead():
    p = _base(); p["constructionOverhead"] = 0.9
    assert any(i.field == "constructionOverhead" and i.severity == "error" for i in run_checks(p))

def test_warning_on_zero_construction_cost():
    p = _base(); p["constructionCostPerSqm"] = 0
    assert any(i.field == "constructionCostPerSqm" and i.severity == "warning" for i in run_checks(p))

def test_warning_on_zero_rent():
    p = _base(); p["rentMonthly"] = 0
    assert any(i.field == "rentMonthly" and i.severity == "warning" for i in run_checks(p))

def test_warning_on_high_acquisition_cost():
    p = _base(); p["acquisitionCostPct"] = 0.12
    assert any(i.field == "acquisitionCostPct" and i.severity == "warning" for i in run_checks(p))

def test_warning_on_low_profit():
    p = _base(); p["profit"] = 400000
    assert any(i.field == "profit" and i.severity == "warning" for i in run_checks(p))
```

- [ ] **Step 3: Run tests — confirm they all fail**

```bash
python3 -m pytest api/tests/test_checks.py -v
```

Expected: all fail with `ModuleNotFoundError: No module named 'api.checks'`

- [ ] **Step 4: Create `api/checks.py`**

```python
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
    if not p.get("latitude") or not p.get("longitude"):
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
    if inv and inv < date.today().isoformat():
        issues.append(Issue("investmentDate", f"Fecha de inversión ya pasó ({inv})", "warning"))
    if (p.get("profit") or 0) < 500_000:
        issues.append(Issue("profit", f"Profit < $500k ({p.get('profit', 0):,.0f} MXN)", "warning"))

    return issues
```

- [ ] **Step 5: Run tests — all pass**

```bash
python3 -m pytest api/tests/test_checks.py -v
```

Expected: 12 PASSED

- [ ] **Step 6: Commit**

```bash
git add api/checks.py api/tests/
git commit -m "feat: add quality check functions with full test coverage"
```

---

## Task 3: FastAPI routes + API tests

**Files:**
- Create: `api/main.py`
- Create: `api/tests/test_routes.py`

- [ ] **Step 1: Install dependencies**

```bash
pip3 install fastapi==0.111.0 "uvicorn[standard]==0.29.0" httpx pytest
```

- [ ] **Step 2: Write failing route tests in `api/tests/test_routes.py`**

```python
import pytest
from fastapi.testclient import TestClient
from api.main import app

client = TestClient(app)

def test_get_prospects_returns_list():
    r = client.get("/api/prospects")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert len(data) > 0

def test_prospect_has_required_fields():
    r = client.get("/api/prospects")
    p = r.json()[0]
    for field in ["id", "name", "roi", "capRate", "profit", "totalInvestment",
                  "latitude", "longitude", "score"]:
        assert field in p, f"Missing field: {field}"

def test_prospect_has_issues_list():
    r = client.get("/api/prospects")
    p = r.json()[0]
    assert "issues" in p
    assert isinstance(p["issues"], list)

def test_get_single_prospect():
    r = client.get("/api/prospects/1")
    assert r.status_code == 200
    p = r.json()
    assert p["id"] == 1
    assert "issues" in p

def test_get_missing_prospect_returns_404():
    r = client.get("/api/prospects/99999")
    assert r.status_code == 404

def test_quality_endpoint():
    r = client.get("/api/quality")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    # each item has id, name, issues
    for item in data:
        assert "id" in item
        assert "name" in item
        assert "issues" in item
```

- [ ] **Step 3: Run — confirm all fail**

```bash
python3 -m pytest api/tests/test_routes.py -v
```

Expected: all fail with `ModuleNotFoundError: No module named 'api.main'`

- [ ] **Step 4: Create `api/main.py`**

```python
from dataclasses import asdict
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from api.db import get_prospects, get_prospect
from api.checks import run_checks

app = FastAPI(title="Refigan API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


def _with_checks(p: dict) -> dict:
    issues = [asdict(i) for i in run_checks(p)]
    return {**p, "issues": issues}


def _score(p: dict, all_prospects: list[dict]) -> float:
    """Weighted percentile rank: ROI 50%, capRate 30%, profit 20%. Returns 0-100."""
    weights = {"roi": 0.5, "capRate": 0.3, "profit": 0.2}
    total = 0.0
    for field, weight in weights.items():
        values = [x.get(field) or 0 for x in all_prospects]
        v = p.get(field) or 0
        below = sum(1 for x in values if x < v)
        ties = sum(1 for x in values if x == v)
        pct = (below + 0.5 * ties) / len(values) if values else 0.5
        total += pct * weight
    return round(total * 100, 1)


@app.get("/api/prospects")
def list_prospects():
    prospects = get_prospects()
    return [_with_checks({**p, "score": _score(p, prospects)}) for p in prospects]


@app.get("/api/prospects/{prospect_id}")
def detail_prospect(prospect_id: int):
    p = get_prospect(prospect_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Prospect not found")
    all_prospects = get_prospects()
    return _with_checks({**p, "score": _score(p, all_prospects)})


@app.get("/api/quality")
def quality_report():
    prospects = get_prospects()
    return [
        {"id": p["id"], "name": p["name"],
         "issues": [asdict(i) for i in run_checks(p)]}
        for p in prospects
    ]
```

- [ ] **Step 5: Run route tests — all pass**

```bash
python3 -m pytest api/tests/test_routes.py -v
```

Expected: 6 PASSED

- [ ] **Step 6: Smoke-test the live server**

```bash
uvicorn api.main:app --reload &
sleep 2
curl -s http://localhost:8000/api/prospects | python3 -m json.tool | head -40
kill %1
```

Expected: JSON array with prospect objects including `score` and `issues` fields.

- [ ] **Step 7: Commit**

```bash
git add api/main.py api/tests/test_routes.py
git commit -m "feat: add FastAPI routes for prospects, detail, and quality"
```

---

## Task 4: Makefile updates

**Files:**
- Modify: `makefile`

- [ ] **Step 1: Update `makefile`** — fix DB name and add `api`, `dev`, `app` targets

Replace the full file content:

```makefile
DB  = data/refigan.db
SQL = data

reset: ## Nuke and rebuild DB from scratch
	rm -f $(DB)
	sqlite3 $(DB) < $(SQL)/schema.sql
	find $(SQL) -name "seed_*.sql" | sort | while read f; do sqlite3 $(DB) < "$$f"; done

seed: ## Apply all seed files (additive, no drop)
	find $(SQL) -name "seed_*.sql" | sort | while read f; do sqlite3 $(DB) < "$$f"; done

shell: ## Open interactive SQLite shell
	sqlite3 $(DB)

show: ## Quick dump of all projects
	sqlite3 -column -header $(DB) "SELECT id, name, status, total_investment, current_valuation FROM projects;"

prospectus-data: ## Dump raw data used by the prospectus skill
	@echo "=== PROJECTS ==="
	@sqlite3 -column -header $(DB) "SELECT name, total_investment, current_valuation, valuation_date, total_units, acquisition_date FROM projects WHERE status IN ('operating','exited');"
	@echo ""
	@echo "=== PROSPECTS ==="
	@sqlite3 -column -header $(DB) "SELECT name, total_investment, projected_sale, profit, roi, cap_rate, rent_monthly, investment_date, sale_date FROM prospect_metrics WHERE status='evaluating';"

api: ## Start FastAPI backend (port 8000)
	uvicorn api.main:app --reload

dev: ## Start React frontend (port 5173)
	cd frontend && npm run dev

app: ## Start both API and frontend
	uvicorn api.main:app --reload &
	cd frontend && npm run dev

.DEFAULT_GOAL := reset
```

- [ ] **Step 2: Verify reset still works**

```bash
make reset
```

Expected: clean run, no errors, `data/refigan.db` created.

- [ ] **Step 3: Commit**

```bash
git add makefile
git commit -m "feat: add api/dev/app makefile targets, fix DB name to refigan.db"
```

---

## Task 5: React frontend scaffold

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`

- [ ] **Step 1: Create `frontend/package.json`**

```json
{
  "name": "refigan-dashboard",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.22.0",
    "leaflet": "^1.9.4",
    "react-leaflet": "^4.2.1"
  },
  "devDependencies": {
    "@types/leaflet": "^1.9.8",
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@vitejs/plugin-react": "^4.2.0",
    "@testing-library/react": "^14.2.0",
    "@testing-library/user-event": "^14.5.0",
    "jsdom": "^24.0.0",
    "typescript": "^5.4.0",
    "vite": "^5.2.0",
    "vitest": "^1.4.0"
  }
}
```

- [ ] **Step 2: Create `frontend/vite.config.ts`**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
  },
})
```

- [ ] **Step 3: Create `frontend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create `frontend/index.html`**

```html
<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Refigan</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=Public+Sans:wght@400;500&family=Space+Grotesk:wght@500&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `frontend/src/main.tsx`**

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import 'leaflet/dist/leaflet.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
```

- [ ] **Step 6: Install dependencies**

```bash
cd frontend && npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/
git commit -m "feat: scaffold Vite + React + TypeScript frontend"
```

---

## Task 6: Types, theme, API client

**Files:**
- Create: `frontend/src/lib/types.ts`
- Create: `frontend/src/lib/theme.ts`
- Create: `frontend/src/lib/api.ts`

- [ ] **Step 1: Create `frontend/src/lib/types.ts`**

```typescript
export interface Issue {
  field: string
  message: string
  severity: 'error' | 'warning'
}

export interface Prospect {
  id: number
  name: string
  address: string
  city: string
  status: string
  url: string
  latitude: number
  longitude: number
  sqmLand: number
  sqmConstruction: number
  landPrice: number
  acquisitionCostPct: number
  acquisitionCosts: number
  acquisitionTotal: number
  permitsCost: number
  subdivisionCost: number
  constructionBase: number
  constructionTotal: number
  constructionCostPerSqm: number
  constructionOverhead: number
  totalInvestment: number
  projectedSale: number
  profit: number
  roi: number
  capRate: number
  landPricePerSqm: number
  salePerSqm: number
  investmentPerSqm: number
  rentMonthly: number
  rentAnnual: number
  investmentDate: string
  saleDate: string
  notes: string
  score: number
  issues: Issue[]
}

export interface ScoreWeights {
  roi: number       // 0-1
  capRate: number   // 0-1
  profit: number    // 0-1
}

export interface QualityEntry {
  id: number
  name: string
  issues: Issue[]
}
```

- [ ] **Step 2: Create `frontend/src/lib/theme.ts`**

```typescript
export const colors = {
  primary: '#6B8A5E',
  secondary: '#7A7260',
  tertiary: '#A2571D',
  accent1: '#654F6F',
  accent2: '#5C5D8D',
  neutral: '#F2F0EB',
  dark: '#1A2319',
  surface: '#111111',
  surfaceAlt: '#1e2e1e',
  border: '#2a3a29',
} as const

export const fonts = {
  serif: '"EB Garamond", Georgia, serif',
  sans: '"Public Sans", system-ui, sans-serif',
  label: '"Space Grotesk", sans-serif',
} as const

export const spacing = { sm: '8px', md: '16px', lg: '32px' } as const
export const radius = { sm: '2px', md: '4px' } as const

export const globalStyles = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: ${colors.dark};
    color: ${colors.neutral};
    font-family: ${fonts.sans};
    font-size: 14px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  a { color: inherit; text-decoration: none; }
`
```

- [ ] **Step 3: Create `frontend/src/lib/api.ts`**

```typescript
import type { Prospect, QualityEntry } from './types'

const BASE = 'http://localhost:8000'

export async function fetchProspects(): Promise<Prospect[]> {
  const res = await fetch(`${BASE}/api/prospects`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function fetchProspect(id: number): Promise<Prospect> {
  const res = await fetch(`${BASE}/api/prospects/${id}`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function fetchQuality(): Promise<QualityEntry[]> {
  const res = await fetch(`${BASE}/api/quality`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/
git commit -m "feat: add TypeScript types, Refigan theme tokens, API client"
```

---

## Task 7: Scoring + client-side checks

**Files:**
- Create: `frontend/src/lib/scoring.ts`
- Create: `frontend/src/lib/checks.ts`
- Create: `frontend/src/lib/scoring.test.ts`
- Create: `frontend/src/lib/checks.test.ts`

- [ ] **Step 1: Write failing test `frontend/src/lib/scoring.test.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import { computeScores } from './scoring'
import type { Prospect, ScoreWeights } from './types'

const weights: ScoreWeights = { roi: 0.5, capRate: 0.3, profit: 0.2 }

function makeProspect(overrides: Partial<Prospect>): Prospect {
  return {
    id: 1, name: 'Test', address: '', city: '', status: 'evaluating', url: '',
    latitude: 25.68, longitude: -100.33, sqmLand: 100, sqmConstruction: 100,
    landPrice: 3000000, acquisitionCostPct: 0.06, acquisitionCosts: 0,
    acquisitionTotal: 0, permitsCost: 0, subdivisionCost: 0, constructionBase: 0,
    constructionTotal: 0, constructionCostPerSqm: 6000, constructionOverhead: 1.3,
    totalInvestment: 0, projectedSale: 0, profit: 1000000, roi: 0.25,
    capRate: 0.07, landPricePerSqm: 0, salePerSqm: 0, investmentPerSqm: 0,
    rentMonthly: 20000, rentAnnual: 0, investmentDate: '2025-06-01',
    saleDate: '2027-01-01', notes: '', score: 0, issues: [],
    ...overrides,
  }
}

describe('computeScores', () => {
  it('returns a score for each prospect', () => {
    const prospects = [makeProspect({ id: 1 }), makeProspect({ id: 2 })]
    const result = computeScores(prospects, weights)
    expect(result).toHaveLength(2)
    expect(result[0].score).toBeGreaterThanOrEqual(0)
    expect(result[0].score).toBeLessThanOrEqual(100)
  })

  it('higher ROI gets higher score when roi weight is 1', () => {
    const low = makeProspect({ id: 1, roi: 0.1, capRate: 0.05, profit: 500000 })
    const high = makeProspect({ id: 2, roi: 0.5, capRate: 0.05, profit: 500000 })
    const result = computeScores([low, high], { roi: 1, capRate: 0, profit: 0 })
    const lowScore = result.find(p => p.id === 1)!.score
    const highScore = result.find(p => p.id === 2)!.score
    expect(highScore).toBeGreaterThan(lowScore)
  })

  it('single prospect gets score of 50', () => {
    const result = computeScores([makeProspect({ id: 1 })], weights)
    expect(result[0].score).toBe(50)
  })
})
```

- [ ] **Step 2: Run — confirm fail**

```bash
cd frontend && npx vitest run src/lib/scoring.test.ts
```

Expected: FAIL — `Cannot find module './scoring'`

- [ ] **Step 3: Create `frontend/src/lib/scoring.ts`**

```typescript
import type { Prospect, ScoreWeights } from './types'

function percentileRank(value: number, allValues: number[]): number {
  if (allValues.length <= 1) return 0.5
  const below = allValues.filter(v => v < value).length
  const ties = allValues.filter(v => v === value).length
  return (below + 0.5 * ties) / allValues.length
}

export function computeScores(
  prospects: Prospect[],
  weights: ScoreWeights
): Prospect[] {
  const rois = prospects.map(p => p.roi)
  const capRates = prospects.map(p => p.capRate)
  const profits = prospects.map(p => p.profit)

  return prospects.map(p => {
    const score =
      percentileRank(p.roi, rois) * weights.roi +
      percentileRank(p.capRate, capRates) * weights.capRate +
      percentileRank(p.profit, profits) * weights.profit
    return { ...p, score: Math.round(score * 100) }
  })
}

export const DEFAULT_WEIGHTS: ScoreWeights = { roi: 0.5, capRate: 0.3, profit: 0.2 }
```

- [ ] **Step 4: Write failing test `frontend/src/lib/checks.test.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import { runChecks } from './checks'

const valid = {
  latitude: 25.68, longitude: -100.33, landPrice: 3000000, sqmLand: 100,
  roi: 0.25, saleDate: '2027-01-01', investmentDate: '2025-06-01',
  constructionOverhead: 1.3, constructionCostPerSqm: 6000,
  rentMonthly: 20000, acquisitionCostPct: 0.06, profit: 1000000,
}

describe('runChecks', () => {
  it('returns empty array for valid prospect', () => {
    expect(runChecks(valid as any)).toHaveLength(0)
  })

  it('errors on zero latitude', () => {
    const issues = runChecks({ ...valid, latitude: 0 } as any)
    expect(issues.some(i => i.field === 'latitude' && i.severity === 'error')).toBe(true)
  })

  it('errors on negative roi', () => {
    const issues = runChecks({ ...valid, roi: -0.1 } as any)
    expect(issues.some(i => i.field === 'roi' && i.severity === 'error')).toBe(true)
  })

  it('warns on zero rent', () => {
    const issues = runChecks({ ...valid, rentMonthly: 0 } as any)
    expect(issues.some(i => i.field === 'rentMonthly' && i.severity === 'warning')).toBe(true)
  })
})
```

- [ ] **Step 5: Create `frontend/src/lib/checks.ts`**

```typescript
import type { Issue, Prospect } from './types'

export function runChecks(p: Prospect): Issue[] {
  const issues: Issue[] = []
  const today = new Date().toISOString().slice(0, 10)

  // Errors
  if (!p.latitude) issues.push({ field: 'latitude', message: 'Latitud es 0 o faltante', severity: 'error' })
  if (!p.longitude) issues.push({ field: 'longitude', message: 'Longitud es 0 o faltante', severity: 'error' })
  if (!p.landPrice) issues.push({ field: 'landPrice', message: 'Precio de terreno es 0', severity: 'error' })
  if (!p.sqmLand) issues.push({ field: 'sqmLand', message: 'Superficie terreno es 0', severity: 'error' })
  if (p.roi < 0) issues.push({ field: 'roi', message: `ROI negativo (${(p.roi * 100).toFixed(1)}%)`, severity: 'error' })
  if (p.saleDate && p.investmentDate && p.saleDate <= p.investmentDate)
    issues.push({ field: 'saleDate', message: `Fecha venta ≤ fecha inversión`, severity: 'error' })
  if (p.constructionOverhead < 1.0)
    issues.push({ field: 'constructionOverhead', message: `Overhead ${p.constructionOverhead} < 1.0`, severity: 'error' })

  // Warnings
  if (!p.constructionCostPerSqm)
    issues.push({ field: 'constructionCostPerSqm', message: 'Costo construcción/m² es 0', severity: 'warning' })
  if (!p.rentMonthly)
    issues.push({ field: 'rentMonthly', message: 'Renta mensual proyectada es 0', severity: 'warning' })
  if (p.acquisitionCostPct > 0.10)
    issues.push({ field: 'acquisitionCostPct', message: `Costos adquisición altos (${(p.acquisitionCostPct * 100).toFixed(1)}%)`, severity: 'warning' })
  if (p.investmentDate < today)
    issues.push({ field: 'investmentDate', message: `Fecha inversión ya pasó (${p.investmentDate})`, severity: 'warning' })
  if (p.profit < 500_000)
    issues.push({ field: 'profit', message: `Profit < $500k (${p.profit.toLocaleString('es-MX')} MXN)`, severity: 'warning' })

  return issues
}
```

- [ ] **Step 6: Run all frontend tests — pass**

```bash
cd frontend && npx vitest run
```

Expected: 7 PASSED (3 scoring + 4 checks)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/scoring.ts frontend/src/lib/checks.ts frontend/src/lib/scoring.test.ts frontend/src/lib/checks.test.ts
git commit -m "feat: add composite scoring and client-side quality checks with tests"
```

---

## Task 8: App shell — global styles, TabBar, routing

**Files:**
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/components/TabBar.tsx`

- [ ] **Step 1: Create `frontend/src/components/TabBar.tsx`**

```tsx
import { NavLink } from 'react-router-dom'
import { colors, fonts } from '../lib/theme'

const tabs = [
  { path: '/tabla', label: 'TABLA' },
  { path: '/mapa', label: 'MAPA' },
  { path: '/calidad', label: 'CALIDAD' },
]

export function TabBar() {
  return (
    <nav style={{
      display: 'flex',
      borderBottom: `1px solid ${colors.border}`,
      background: colors.dark,
      position: 'sticky',
      top: 0,
      zIndex: 100,
    }}>
      <span style={{
        padding: '0 24px',
        display: 'flex',
        alignItems: 'center',
        fontFamily: fonts.label,
        fontSize: '13px',
        letterSpacing: '0.15em',
        color: colors.primary,
        borderRight: `1px solid ${colors.border}`,
      }}>
        REFIGAN
      </span>
      {tabs.map(({ path, label }) => (
        <NavLink
          key={path}
          to={path}
          style={({ isActive }) => ({
            padding: '14px 20px',
            fontFamily: fonts.label,
            fontSize: '11px',
            letterSpacing: '0.12em',
            color: isActive ? colors.neutral : colors.secondary,
            borderBottom: isActive ? `2px solid ${colors.tertiary}` : '2px solid transparent',
            transition: 'color 0.15s',
          })}
        >
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
```

- [ ] **Step 2: Create `frontend/src/App.tsx`**

```tsx
import { Routes, Route, Navigate } from 'react-router-dom'
import { TabBar } from './components/TabBar'
import { ProspectTable } from './components/ProspectTable'
import { ProspectDetailPage } from './components/ProspectDetailPage'
import { ProspectMap } from './components/ProspectMap'
import { QualityTab } from './components/QualityTab'
import { globalStyles, colors } from './lib/theme'

export default function App() {
  return (
    <>
      <style>{globalStyles}</style>
      <div style={{ minHeight: '100vh', background: colors.dark }}>
        <TabBar />
        <Routes>
          <Route path="/" element={<Navigate to="/tabla" replace />} />
          <Route path="/tabla" element={<ProspectTable />} />
          <Route path="/tabla/:id" element={<ProspectDetailPage />} />
          <Route path="/mapa" element={<ProspectMap />} />
          <Route path="/calidad" element={<QualityTab />} />
        </Routes>
      </div>
    </>
  )
}
```

- [ ] **Step 3: Create stub components so the app compiles**

Create `frontend/src/components/ProspectTable.tsx`:
```tsx
export function ProspectTable() { return <div style={{padding:'32px',color:'#F2F0EB'}}>Tabla — coming soon</div> }
```

Create `frontend/src/components/ProspectDetailPage.tsx`:
```tsx
export function ProspectDetailPage() { return <div style={{padding:'32px',color:'#F2F0EB'}}>Detail — coming soon</div> }
```

Create `frontend/src/components/ProspectMap.tsx`:
```tsx
export function ProspectMap() { return <div style={{padding:'32px',color:'#F2F0EB'}}>Mapa — coming soon</div> }
```

Create `frontend/src/components/QualityTab.tsx`:
```tsx
export function QualityTab() { return <div style={{padding:'32px',color:'#F2F0EB'}}>Calidad — coming soon</div> }
```

Create `frontend/src/components/ProspectDrawer.tsx`:
```tsx
import type { Prospect } from '../lib/types'
interface Props { prospect: Prospect | null; onClose: () => void }
export function ProspectDrawer({ prospect, onClose }: Props) {
  if (!prospect) return null
  return <div style={{position:'fixed',right:0,top:0,width:'380px',height:'100vh',background:'#1e2e1e',padding:'24px',color:'#F2F0EB',zIndex:200}}>
    <button onClick={onClose} style={{color:'#7A7260',background:'none',border:'none',cursor:'pointer',marginBottom:'16px'}}>✕ Cerrar</button>
    <div>{prospect.name}</div>
  </div>
}
```

- [ ] **Step 4: Verify app compiles and loads**

```bash
# Ensure API is running: uvicorn api.main:app --reload &
cd frontend && npm run dev
```

Open `http://localhost:5173` — should show tab bar with REFIGAN · TABLA · MAPA · CALIDAD. Clicking tabs should navigate.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/
git commit -m "feat: add app shell with TabBar and routing"
```

---

## Task 9: ProspectTable with sorting, score, quality badges

**Files:**
- Modify: `frontend/src/components/ProspectTable.tsx`
- Create: `frontend/src/components/ScoreWeights.tsx`

- [ ] **Step 1: Create `frontend/src/components/ScoreWeights.tsx`**

```tsx
import { colors, fonts } from '../lib/theme'
import type { ScoreWeights } from '../lib/types'

interface Props {
  weights: ScoreWeights
  onChange: (w: ScoreWeights) => void
  open: boolean
  onToggle: () => void
}

export function ScoreWeights({ weights, onChange, open, onToggle }: Props) {
  const set = (key: keyof ScoreWeights, raw: number) => {
    const updated = { ...weights, [key]: raw / 100 }
    const sum = updated.roi + updated.capRate + updated.profit
    onChange({ roi: updated.roi / sum, capRate: updated.capRate / sum, profit: updated.profit / sum })
  }

  return (
    <div style={{ borderBottom: `1px solid ${colors.border}` }}>
      <button
        onClick={onToggle}
        style={{ width: '100%', padding: '10px 20px', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', color: colors.secondary, fontFamily: fonts.label, fontSize: '11px', letterSpacing: '0.1em' }}
      >
        {open ? '▼' : '▶'} &nbsp; PESOS DEL SCORE &nbsp;
        <span style={{ color: colors.tertiary }}>ROI {(weights.roi * 100).toFixed(0)}% · Cap {(weights.capRate * 100).toFixed(0)}% · Profit {(weights.profit * 100).toFixed(0)}%</span>
      </button>
      {open && (
        <div style={{ padding: '12px 20px 16px', display: 'flex', gap: '24px', background: colors.surfaceAlt }}>
          {(['roi', 'capRate', 'profit'] as const).map(key => (
            <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
              <span style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                {key === 'roi' ? 'ROI' : key === 'capRate' ? 'Cap Rate' : 'Profit'} — {(weights[key] * 100).toFixed(0)}%
              </span>
              <input
                type="range" min={0} max={100} value={Math.round(weights[key] * 100)}
                onChange={e => set(key, Number(e.target.value))}
                style={{ accentColor: colors.tertiary }}
              />
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Replace `frontend/src/components/ProspectTable.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { fetchProspects } from '../lib/api'
import { computeScores, DEFAULT_WEIGHTS } from '../lib/scoring'
import type { Prospect, ScoreWeights } from '../lib/types'
import { colors, fonts } from '../lib/theme'
import { ScoreWeights as ScoreWeightsPanel } from './ScoreWeights'
import { ProspectDrawer } from './ProspectDrawer'

type SortKey = 'score' | 'roi' | 'capRate' | 'profit' | 'totalInvestment'

function fmt(n: number, type: 'pct' | 'mxn' | 'score') {
  if (type === 'pct') return n ? `${(n * 100).toFixed(1)}%` : '—'
  if (type === 'mxn') return n ? `$${(n / 1_000_000).toFixed(1)}M` : '—'
  return String(n)
}

export function ProspectTable() {
  const [prospects, setProspects] = useState<Prospect[]>([])
  const [weights, setWeights] = useState<ScoreWeights>(DEFAULT_WEIGHTS)
  const [sortKey, setSortKey] = useState<SortKey>('score')
  const [sortAsc, setSortAsc] = useState(false)
  const [weightsOpen, setWeightsOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  const selectedId = searchParams.get('id') ? Number(searchParams.get('id')) : null
  const selected = prospects.find(p => p.id === selectedId) ?? null

  useEffect(() => {
    fetchProspects()
      .then(data => setProspects(computeScores(data, weights)))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    setProspects(prev => computeScores(prev, weights))
  }, [weights])

  const sorted = [...prospects].sort((a, b) => {
    const diff = (a[sortKey] as number) - (b[sortKey] as number)
    return sortAsc ? diff : -diff
  })

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(false) }
  }

  const colHeader = (key: SortKey, label: string) => (
    <th
      onClick={() => toggleSort(key)}
      style={{ padding: '10px 12px', fontFamily: fonts.label, fontSize: '10px', color: sortKey === key ? colors.tertiary : colors.secondary, textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer', textAlign: 'right', whiteSpace: 'nowrap' }}
    >
      {label} {sortKey === key ? (sortAsc ? '↑' : '↓') : ''}
    </th>
  )

  if (loading) return <div style={{ padding: '32px', color: colors.secondary }}>Cargando…</div>
  if (error) return <div style={{ padding: '32px', color: 'tomato' }}>Error: {error}</div>

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 49px)' }}>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <ScoreWeightsPanel weights={weights} onChange={setWeights} open={weightsOpen} onToggle={() => setWeightsOpen(o => !o)} />
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ position: 'sticky', top: 0, background: colors.dark, zIndex: 10 }}>
            <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
              <th style={{ padding: '10px 12px', fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.1em', textAlign: 'left' }}>PROSPECTO</th>
              {colHeader('score', 'SCORE')}
              {colHeader('roi', 'ROI')}
              {colHeader('capRate', 'CAP RATE')}
              {colHeader('profit', 'PROFIT')}
              {colHeader('totalInvestment', 'INVERSIÓN')}
              <th style={{ padding: '10px 12px', width: '32px' }}></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(p => {
              const errors = p.issues.filter(i => i.severity === 'error').length
              const warnings = p.issues.filter(i => i.severity === 'warning').length
              const isSelected = p.id === selectedId
              return (
                <tr
                  key={p.id}
                  onClick={() => setSearchParams({ id: String(p.id) })}
                  style={{ borderBottom: `1px solid ${colors.border}`, cursor: 'pointer', background: isSelected ? `${colors.tertiary}18` : 'transparent' }}
                  onMouseEnter={e => (e.currentTarget.style.background = isSelected ? `${colors.tertiary}18` : `${colors.border}55`)}
                  onMouseLeave={e => (e.currentTarget.style.background = isSelected ? `${colors.tertiary}18` : 'transparent')}
                >
                  <td style={{ padding: '10px 12px', color: colors.neutral, fontFamily: fonts.sans, maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    <span style={{ background: p.score >= 70 ? colors.tertiary : p.score >= 40 ? colors.accent1 : colors.secondary, color: colors.neutral, fontFamily: fonts.label, fontSize: '11px', padding: '2px 7px', borderRadius: '2px' }}>{p.score}</span>
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: colors.tertiary, fontFamily: fonts.label, fontSize: '12px' }}>{fmt(p.roi, 'pct')}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: colors.primary, fontFamily: fonts.label, fontSize: '12px' }}>{fmt(p.capRate, 'pct')}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: colors.neutral, fontFamily: fonts.label, fontSize: '12px' }}>{fmt(p.profit, 'mxn')}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: colors.secondary, fontFamily: fonts.label, fontSize: '12px' }}>{fmt(p.totalInvestment, 'mxn')}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: '13px' }}>
                    {errors > 0 ? '🔴' : warnings > 0 ? '⚠️' : ''}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <ProspectDrawer
        prospect={selected}
        onClose={() => setSearchParams({})}
        onOpenDetail={id => navigate(`/tabla/${id}`)}
      />
    </div>
  )
}
```

- [ ] **Step 3: Verify table renders with real data**

Start API: `uvicorn api.main:app --reload &`
Start frontend: `cd frontend && npm run dev`
Open `http://localhost:5173/tabla`
- Table should show 11 prospects
- Score column should be present
- Clicking column headers should sort
- Quality badges should appear on rows with issues

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ProspectTable.tsx frontend/src/components/ScoreWeights.tsx
git commit -m "feat: implement ProspectTable with sorting, score badges, quality indicators"
```

---

## Task 10: ProspectDrawer

**Files:**
- Modify: `frontend/src/components/ProspectDrawer.tsx`

- [ ] **Step 1: Replace `frontend/src/components/ProspectDrawer.tsx`**

```tsx
import { useNavigate } from 'react-router-dom'
import type { Prospect } from '../lib/types'
import { colors, fonts } from '../lib/theme'

interface Props {
  prospect: Prospect | null
  onClose: () => void
  onOpenDetail: (id: number) => void
}

function MetricBlock({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ background: colors.border, borderRadius: '2px', padding: '12px', flex: 1 }}>
      <div style={{ fontFamily: fonts.serif, fontSize: '22px', color: accent ? colors.tertiary : colors.neutral, lineHeight: 1 }}>{value}</div>
      <div style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: '4px' }}>{label}</div>
    </div>
  )
}

function fmt(n: number, type: 'pct' | 'mxn') {
  if (!n) return '—'
  if (type === 'pct') return `${(n * 100).toFixed(1)}%`
  return `$${(n / 1_000_000).toFixed(1)}M`
}

export function ProspectDrawer({ prospect, onClose, onOpenDetail }: Props) {
  if (!prospect) return null

  const errors = prospect.issues.filter(i => i.severity === 'error')
  const warnings = prospect.issues.filter(i => i.severity === 'warning')

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 199 }}
      />
      <aside style={{
        position: 'fixed', right: 0, top: 49, bottom: 0, width: '380px',
        background: colors.surfaceAlt, borderLeft: `1px solid ${colors.border}`,
        overflowY: 'auto', zIndex: 200, padding: '20px',
        display: 'flex', flexDirection: 'column', gap: '16px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontFamily: fonts.serif, fontSize: '18px', color: colors.neutral, lineHeight: 1.2 }}>{prospect.name}</div>
            <div style={{ fontFamily: fonts.sans, fontSize: '12px', color: colors.secondary, marginTop: '4px' }}>{prospect.address}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: colors.secondary, cursor: 'pointer', fontSize: '18px', lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <span style={{ background: colors.tertiary, color: colors.neutral, fontFamily: fonts.label, fontSize: '12px', padding: '3px 8px', borderRadius: '2px' }}>Score {prospect.score}</span>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <MetricBlock label="ROI" value={fmt(prospect.roi, 'pct')} accent />
          <MetricBlock label="Cap Rate" value={fmt(prospect.capRate, 'pct')} />
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <MetricBlock label="Profit" value={fmt(prospect.profit, 'mxn')} accent />
          <MetricBlock label="Inversión" value={fmt(prospect.totalInvestment, 'mxn')} />
        </div>

        {(errors.length > 0 || warnings.length > 0) && (
          <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: '12px' }}>
            <div style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '8px' }}>Calidad de datos</div>
            {errors.map((issue, i) => (
              <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '6px', fontSize: '12px' }}>
                <span>🔴</span><span style={{ color: colors.neutral }}>{issue.message}</span>
              </div>
            ))}
            {warnings.map((issue, i) => (
              <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '6px', fontSize: '12px' }}>
                <span>⚠️</span><span style={{ color: colors.secondary }}>{issue.message}</span>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={() => onOpenDetail(prospect.id)}
          style={{
            marginTop: 'auto', padding: '12px', background: colors.tertiary, color: colors.neutral,
            border: 'none', borderRadius: '2px', cursor: 'pointer',
            fontFamily: fonts.label, fontSize: '12px', letterSpacing: '0.1em',
          }}
        >
          ABRIR DETALLE →
        </button>
      </aside>
    </>
  )
}
```

- [ ] **Step 2: Verify drawer works**

In browser at `http://localhost:5173/tabla`, click any row. Drawer should slide in from right with metrics and quality issues. "ABRIR DETALLE →" should navigate to `/tabla/:id`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ProspectDrawer.tsx
git commit -m "feat: implement ProspectDrawer with metrics, quality issues, and detail link"
```

---

## Task 11: ProspectDetailPage

**Files:**
- Modify: `frontend/src/components/ProspectDetailPage.tsx`

- [ ] **Step 1: Replace `frontend/src/components/ProspectDetailPage.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import { fetchProspect } from '../lib/api'
import type { Prospect } from '../lib/types'
import { colors, fonts } from '../lib/theme'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: '32px' }}>
      <div style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px', borderBottom: `1px solid ${colors.border}`, paddingBottom: '8px' }}>{title}</div>
      {children}
    </section>
  )
}

function Hero({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontFamily: fonts.serif, fontSize: '36px', color: colors.tertiary, lineHeight: 1 }}>{value}</div>
      <div style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.12em', marginTop: '6px' }}>{label}</div>
    </div>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${colors.border}`, fontFamily: fonts.sans, fontSize: '13px' }}>
      <span style={{ color: colors.secondary }}>{label}</span>
      <span style={{ color: bold ? colors.neutral : colors.neutral, fontWeight: bold ? 600 : 400 }}>{value}</span>
    </div>
  )
}

function fmt(n: number, type: 'pct' | 'mxn') {
  if (!n) return '—'
  if (type === 'pct') return `${(n * 100).toFixed(1)}%`
  return `$${n.toLocaleString('es-MX')} MXN`
}

function monthsBetween(a: string, b: string): number {
  const [ya, ma] = a.split('-').map(Number)
  const [yb, mb] = b.split('-').map(Number)
  return (yb - ya) * 12 + (mb - ma)
}

export function ProspectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [prospect, setProspect] = useState<Prospect | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchProspect(Number(id))
      .then(setProspect)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <div style={{ padding: '32px', color: colors.secondary }}>Cargando…</div>
  if (error || !prospect) return <div style={{ padding: '32px', color: 'tomato' }}>{error ?? 'No encontrado'}</div>

  const hasCoords = prospect.latitude !== 0 && prospect.longitude !== 0
  const errors = prospect.issues.filter(i => i.severity === 'error')
  const warnings = prospect.issues.filter(i => i.severity === 'warning')
  const duration = prospect.investmentDate && prospect.saleDate
    ? monthsBetween(prospect.investmentDate, prospect.saleDate)
    : null

  return (
    <div style={{ maxWidth: '760px', margin: '0 auto', padding: '32px 20px' }}>
      <button
        onClick={() => navigate('/tabla')}
        style={{ background: 'none', border: 'none', color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '11px', letterSpacing: '0.1em', marginBottom: '24px', padding: 0 }}
      >
        ← PROSPECTOS
      </button>

      <h1 style={{ fontFamily: fonts.serif, fontSize: '28px', color: colors.neutral, marginBottom: '8px' }}>{prospect.name}</h1>
      <div style={{ fontFamily: fonts.sans, fontSize: '13px', color: colors.secondary, marginBottom: '32px' }}>{prospect.address} · {prospect.sqmLand} m²</div>

      <Section title="Métricas clave">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', background: colors.surfaceAlt, padding: '24px', borderRadius: '2px' }}>
          <Hero label="ROI" value={fmt(prospect.roi, 'pct')} />
          <Hero label="Profit" value={`$${(prospect.profit / 1_000_000).toFixed(1)}M`} />
          <Hero label="Cap Rate" value={fmt(prospect.capRate, 'pct')} />
          <Hero label="Score" value={String(prospect.score ?? '—')} />
        </div>
      </Section>

      <Section title="Desglose de inversión">
        <Row label="Precio terreno" value={fmt(prospect.landPrice, 'mxn')} />
        <Row label={`Costos adquisición (${(prospect.acquisitionCostPct * 100).toFixed(1)}%)`} value={fmt(prospect.acquisitionCosts, 'mxn')} />
        <Row label="Permisos" value={fmt(prospect.permitsCost, 'mxn')} />
        <Row label="Subdivisión" value={fmt(prospect.subdivisionCost, 'mxn')} />
        <Row label={`Construcción (${prospect.constructionCostPerSqm?.toLocaleString('es-MX')}/m² × ${prospect.sqmConstruction} m²)`} value={fmt(prospect.constructionBase, 'mxn')} />
        <Row label={`+ IVA/indirectos (×${prospect.constructionOverhead})`} value={fmt(prospect.constructionTotal, 'mxn')} />
        <Row label="INVERSIÓN TOTAL" value={fmt(prospect.totalInvestment, 'mxn')} bold />
        <Row label="Venta proyectada" value={fmt(prospect.projectedSale, 'mxn')} />
        <Row label="PROFIT" value={fmt(prospect.profit, 'mxn')} bold />
      </Section>

      {hasCoords && (
        <Section title="Ubicación">
          <div style={{ height: '320px', borderRadius: '2px', overflow: 'hidden' }}>
            <MapContainer center={[prospect.latitude, prospect.longitude]} zoom={15} style={{ height: '100%', width: '100%' }}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" />
              <CircleMarker center={[prospect.latitude, prospect.longitude]} radius={10} pathOptions={{ color: colors.tertiary, fillColor: colors.tertiary, fillOpacity: 1 }}>
                <Popup>{prospect.name}</Popup>
              </CircleMarker>
            </MapContainer>
          </div>
        </Section>
      )}

      {prospect.investmentDate && prospect.saleDate && (
        <Section title="Timeline">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontFamily: fonts.sans, fontSize: '13px' }}>
            <span style={{ color: colors.neutral }}>{prospect.investmentDate}</span>
            <span style={{ flex: 1, borderTop: `1px solid ${colors.tertiary}`, position: 'relative' }}>
              {duration !== null && (
                <span style={{ position: 'absolute', top: '-18px', left: '50%', transform: 'translateX(-50%)', fontFamily: fonts.label, fontSize: '10px', color: colors.tertiary, whiteSpace: 'nowrap' }}>{duration} meses</span>
              )}
            </span>
            <span style={{ color: colors.neutral }}>{prospect.saleDate}</span>
          </div>
        </Section>
      )}

      {(errors.length > 0 || warnings.length > 0) && (
        <Section title="Calidad de datos">
          {errors.map((issue, i) => (
            <div key={i} style={{ display: 'flex', gap: '10px', padding: '8px 0', borderBottom: `1px solid ${colors.border}`, fontSize: '13px' }}>
              <span>🔴</span>
              <div>
                <span style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{issue.field}</span>
                <div style={{ color: colors.neutral, marginTop: '2px' }}>{issue.message}</div>
              </div>
            </div>
          ))}
          {warnings.map((issue, i) => (
            <div key={i} style={{ display: 'flex', gap: '10px', padding: '8px 0', borderBottom: `1px solid ${colors.border}`, fontSize: '13px' }}>
              <span>⚠️</span>
              <div>
                <span style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{issue.field}</span>
                <div style={{ color: colors.secondary, marginTop: '2px' }}>{issue.message}</div>
              </div>
            </div>
          ))}
        </Section>
      )}

      <Section title="Todos los campos">
        {Object.entries(prospect)
          .filter(([k]) => !['issues', 'score'].includes(k))
          .map(([k, v]) => (
            <Row key={k} label={k} value={String(v ?? '—')} />
          ))}
      </Section>
    </div>
  )
}
```

- [ ] **Step 2: Verify detail page**

Click a prospect row → drawer opens → click "ABRIR DETALLE →" → full page with hero metrics, cost breakdown, map, timeline, quality section, raw fields.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ProspectDetailPage.tsx
git commit -m "feat: implement ProspectDetailPage with cost breakdown, map, timeline, quality"
```

---

## Task 12: ProspectMap

**Files:**
- Modify: `frontend/src/components/ProspectMap.tsx`

- [ ] **Step 1: Replace `frontend/src/components/ProspectMap.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import { fetchProspects } from '../lib/api'
import { computeScores, DEFAULT_WEIGHTS } from '../lib/scoring'
import type { Prospect } from '../lib/types'
import { colors, fonts } from '../lib/theme'
import { ProspectDrawer } from './ProspectDrawer'
import { useNavigate } from 'react-router-dom'

function pinColor(score: number): string {
  if (score >= 75) return colors.tertiary   // top quartile — terracotta
  if (score >= 50) return '#D4891A'          // second quartile — amber
  if (score >= 25) return colors.accent2    // third quartile — slate
  return colors.secondary                   // bottom quartile — stone
}

export function ProspectMap() {
  const [prospects, setProspects] = useState<Prospect[]>([])
  const [loading, setLoading] = useState(true)
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  const selectedId = searchParams.get('id') ? Number(searchParams.get('id')) : null
  const selected = prospects.find(p => p.id === selectedId) ?? null

  useEffect(() => {
    fetchProspects()
      .then(data => setProspects(computeScores(data, DEFAULT_WEIGHTS)))
      .finally(() => setLoading(false))
  }, [])

  const withCoords = prospects.filter(p => p.latitude !== 0 && p.longitude !== 0)
  const noCoords = prospects.filter(p => p.latitude === 0 || p.longitude === 0)

  if (loading) return <div style={{ padding: '32px', color: colors.secondary }}>Cargando…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 49px)' }}>
      <div style={{ flex: 1, position: 'relative' }}>
        <MapContainer
          center={[25.6866, -100.3161]}
          zoom={13}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap contributors" />
          {withCoords.map(p => (
            <CircleMarker
              key={p.id}
              center={[p.latitude, p.longitude]}
              radius={p.id === selectedId ? 14 : 10}
              pathOptions={{
                color: colors.dark,
                weight: 2,
                fillColor: pinColor(p.score),
                fillOpacity: 0.9,
              }}
              eventHandlers={{ click: () => setSearchParams({ id: String(p.id) }) }}
            >
              <Popup>
                <strong>{p.name}</strong><br />
                ROI {p.roi ? `${(p.roi * 100).toFixed(1)}%` : '—'} · Score {p.score}
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
      {noCoords.length > 0 && (
        <div style={{ padding: '10px 16px', background: colors.surfaceAlt, borderTop: `1px solid ${colors.border}`, fontFamily: fonts.sans, fontSize: '12px', color: colors.secondary }}>
          ⚠️ {noCoords.length} prospecto{noCoords.length > 1 ? 's' : ''} sin coordenadas: {noCoords.map(p => p.name).join(', ')}
        </div>
      )}
      <ProspectDrawer
        prospect={selected}
        onClose={() => setSearchParams({})}
        onOpenDetail={id => navigate(`/tabla/${id}`)}
      />
    </div>
  )
}
```

- [ ] **Step 2: Verify map**

Open `http://localhost:5173/mapa`. Pins should appear on Monterrey. Colors vary by score quartile. Click a pin → drawer opens. Warning banner shows prospects without coordinates.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ProspectMap.tsx
git commit -m "feat: implement Leaflet prospect map with score-colored pins"
```

---

## Task 13: QualityTab

**Files:**
- Modify: `frontend/src/components/QualityTab.tsx`

- [ ] **Step 1: Replace `frontend/src/components/QualityTab.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { fetchProspects } from '../lib/api'
import { computeScores, DEFAULT_WEIGHTS } from '../lib/scoring'
import type { Prospect } from '../lib/types'
import { colors, fonts } from '../lib/theme'
import { ProspectDrawer } from './ProspectDrawer'

export function QualityTab() {
  const [prospects, setProspects] = useState<Prospect[]>([])
  const [loading, setLoading] = useState(true)
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  const selectedId = searchParams.get('id') ? Number(searchParams.get('id')) : null
  const selected = prospects.find(p => p.id === selectedId) ?? null

  useEffect(() => {
    fetchProspects()
      .then(data => setProspects(computeScores(data, DEFAULT_WEIGHTS)))
      .finally(() => setLoading(false))
  }, [])

  const withIssues = prospects
    .filter(p => p.issues.length > 0)
    .sort((a, b) => {
      const aErrors = a.issues.filter(i => i.severity === 'error').length
      const bErrors = b.issues.filter(i => i.severity === 'error').length
      return bErrors !== aErrors ? bErrors - aErrors : b.score - a.score
    })
  const clean = prospects.filter(p => p.issues.length === 0)

  const totalErrors = prospects.flatMap(p => p.issues).filter(i => i.severity === 'error').length
  const totalWarnings = prospects.flatMap(p => p.issues).filter(i => i.severity === 'warning').length

  if (loading) return <div style={{ padding: '32px', color: colors.secondary }}>Cargando…</div>

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 49px)' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
        <div style={{ marginBottom: '24px' }}>
          <h2 style={{ fontFamily: fonts.serif, fontSize: '22px', color: colors.neutral, marginBottom: '6px' }}>Calidad de datos</h2>
          <div style={{ fontFamily: fonts.label, fontSize: '11px', color: colors.secondary, letterSpacing: '0.08em' }}>
            {totalErrors > 0 && <span style={{ color: 'tomato', marginRight: '12px' }}>🔴 {totalErrors} errores</span>}
            {totalWarnings > 0 && <span style={{ color: '#D4891A', marginRight: '12px' }}>⚠️ {totalWarnings} advertencias</span>}
            en {withIssues.length} de {prospects.length} prospectos
          </div>
        </div>

        {withIssues.map(p => {
          const errors = p.issues.filter(i => i.severity === 'error')
          const warnings = p.issues.filter(i => i.severity === 'warning')
          return (
            <div
              key={p.id}
              onClick={() => setSearchParams({ id: String(p.id) })}
              style={{ background: colors.surfaceAlt, border: `1px solid ${colors.border}`, borderRadius: '2px', padding: '16px', marginBottom: '12px', cursor: 'pointer' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                <span style={{ fontFamily: fonts.sans, fontSize: '14px', color: colors.neutral }}>{p.name}</span>
                <span style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary }}>
                  {errors.length > 0 && <span style={{ color: 'tomato', marginRight: '8px' }}>🔴 {errors.length}</span>}
                  {warnings.length > 0 && <span style={{ color: '#D4891A' }}>⚠️ {warnings.length}</span>}
                </span>
              </div>
              {errors.map((issue, i) => (
                <div key={i} style={{ display: 'flex', gap: '8px', fontSize: '12px', color: colors.neutral, marginBottom: '4px' }}>
                  <span style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, minWidth: '140px', textTransform: 'uppercase' }}>{issue.field}</span>
                  <span>{issue.message}</span>
                </div>
              ))}
              {warnings.map((issue, i) => (
                <div key={i} style={{ display: 'flex', gap: '8px', fontSize: '12px', color: colors.secondary, marginBottom: '4px' }}>
                  <span style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, minWidth: '140px', textTransform: 'uppercase' }}>{issue.field}</span>
                  <span>{issue.message}</span>
                </div>
              ))}
            </div>
          )
        })}

        {clean.length > 0 && (
          <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: `1px solid ${colors.border}` }}>
            <div style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '8px' }}>Sin problemas</div>
            {clean.map(p => (
              <div key={p.id} style={{ padding: '8px 0', borderBottom: `1px solid ${colors.border}`, fontFamily: fonts.sans, fontSize: '13px', color: colors.primary }}>
                ✓ {p.name}
              </div>
            ))}
          </div>
        )}
      </div>
      <ProspectDrawer
        prospect={selected}
        onClose={() => setSearchParams({})}
        onOpenDetail={id => navigate(`/tabla/${id}`)}
      />
    </div>
  )
}
```

- [ ] **Step 2: Verify quality tab**

Open `http://localhost:5173/calidad`. Should show summary count, cards per prospect with issues, clean prospects at the bottom. Click a card → drawer opens.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/QualityTab.tsx
git commit -m "feat: implement QualityTab with grouped errors, warnings, and clean list"
```

---

## Task 14: End-to-end verification

- [ ] **Step 1: Full reset + start**

```bash
make reset
make api &
sleep 2
cd frontend && npm run dev &
sleep 3
```

- [ ] **Step 2: Run all tests**

```bash
python3 -m pytest api/tests/ -v
cd frontend && npx vitest run
```

Expected: all pass (backend + frontend)

- [ ] **Step 3: Verify Tabla tab**

Open `http://localhost:5173/tabla`
- [ ] 11 rows visible
- [ ] Default sort: Lote 9811380 near top (highest score)
- [ ] Clicking "ROI" header sorts by ROI descending, click again → ascending
- [ ] Rows with quality issues show 🔴 or ⚠️
- [ ] Click any row → drawer opens, metrics shown
- [ ] "ABRIR DETALLE →" navigates to detail page

- [ ] **Step 4: Verify Mapa tab**

Open `http://localhost:5173/mapa`
- [ ] Map centered on Monterrey
- [ ] Colored pins visible (multiple colors by score)
- [ ] Warning banner shows prospects without coordinates
- [ ] Click pin → drawer opens

- [ ] **Step 5: Verify Calidad tab**

Open `http://localhost:5173/calidad`
- [ ] Summary shows error + warning counts
- [ ] Prospects with errors listed first
- [ ] Clean prospects at bottom with ✓

- [ ] **Step 6: Verify Detail page**

Click a prospect with all data → "ABRIR DETALLE →"
- [ ] Hero metrics: ROI, profit, cap rate, score
- [ ] Cost breakdown rows sum to total investment
- [ ] Map inset shows pin at correct location
- [ ] Timeline shows investment → sale date with month count
- [ ] Quality section present

- [ ] **Step 7: Final commit**

```bash
git add .
git commit -m "feat: complete Refigan dashboard — Tabla, Mapa, Calidad tabs"
```
