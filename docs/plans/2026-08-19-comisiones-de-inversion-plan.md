# Comisiones de inversión Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add three configurable per-property fund fees (land-purchase commission, construction-value commission, exit commission — sale % or N months' rent) and expose a new "investment with fees" figure alongside the existing (renamed) "investment without fees".

**Architecture:** Five new nullable columns on `properties` (four percentage/months assumptions resolved through `underwriting.ASSUMPTION_DEFAULTS`, one plain captured `exit_strategy` field). A new pure module `app/api/finance/fees.py` (mirrors `finance/waterfall.py`'s style: explicit sourcing, `missingInputs`, never a silent guess) computes the fee lines from `basis` + the raw row. `properties_db.py::metrics()` merges its output in. Everything rides the existing `PATCH /api/properties/{id}` — no new routes.

**Tech Stack:** FastAPI, psycopg2/Decimal, dbmate SQL migrations, React/TypeScript, Vitest, pytest.

**Read before starting, in full:** `app/api/finance/underwriting.py`, `app/api/finance/waterfall.py`, the design doc `docs/plans/2026-08-19-comisiones-de-inversion-design.md`.

---

### Task 1: Migration — five columns on `properties`

**Files:**
- Create: `db/migrations/049_property_fees.sql`

**Step 1: Write the migration**

```sql
-- migrate:up

-- Comisiones propias del fondo sobre cada propiedad — ver
-- docs/plans/2026-08-19-comisiones-de-inversion-design.md. Tres son
-- porcentajes-con-default (mismo molde que acquisition_cost_pct: nulo hasta
-- que alguien captura, default vivo en Python mientras tanto — sus defaults
-- NO van aquí, van en underwriting.ASSUMPTION_DEFAULTS, un solo lugar).
-- exit_rent_months es un multiplicador con el mismo molde. exit_strategy es
-- distinto: un hecho capturado, sin default — nulo significa que nadie ha
-- decidido el camino de salida todavía, y ninguna comisión de salida se
-- adivina a partir de eso.
ALTER TABLE properties ADD COLUMN land_commission_pct real;
ALTER TABLE properties ADD COLUMN construction_commission_pct real;
ALTER TABLE properties ADD COLUMN exit_sale_commission_pct real;
ALTER TABLE properties ADD COLUMN exit_rent_months real;
ALTER TABLE properties ADD COLUMN exit_strategy text;

ALTER TABLE properties ADD CONSTRAINT properties_land_commission_pct_check
  CHECK (land_commission_pct IS NULL OR land_commission_pct >= 0);
ALTER TABLE properties ADD CONSTRAINT properties_construction_commission_pct_check
  CHECK (construction_commission_pct IS NULL OR construction_commission_pct >= 0);
ALTER TABLE properties ADD CONSTRAINT properties_exit_sale_commission_pct_check
  CHECK (exit_sale_commission_pct IS NULL OR exit_sale_commission_pct >= 0);
ALTER TABLE properties ADD CONSTRAINT properties_exit_rent_months_check
  CHECK (exit_rent_months IS NULL OR exit_rent_months >= 0);
ALTER TABLE properties ADD CONSTRAINT properties_exit_strategy_check
  CHECK (exit_strategy IS NULL OR exit_strategy IN ('venta', 'renta'));

-- migrate:down

ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_exit_strategy_check;
ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_exit_rent_months_check;
ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_exit_sale_commission_pct_check;
ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_construction_commission_pct_check;
ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_land_commission_pct_check;
ALTER TABLE properties DROP COLUMN IF EXISTS exit_strategy;
ALTER TABLE properties DROP COLUMN IF EXISTS exit_rent_months;
ALTER TABLE properties DROP COLUMN IF EXISTS exit_sale_commission_pct;
ALTER TABLE properties DROP COLUMN IF EXISTS construction_commission_pct;
ALTER TABLE properties DROP COLUMN IF EXISTS land_commission_pct;
```

**Step 2: Lint it (the same check CI runs)**

Run: `grep -rEin "^\s*(CREATE TABLE|CREATE UNIQUE INDEX|CREATE INDEX)" db/migrations/049_property_fees.sql | grep -iv "IF NOT EXISTS"`
Expected: empty output (this migration has no CREATE TABLE/INDEX, so it trivially passes — run it anyway, it's the house habit).

**Step 3: Verify interactively against real Postgres before applying for real**

Run, against the worktree's own test DB (`psql "$TEST_DATABASE_URL"` after `set -a; source .env; set +a` from the worktree root):

```sql
BEGIN;
\i db/migrations/049_property_fees.sql
-- negative value must fail
INSERT INTO properties (name, address, city, status, url, latitude, longitude, land_commission_pct)
VALUES ('[T]', 'x', 'Monterrey', 'prospecto', 'http://x', 25.6, -100.3, -0.01);
-- expect: ERROR, properties_land_commission_pct_check
ROLLBACK;

BEGIN;
\i db/migrations/049_property_fees.sql
-- null and a valid value must both pass
INSERT INTO properties (name, address, city, status, url, latitude, longitude, exit_strategy)
VALUES ('[T]', 'x', 'Monterrey', 'prospecto', 'http://x', 25.6, -100.3, 'venta');
-- expect: INSERT 0 1
INSERT INTO properties (name, address, city, status, url, latitude, longitude, exit_strategy)
VALUES ('[T2]', 'x', 'Monterrey', 'prospecto', 'http://x', 25.6, -100.3, 'alquiler');
-- expect: ERROR, properties_exit_strategy_check
ROLLBACK;
```

Expected: exactly the errors/successes annotated above. Do not proceed until this matches.

**Step 4: Apply to both local DBs**

Run: `DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2-)?sslmode=disable" dbmate --migrations-dir db/migrations --no-dump-schema up`
Run: `DATABASE_URL="$(grep '^TEST_DATABASE_URL=' .env | cut -d= -f2-)?sslmode=disable" dbmate --migrations-dir db/migrations --no-dump-schema up`

Expected both times: `Applying: 049_property_fees.sql` / `Applied: 049_property_fees.sql in ...ms`.

**Step 5: Commit**

```bash
git add db/migrations/049_property_fees.sql
git commit -m "feat(db): cinco columnas de comisiones de inversión en properties"
```

---

### Task 2: `underwriting.py` — four new assumption defaults

**Files:**
- Modify: `app/api/finance/underwriting.py`

**Step 1: Add the four keys to `ASSUMPTION_DEFAULTS`**

At `app/api/finance/underwriting.py:74-77`, change:

```python
ASSUMPTION_DEFAULTS: dict[str, Decimal | int] = {
    "acquisition_cost_pct": Decimal("0.065"),
    "hold_months": 12,
}
```

to:

```python
ASSUMPTION_DEFAULTS: dict[str, Decimal | int] = {
    "acquisition_cost_pct": Decimal("0.065"),
    "hold_months": 12,
    # Comisiones del fondo — ver finance/fees.py, que es quien de verdad las
    # aplica. Viven aquí y no allá por la misma regla que las dos de arriba:
    # un solo lugar con nombre para todo default que mueve dinero.
    "land_commission_pct": Decimal("0.05"),
    "construction_commission_pct": Decimal("0.15"),
    "exit_sale_commission_pct": Decimal("0.05"),
    "exit_rent_months": Decimal("3"),
}
```

`ASSUMPTION_KEYS = tuple(ASSUMPTION_DEFAULTS)` (line 79) picks these up automatically — do not touch it.

**Step 2: Run the existing underwriting tests to confirm nothing broke**

Run: `cd app/api && ../../.venv/bin/python -m pytest tests/test_finance_underwriting.py -q`
Expected: all existing tests still pass (this change is additive; if anything iterates `ASSUMPTION_KEYS` and asserts an exact count/tuple, it will need updating — read the failure and fix the test's expectation, don't revert the production change).

**Step 3: Commit**

```bash
git add app/api/finance/underwriting.py
git commit -m "feat(finance): defaults de las comisiones de inversión, junto a los que ya existen"
```

---

### Task 3: `app/api/finance/fees.py` — the computation module (TDD)

**Files:**
- Create: `app/api/finance/fees.py`
- Test: `app/api/tests/test_finance_fees.py`

**Step 1: Write the failing tests**

Read `app/api/tests/test_finance_underwriting.py` and `app/api/tests/test_finance_waterfall.py` first for the exact fixture/assertion style used in this codebase (plain dicts in, dict out, `Decimal`/`None` comparisons) — mirror it, don't invent a new style.

```python
# app/api/tests/test_finance_fees.py
from decimal import Decimal

from api.finance import fees


def _row(**over):
    base = {
        "purchase_price": Decimal("1000000"),
        "acquisition_cost_pct": None,   # not this module's concern, but present on a real row
        "construction_budgeted": Decimal("500000"),
        "projected_sale": Decimal("2000000"),
        "sale_price": None,
        "rent_monthly_projected": Decimal("15000"),
        "rent_monthly_actual": None,
        "exit_strategy": None,
        "land_commission_pct": None,
        "construction_commission_pct": None,
        "exit_sale_commission_pct": None,
        "exit_rent_months": None,
    }
    base.update(over)
    return base


def test_land_and_construction_fees_use_model_defaults_when_uncaptured():
    out = fees.compute_fees(_row(), basis=Decimal("1500000"))
    assert out["landFee"] == Decimal("50000")           # 5% of 1,000,000
    assert out["constructionFee"] == Decimal("75000")   # 15% of 500,000


def test_a_captured_pct_overrides_the_default():
    out = fees.compute_fees(_row(land_commission_pct=Decimal("0.10")), basis=Decimal("1500000"))
    assert out["landFee"] == Decimal("100000")


def test_sin_exit_strategy_no_exit_fee_y_se_nombra_el_faltante():
    out = fees.compute_fees(_row(exit_strategy=None), basis=Decimal("1500000"))
    assert out["exitFee"] is None
    assert out["totalFees"] is None
    assert out["totalInvestmentWithFees"] is None
    assert "exitStrategy" in out["missingInputs"]


def test_venta_usa_projected_sale_antes_de_la_venta_real():
    out = fees.compute_fees(_row(exit_strategy="venta"), basis=Decimal("1500000"))
    assert out["exitFee"] == Decimal("100000")   # 5% of 2,000,000 projected_sale


def test_venta_usa_sale_price_una_vez_vendida():
    out = fees.compute_fees(
        _row(exit_strategy="venta", sale_price=Decimal("2200000")), basis=Decimal("1500000"))
    assert out["exitFee"] == Decimal("110000")   # 5% of 2,200,000 sale_price, not projected_sale


def test_renta_usa_rent_monthly_projected_por_los_meses_configurados():
    out = fees.compute_fees(_row(exit_strategy="renta"), basis=Decimal("1500000"))
    assert out["exitFee"] == Decimal("45000")    # 15,000 * 3


def test_renta_usa_rent_monthly_actual_una_vez_rentada():
    out = fees.compute_fees(
        _row(exit_strategy="renta", rent_monthly_actual=Decimal("18000")), basis=Decimal("1500000"))
    assert out["exitFee"] == Decimal("54000")    # 18,000 * 3, not projected


def test_total_fees_y_total_investment_with_fees_suman_las_tres():
    out = fees.compute_fees(_row(exit_strategy="venta"), basis=Decimal("1500000"))
    assert out["totalFees"] == Decimal("50000") + Decimal("75000") + Decimal("100000")
    assert out["totalInvestmentWithFees"] == Decimal("1500000") + out["totalFees"]


def test_sin_basis_no_hay_total_investment_with_fees():
    out = fees.compute_fees(_row(exit_strategy="venta"), basis=None)
    assert out["totalInvestmentWithFees"] is None
    # las líneas individuales SÍ existen — no dependen de basis, solo el total lo hace
    assert out["landFee"] == Decimal("50000")


def test_locked_oracle():
    """Números de mano, congelados — mismo patrón que test_metrics_matches_locked_oracle."""
    row = _row(
        purchase_price=Decimal("3200000"),
        construction_budgeted=Decimal("880000"),
        exit_strategy="renta",
        rent_monthly_projected=Decimal("22000"),
        land_commission_pct=Decimal("0.05"),
        construction_commission_pct=Decimal("0.15"),
        exit_rent_months=Decimal("3"),
    )
    out = fees.compute_fees(row, basis=Decimal("4500000"))
    assert out["landFee"] == Decimal("160000")       # 3,200,000 * 0.05
    assert out["constructionFee"] == Decimal("132000")  # 880,000 * 0.15
    assert out["exitFee"] == Decimal("66000")        # 22,000 * 3
    assert out["totalFees"] == Decimal("358000")
    assert out["totalInvestmentWithFees"] == Decimal("4858000")
```

**Step 2: Run to verify it fails**

Run: `cd app/api && ../../.venv/bin/python -m pytest tests/test_finance_fees.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'api.finance.fees'` (or import error), every test failing.

**Step 3: Write the implementation**

```python
# app/api/finance/fees.py
"""Comisiones del fondo sobre una propiedad — capa aparte del cost stack.

`underwriting.py` es deliberadamente la única fuente de cuánto costó la
propiedad; este módulo no le toca esa pregunta, contesta una distinta: cuánto
cuesta operar el fondo sobre ella. `basis` llega ya resuelto (Decimal, sin
redondear — mismo criterio que gain()/cap_rate(): todo lo derivado redondea
una sola vez), nunca se recalcula aquí.

exitFee es la única línea que puede faltar: sin exit_strategy no hay forma
honesta de saber si aplica el % de venta o los meses de renta, y no se
adivina — se nombra en missingInputs, igual que un exit_price ausente en
waterfall.py. landFee y constructionFee nunca faltan: siempre hay una base
(aunque sea 0) y un % (el default si nadie capturó uno).
"""
from decimal import Decimal

from .quantize import money0, to_decimal
from .underwriting import assumption


def _resolve_sale_value(row: dict) -> Decimal | None:
    """Precio de venta REAL una vez que existe, la proyección mientras tanto —
    mismo relevo que gain()/roi ya usan en underwriting.py."""
    sale_price = row.get("sale_price")
    if sale_price:
        return to_decimal(sale_price)
    projected = row.get("projected_sale")
    return to_decimal(projected) if projected else None


def _resolve_rent(row: dict) -> Decimal | None:
    """Renta COBRADA una vez que existe, la proyectada mientras tanto."""
    actual = row.get("rent_monthly_actual")
    if actual:
        return to_decimal(actual)
    projected = row.get("rent_monthly_projected")
    return to_decimal(projected) if projected else None


def compute_fees(row: dict, basis: Decimal | None) -> dict:
    land_pct = to_decimal(assumption(row, "land_commission_pct")[0])
    construction_pct = to_decimal(assumption(row, "construction_commission_pct")[0])
    sale_pct = to_decimal(assumption(row, "exit_sale_commission_pct")[0])
    rent_months = to_decimal(assumption(row, "exit_rent_months")[0])

    land_fee = to_decimal(row.get("purchase_price")) * land_pct
    construction_fee = to_decimal(row.get("construction_budgeted")) * construction_pct

    missing: list[str] = []
    exit_strategy = row.get("exit_strategy")
    exit_fee: Decimal | None
    if exit_strategy == "venta":
        sale_value = _resolve_sale_value(row)
        exit_fee = sale_value * sale_pct if sale_value is not None else None
    elif exit_strategy == "renta":
        rent = _resolve_rent(row)
        exit_fee = rent * rent_months if rent is not None else None
    else:
        exit_fee = None
        missing.append("exitStrategy")

    total_fees = None if exit_fee is None else land_fee + construction_fee + exit_fee
    total_with_fees = (
        None if (basis is None or total_fees is None) else basis + total_fees
    )

    return {
        "landFee": money0(land_fee),
        "constructionFee": money0(construction_fee),
        "exitFee": money0(exit_fee) if exit_fee is not None else None,
        "exitFeeMode": exit_strategy,
        "totalFees": money0(total_fees) if total_fees is not None else None,
        "totalInvestmentWithFees": money0(total_with_fees) if total_with_fees is not None else None,
        "missingInputs": missing,
    }
```

**Step 4: Run tests to verify they pass**

Run: `cd app/api && ../../.venv/bin/python -m pytest tests/test_finance_fees.py -v`
Expected: all PASS.

**Step 5: Mutation-test the `missingInputs` guard** (this codebase's established discipline this session — do this by hand, don't skip it)

Temporarily change `else: exit_fee = None; missing.append("exitStrategy")` to `else: exit_fee = Decimal(0)` (a silent zero instead of a named gap), rerun `test_sin_exit_strategy_no_exit_fee_y_se_nombra_el_faltante` — confirm it FAILS. Revert.

**Step 6: Commit**

```bash
git add app/api/finance/fees.py app/api/tests/test_finance_fees.py
git commit -m "feat(finance): fees.py — comisiones del fondo, mismo estilo que waterfall.py"
```

---

### Task 4: Wire `fees.py` into `properties_db.py`

**Files:**
- Modify: `app/api/properties_db.py`

**Step 1: Import and call `compute_fees` inside `metrics()`**

At `app/api/properties_db.py:1-10`, add to the imports:

```python
from api.finance import fees
```

(alongside the existing `from api.finance import underwriting`.)

At `app/api/properties_db.py:476-487`, `metrics()` currently starts:

```python
def metrics(row: dict) -> dict:
    """The record, plus whichever of the two gated groups this status opens, for
    one raw property row (snake_case keys)."""
    status = row["status"]
    basis = underwriting.basis(row)
    stack = underwriting.metrics(row)
    held = hold_months_actual(row)

    out: dict = {
        "totalInvestment": money0(basis) if basis is not None else None,
        "holdMonthsActual": held,
    }
```

Change the `out: dict = {...}` block to merge in the fees:

```python
    fee_lines = fees.compute_fees(row, basis)

    out: dict = {
        "totalInvestment": money0(basis) if basis is not None else None,
        "holdMonthsActual": held,
        "landFee": fee_lines["landFee"],
        "constructionFee": fee_lines["constructionFee"],
        "exitFee": fee_lines["exitFee"],
        "exitFeeMode": fee_lines["exitFeeMode"],
        "totalFees": fee_lines["totalFees"],
        "totalInvestmentWithFees": fee_lines["totalInvestmentWithFees"],
        "feesMissingInputs": fee_lines["missingInputs"],
    }
```

Do not touch anything below this block — `assumptions`/`out.update(...)` already picks up the four new `ASSUMPTION_DEFAULTS` keys automatically via `underwriting.assumptions(row)` (properties_db.py:498-500), so `landCommissionPct`, `constructionCommissionPct`, `exitSaleCommissionPct`, `exitRentMonths` will appear in the API payload with zero extra code here — verify this in the test below, don't add code you don't need.

**Step 2: Add the five new fields to the write surface**

At `app/api/properties_db.py:161-171` (`WRITABLE_FIELDS`), add:

```python
WRITABLE_FIELDS = frozenset({
    "name", "address", "city", "url", "latitude", "longitude",
    "assetType", "strategyType",
    "sqmLand", "sqmConstruction", "purchasePrice", "acquisitionCostPct",
    "permitsCost", "subdivisionCost",
    "projectedSale", "holdMonths",
    "rentMonthlyProjected", "rentMonthlyActual",
    "totalUnits", "acquisitionDate", "firstRentDate", "saleDate", "salePrice",
    "currentValuation", "valuationDate", "milestones",
    "notes", "isFavorite",
    "landCommissionPct", "constructionCommissionPct", "exitSaleCommissionPct",
    "exitRentMonths", "exitStrategy",
})
```

At `app/api/properties_db.py:181-189` (`CLEARABLE_FIELDS`), add the same five:

```python
CLEARABLE_FIELDS = frozenset({
    "assetType", "strategyType",
    "sqmLand", "sqmConstruction", "purchasePrice", "acquisitionCostPct",
    "permitsCost", "subdivisionCost",
    "projectedSale", "holdMonths",
    "rentMonthlyProjected", "rentMonthlyActual",
    "totalUnits", "acquisitionDate", "firstRentDate", "saleDate", "salePrice",
    "currentValuation", "valuationDate",
    "landCommissionPct", "constructionCommissionPct", "exitSaleCommissionPct",
    "exitRentMonths", "exitStrategy",
})
```

**Step 3: Add the five constraint messages**

At `app/api/properties_db.py`, in `_CONSTRAINT_MESSAGES` (starts ~line 210), add near the other "insumos del underwriting" entries:

```python
    "properties_land_commission_pct_check":
        "La comisión de compra de terreno no puede ser un porcentaje negativo.",
    "properties_construction_commission_pct_check":
        "La comisión sobre obra no puede ser un porcentaje negativo.",
    "properties_exit_sale_commission_pct_check":
        "La comisión de venta no puede ser un porcentaje negativo.",
    "properties_exit_rent_months_check":
        "Los meses de renta de la comisión de salida no pueden ser negativos.",
    "properties_exit_strategy_check":
        "Estrategia de salida inválida: se espera venta o renta.",
```

**Step 4: Run the property tests**

Run: `cd app/api && ../../.venv/bin/python -m pytest tests/test_property_metrics.py tests/test_properties.py -q`
Expected: all pass (nothing here should break existing behavior — this is additive).

**Step 5: Commit**

```bash
git add app/api/properties_db.py
git commit -m "feat(properties): comisiones de inversión en el contrato — WRITABLE/CLEARABLE, mensajes, metrics()"
```

---

### Task 5: `routes/properties.py` — Pydantic fields

**Files:**
- Modify: `app/api/routes/properties.py`

**Step 1: Add the five fields to `PropertyUpdate`**

Find the `PropertyUpdate` class (~line 53 onward, mirrors `PropertyCreate` immediately above it). Add, alongside `acquisitionCostPct: Optional[float] = None`:

```python
    landCommissionPct: Optional[float] = None
    constructionCommissionPct: Optional[float] = None
    exitSaleCommissionPct: Optional[float] = None
    exitRentMonths: Optional[float] = None
    exitStrategy: Optional[str] = None
```

**Step 2: Add the four percentage/months fields to `PropertyCreate` too**

Same five in `PropertyCreate` (~line 30 onward), matching where `acquisitionCostPct` sits there — a property can capture its expected fee structure from birth, same as `acquisitionCostPct`.

**Step 3: Run the route tests**

Run: `cd app/api && ../../.venv/bin/python -m pytest tests/test_properties.py -q`
Expected: pass. If there's a test asserting the exact set of PATCH-able/creatable fields (grep `tests/` for `WRITABLE_FIELDS` or a fixed field list), update its expected set to include the five new names — do not weaken the assertion, extend it.

**Step 4: Write a focused round-trip test**

Add to `app/api/tests/test_properties.py` (find the existing pattern for PATCHing `acquisitionCostPct` and mirror it exactly):

```python
def test_patch_sets_and_clears_a_fee_percentage(client, test_property):
    pid = test_property["id"]
    r = client.patch(f"/api/properties/{pid}", json={"landCommissionPct": 0.08})
    assert r.status_code == 200, r.text
    assert r.json()["landCommissionPct"] == 0.08
    assert r.json()["assumptions"]["landCommissionPct"]["source"] == "captured"

    r = client.post(f"/api/properties/{pid}/clear-fields", json={"fields": ["landCommissionPct"]})
    assert r.status_code == 200, r.text
    assert r.json()["landCommissionPct"] == 0.05  # el default del modelo
    assert r.json()["assumptions"]["landCommissionPct"]["source"] == "default"


def test_patch_sets_exit_strategy_and_it_unlocks_the_exit_fee(client, test_property):
    pid = test_property["id"]
    client.patch(f"/api/properties/{pid}", json={
        "purchasePrice": 1000000, "constructionCostPerSqm": None,
        "projectedSale": 2000000,
    })
    r = client.patch(f"/api/properties/{pid}", json={"exitStrategy": "venta"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["exitStrategy"] == "venta"
    assert body["exitFee"] is not None
    assert "exitStrategy" not in body["feesMissingInputs"]


def test_invalid_exit_strategy_is_rejected(client, test_property):
    pid = test_property["id"]
    r = client.patch(f"/api/properties/{pid}", json={"exitStrategy": "alquiler"})
    assert r.status_code == 422
```

(Check the exact fixture name for a clean test property — `test_property` may not be the real fixture name in this file; grep the file for the fixture used by neighboring PATCH tests and use that one instead. Check the exact `/clear-fields` request shape too — grep for an existing call to it in this file and match its body shape exactly rather than guessing.)

**Step 5: Run to verify pass**

Run: `cd app/api && ../../.venv/bin/python -m pytest tests/test_properties.py -v -k "fee or exit_strategy"`
Expected: PASS.

**Step 6: Commit**

```bash
git add app/api/routes/properties.py app/api/tests/test_properties.py
git commit -m "feat(api): PATCH/POST aceptan las comisiones de inversión"
```

---

### Task 6: Frontend types — `types.ts`

**Files:**
- Modify: `app/web/src/lib/types.ts`

**Step 1: Extend `ASSUMPTION_FIELDS`**

At `types.ts:118`:

```typescript
export const ASSUMPTION_FIELDS = [
  'acquisitionCostPct', 'holdMonths',
  'landCommissionPct', 'constructionCommissionPct', 'exitSaleCommissionPct', 'exitRentMonths',
] as const
```

**Step 2: Extend the `Property` interface**

Near `acquisitionCostPct: number` / `holdMonths: number` (~line 180-181), add the four "valor VIGENTE" fields:

```typescript
  landCommissionPct: number
  constructionCommissionPct: number
  exitSaleCommissionPct: number
  exitRentMonths: number
```

Near `projectedSale: number | null` (~line 166), add the captured (no-default) field:

```typescript
  exitStrategy: 'venta' | 'renta' | null
```

Near `totalInvestment: number | null` (~line 190), add the fee outputs:

```typescript
  // --- Comisiones del fondo (ver finance/fees.py) ---
  landFee: number | null
  constructionFee: number | null
  exitFee: number | null
  exitFeeMode: 'venta' | 'renta' | null
  totalFees: number | null
  totalInvestmentWithFees: number | null
  feesMissingInputs: string[]
```

**Step 3: Extend `RAW_PROPERTY_FIELDS` and `CLEARABLE_FIELDS`**

At `types.ts:280-289` (`RAW_PROPERTY_FIELDS`), add `'exitStrategy'` (this one — the captured field with no default, not the four assumptions, which are published through `ASSUMPTION_FIELDS`/the resolved-value keys, same as `acquisitionCostPct` is NOT in `RAW_PROPERTY_FIELDS` either — check this against how `acquisitionCostPct` is handled: it IS listed in `RAW_PROPERTY_FIELDS` at line 283 despite also being an assumption field, so mirror that exactly — add all five: `'landCommissionPct', 'constructionCommissionPct', 'exitSaleCommissionPct', 'exitRentMonths', 'exitStrategy'`).

At `types.ts:340-351` (`CLEARABLE_FIELDS`), add the same five.

**Step 4: Extend `PropertyUpdate`/`PropertyCreate` request shapes**

If `types.ts` has separate `PropertyUpdate`/`PropertyCreate` request interfaces (check near `PropertyPatch`/`PropertyCreate`, ~line 296-335) beyond the `RawPropertyFields` Pick-derived type, add the five fields there too, matching however `acquisitionCostPct` is declared in each.

**Step 5: Run the contract test**

Run: `cd app/web && PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npx vitest run src/lib/contract.test.ts`
Expected: PASS — this test cross-checks `WRITABLE_FIELDS`/`CLEARABLE_FIELDS`/`ASSUMPTION_FIELDS` between this file and `properties_db.py` textually. If it fails, the two lists have drifted — fix whichever side is wrong, don't skip the test.

**Step 6: Commit**

```bash
git add app/web/src/lib/types.ts
git commit -m "feat(web): tipos de las comisiones de inversión, contract.test.ts en verde"
```

---

### Task 7: `PropertyDetailPage.tsx` — SUPUESTOS rows, exit_strategy selector, second total

**Files:**
- Modify: `app/web/src/components/PropertyDetailPage.tsx`
- Test: `app/web/src/components/PropertyDetailPage.test.tsx`

**Step 1: Add three fee-percentage rows to SUPUESTOS**

At `PropertyDetailPage.tsx:820` (right after the `acquisitionCostPct` `EditableRow` block and before the `holdMonths` `numRow`), add three rows in the SAME shape as the `acquisitionCostPct` block at lines 805-820 — one per percentage, each with its own `assumptionHint(...)`/`isCaptured(...)`/`clearField(...)` calls (`'landCommissionPct'`, `'constructionCommissionPct'`, `'exitSaleCommissionPct'`), labels `'COMISIÓN COMPRA TERRENO (%)'`, `'COMISIÓN OBRA (%)'`, `'COMISIÓN VENTA (%)'`. Copy the `acquisitionCostPct` block's exact structure (the `value={fmtPct(...)}` / `NumericInput` with `*100`/`/100` conversion) three times, swapping the field name and label each time.

**Step 2: Add `exitRentMonths` as a plain `numRow`, and `exitStrategy` as a selector**

Right after the three percentage rows, mirror `holdMonths`' `numRow` shape for `exitRentMonths` (label `'MESES DE RENTA (COMISIÓN SALIDA)'`), with the same `assumptionHint`/`clearable` treatment as `holdMonths` at line 828-831.

For `exitStrategy`, it has NO default/provenance badge (unlike the four above) — model it after `numRow('RENTA/MES ESTIMADA', ...)` / `numRow('VENTA PROYECTADA', ...)` at lines 835-836, which are also captured-with-no-default fields, but it's a choice not a number: check whether this codebase already has a select-style editable row anywhere (grep `PropertyDetailPage.tsx` and sibling components for `assetType`/`strategyType` — those ARE string enums edited in this same page, at or near line ~35 in the SUPUESTOS/DATOS area) and copy THAT pattern (a `<select>` wrapped the same way `EditableRow`'s `input` prop is used elsewhere), not the numeric one. Label: `'ESTRATEGIA DE SALIDA'`. Options: vacío (null) / Venta / Renta.

**Step 3: Relabel the existing total and add the new one**

At `PropertyDetailPage.tsx:717-722`, change:

```tsx
              <EditableRow
                label="INVERSIÓN"
                editing={editing}
                value={fmtMXN(p.totalInvestment)}
                hint="SUMA DEL DESGLOSE"
              />
```

to:

```tsx
              <EditableRow
                label="INVERSIÓN SIN COMISIONES"
                editing={editing}
                value={fmtMXN(p.totalInvestment)}
                hint="SUMA DEL DESGLOSE"
              />
              {/* Ausente —no un guion— mientras exitStrategy no esté capturado:
                  feesMissingInputs dice por qué, y "—" leería como "cero
                  comisiones", que no es lo mismo que "no se puede calcular
                  todavía". */}
              {p.totalInvestmentWithFees != null && (
                <EditableRow
                  label="INVERSIÓN CON COMISIONES"
                  editing={editing}
                  value={fmtMXN(p.totalInvestmentWithFees)}
                  hint="SIN COMISIONES + COMISIONES DEL FONDO"
                />
              )}
```

**Step 4: Write/extend component tests**

In `PropertyDetailPage.test.tsx`, find the existing test(s) covering the `acquisitionCostPct` SUPUESTOS row and the "INVERSIÓN"/"SUMA DEL DESGLOSE" row (grep for `'SUMA DEL DESGLOSE'` or `acquisitionCostPct` in the test file) and add analogous tests:

```typescript
it('muestra INVERSIÓN CON COMISIONES cuando totalInvestmentWithFees existe', () => {
  // build the property fixture with exitStrategy: 'venta', totalInvestmentWithFees: some number
  // render, assert screen.getByText('INVERSIÓN CON COMISIONES') exists
})

it('no muestra INVERSIÓN CON COMISIONES cuando falta exitStrategy', () => {
  // fixture with exitStrategy: null, totalInvestmentWithFees: null
  // assert screen.queryByText('INVERSIÓN CON COMISIONES') is null
})
```

Match whatever test-fixture-building helper the file already uses for a `Property` object (grep for `const baseProperty` or similar) rather than hand-building one from scratch.

**Step 5: Run the frontend suite**

Run: `cd app/web && PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npx vitest run`
Expected: all pass, including the new tests.

**Step 6: Commit**

```bash
git add app/web/src/components/PropertyDetailPage.tsx app/web/src/components/PropertyDetailPage.test.tsx
git commit -m "feat(web): comisiones de inversión en SUPUESTOS y el segundo total en DESGLOSE"
```

---

### Task 8: `prospectus_html.py` — surface both figures

**Files:**
- Modify: `app/api/lib/prospectus_html.py`
- Test: `app/api/tests/test_prospectus_html.py`

**Step 1: Read each of the 6 call sites first**

`grep -n "totalInvestment" app/api/lib/prospectus_html.py` currently points at lines 724, 741, 756, 822, 864, 893 (line numbers may have drifted slightly by the time you reach this task — re-run the grep, don't trust these blindly). Read the function around each to understand its exact card-building shape before changing it.

**Step 2: Add the companion figure at each `_metric(..., "Inversión total")` call**

For the three simple ones (currently ~724, 741, 756 — one per property-status card type: sold/rented/opportunity), change:

```python
        _metric(_fmt_mxn_compact_or_dash(p.get("totalInvestment")), "Inversión total"),
```

to two metrics, only when the fee figure exists:

```python
        _metric(_fmt_mxn_compact_or_dash(p.get("totalInvestment")), "Inversión sin comisiones"),
```

and, immediately after (in whatever list/tuple this line is part of — read the surrounding function to see if it's a fixed-arity tuple you can extend or a list you can append to), add:

```python
        _metric(_fmt_mxn_compact_or_dash(p.get("totalInvestmentWithFees")), "Inversión con comisiones"),
```

Only add the second `_metric(...)` call where the surrounding structure is a list that tolerates a variable number of entries; if it's a fixed-shape tuple feeding a fixed-column layout, do NOT force a break — instead relabel just the existing one to "Inversión sin comisiones" and leave a `# TODO` noting the with-fees figure doesn't fit this card's fixed layout, and flag this explicitly in your task report for review rather than guessing at a layout change. This is a real judgment call — read the actual rendered card shape (there may be a fixed CSS grid) before deciding.

For line ~822 (`inv = sum(_num(p.get("totalInvestment")) for p in track)`), this is a track-record ACCUMULATOR summed across many properties — add a parallel `inv_with_fees = sum(_num(p.get("totalInvestmentWithFees")) for p in track)` only if `totalInvestmentWithFees` is used downstream of this line for display; if `inv` here only feeds an internal calculation (read the surrounding function to check), leave it alone and note why in your commit message.

For lines ~864/893 (the detail-card function), apply the same two-metric pattern as the first three, relabeling and adding.

**Step 3: Update/extend `test_prospectus_html.py`**

Find the existing test(s) asserting "Inversión total" appears for a sample property (grep the test file for `"Inversión total"` or `totalInvestment`). Update the label assertions to `"Inversión sin comisiones"`, and add a new assertion that `"Inversión con comisiones"` appears in the rendered HTML when the fixture property has `totalInvestmentWithFees` set, and does NOT appear when it's `None`.

**Step 4: Run the prospectus tests**

Run: `cd app/api && ../../.venv/bin/python -m pytest tests/test_prospectus_html.py -v`
Expected: all pass.

**Step 5: Commit**

```bash
git add app/api/lib/prospectus_html.py app/api/tests/test_prospectus_html.py
git commit -m "feat(prospecto): inversión sin/con comisiones en el PDF del inversionista"
```

---

### Task 9: Full-suite verification and PR

**Step 1: Run the complete backend suite**

Run: `cd app/api && ../../.venv/bin/python -m pytest -q`
Expected: all pass, 0 failures.

**Step 2: Run the complete frontend suite**

Run: `cd app/web && PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npx vitest run`
Expected: all pass, 0 failures.

**Step 3: Manual smoke test in a live browser**

Start the stack (`make app` or the worktree's equivalent — check `Makefile`), open a real `prospecto`-stage property, verify: SUPUESTOS shows the three new percentages with CAPTURADO/SUPUESTO POR OMISIÓN badges and a working clear-to-default control; setting `exitStrategy` makes "INVERSIÓN CON COMISIONES" appear; clearing it makes it disappear again; generate a prospectus PDF for a favorited property and visually confirm both investment figures print.

**Step 4: Push and open the PR**

```bash
git push -u origin feat/comisiones-inversion
gh pr create --base main --title "feat(inversión): comisiones del fondo — inversión sin/con comisiones" --body "..."
```

Reference the design doc in the PR description. Wait for CI green before reporting done.
