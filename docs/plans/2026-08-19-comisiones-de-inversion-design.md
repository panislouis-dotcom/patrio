# Comisiones de inversión — inversión sin/con comisiones — diseño

Fecha: 2026-08-19 · Rama: `feat/comisiones-inversion` · Base: `main` (06df02a)

## Qué se pidió

El fondo cobra tres comisiones propias sobre cada propiedad, hoy invisibles en
el modelo de inversión:

1. **5% comisión de compra de terreno** — sobre `purchase_price`.
2. **15% de valor de obra** — sobre `construction_budgeted`.
3. **5% de valor de venta, o si se renta, 3 meses de renta** — condicional al
   camino de salida de la propiedad.

`totalInvestment` hoy es el capital puesto — sin estas comisiones. El pedido
es poder ver AMBAS cifras: la que ya existe (renombrada "sin comisiones") y
una nueva "con comisiones" que las suma. Los tres porcentajes (y el multiplicador
de meses de renta) deben poder ajustarse por propiedad, no quedar fijos en
código — y el diseño debe dejar espacio para que aparezcan más comisiones
después, sin rehacer nada.

Diagnosticado con 4 agentes en paralelo (2 Codex, 2 Claude) contra el modelo
real de costos (`app/api/finance/underwriting.py`) y sus dos precedentes de
"algo configurable por propiedad" ya existentes en este código:
`acquisition_cost_pct` (una columna, un valor con default en Python, mostrado
con badge CAPTURADO/SUPUESTO) y `profit_split_config` (una tabla dedicada con
fila plantilla). Ver la sección de decisiones para por qué se eligió el
primero.

## La decisión central: cinco columnas más en `properties`, no una tabla nueva

Los tres porcentajes (+ el multiplicador de renta + la estrategia de salida)
son, en forma, UNA asunción más cada uno — el mismo molde que
`acquisition_cost_pct` ya resuelve: nulo hasta que alguien captura un valor,
default vivo en Python mientras tanto, badge de procedencia en la ficha. Una
tabla dedicada con fila plantilla (como `profit_split_config`) se justifica
cuando el grupo de campos es grande y heterogéneo (asignaciones de equipo,
fechas, conteos) — aquí son cinco campos planos, del mismo tipo. Agregar una
comisión nueva después es una columna más, no una tabla nueva.

```sql
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
```

Sin cota superior — mismo criterio que `acquisition_cost_pct` (solo no
negativo) y que `profit_split_config` (sin ninguna cota). `exit_strategy` es
la única de las cinco SIN default: no hay una "estrategia de salida típica"
razonable que asumir en silencio — nulo significa, honestamente, que nadie lo
ha decidido todavía.

## Los defaults viven en Python, junto a los que ya existen

```python
# app/api/finance/underwriting.py
ASSUMPTION_DEFAULTS: dict[str, Decimal | int] = {
    "acquisition_cost_pct": Decimal("0.065"),
    "hold_months": 12,
    "land_commission_pct": Decimal("0.05"),
    "construction_commission_pct": Decimal("0.15"),
    "exit_sale_commission_pct": Decimal("0.05"),
    "exit_rent_months": Decimal("3"),
}
```

`exit_strategy` NO entra en `ASSUMPTION_DEFAULTS` — no tiene default, tiene
ausencia. Se lee directo de la fila, como `sale_date` o `first_rent_date`.

## El cómputo: `app/api/finance/fees.py`, nuevo, espejo de `waterfall.py`

`underwriting.py` es deliberadamente la ÚNICA fuente de "cuánto costó la
propiedad" — no le toca la pregunta de comisiones del fondo, que es una
pregunta distinta (cuánto cuesta operar el fondo sobre esa propiedad). Mismo
motivo por el que `waterfall.py` vive aparte: toma `totalInvestment` ya
resuelto y no lo recalcula.

```python
def compute_fees(prop: dict) -> dict:
    """Comisiones del fondo sobre una propiedad — capital sin comisiones ya
    resuelto (prop['totalInvestment']), nunca recalculado aquí.

    exitFee es la única que puede faltar: sin exit_strategy no hay forma
    honesta de saber si aplica el % de venta o los meses de renta, y no se
    adivina — se nombra en missingInputs, igual que un exit_price ausente en
    waterfall.py."""
    land_pct = assumption(prop, "land_commission_pct")
    obra_pct = assumption(prop, "construction_commission_pct")
    sale_pct = assumption(prop, "exit_sale_commission_pct")
    rent_months = assumption(prop, "exit_rent_months")

    land_fee = purchase_price * land_pct
    construction_fee = construction_budgeted * obra_pct

    missing = []
    exit_strategy = prop.get("exit_strategy")
    if exit_strategy == "venta":
        exit_value, exit_value_source = _resolve_sale_value(prop)  # sale_price > projected_sale
        exit_fee = exit_value * sale_pct if exit_value else None
    elif exit_strategy == "renta":
        rent, rent_source = _resolve_rent(prop)  # rent_monthly_actual > rent_monthly_projected
        exit_fee = rent * rent_months if rent else None
    else:
        exit_fee = None
        missing.append("exitStrategy")

    total_fees = None if exit_fee is None else land_fee + construction_fee + exit_fee
    total_investment_with_fees = (
        None if (prop.get("totalInvestment") is None or total_fees is None)
        else prop["totalInvestment"] + total_fees
    )

    return {
        "landFee": money0(land_fee), "constructionFee": money0(construction_fee),
        "exitFee": money0(exit_fee) if exit_fee is not None else None,
        "exitFeeMode": exit_strategy,
        "totalFees": money0(total_fees) if total_fees is not None else None,
        "totalInvestmentWithFees": money0(total_investment_with_fees)
            if total_investment_with_fees is not None else None,
        "missingInputs": missing,
    }
```

`_resolve_sale_value`/`_resolve_rent` siguen el mismo relevo proyectado→real
que `gain()` ya usa en `underwriting.py` (`sale_price` gana en cuanto existe,
`projected_sale` mientras tanto) — un solo campo cuyo insumo cambia, no un par
`projectedFee`/`realizedFee` guardado aparte.

`properties_db.py::metrics()` llama a `fees.compute_fees(row_con_metrics_ya_puestas)`
y mezcla el resultado, mismo patrón que ya usa para el presupuesto.

**`landFee` y `constructionFee` nunca son `None`** (siempre hay una base y un
%, aunque sea 0) — solo `exitFee`/`totalFees`/`totalInvestmentWithFees` pueden
faltar, porque son los únicos que dependen de una decisión no tomada.

## API y frontend: nada nuevo, todo por el camino que ya existe

Las cinco columnas viajan por el mismo `PATCH /api/properties/{id}` que ya
mueve `acquisitionCostPct` — cero rutas nuevas. En `types.ts`:
`ASSUMPTION_FIELDS`/`RAW_PROPERTY_FIELDS` ganan las cinco claves, y el tipo de
métricas gana `totalInvestmentWithFees`, `landFee`, `constructionFee`,
`exitFee`, `exitFeeMode`, `missingInputs` (o se funde en el `missingInputs`
que ya use el resto de la ficha, si existe uno compartido — a confirmar al
tocar el código real).

**`PropertyDetailPage.tsx`**:
- "SUPUESTOS" gana cuatro filas más (los tres % + meses de renta), mismo
  `EditableRow`/`NumericInput`/`assumptionHint()` que `acquisitionCostPct` ya
  usa — captura, borra a default, mismo badge.
- `exit_strategy` es un selector (Venta / Renta / sin definir), no un número —
  vive junto a las demás pero no lleva badge de "supuesto por omisión" porque
  no tiene default.
- "DESGLOSE DE INVERSIÓN" gana un segundo total debajo del que ya existe. El
  actual se relabelea "INVERSIÓN SIN COMISIONES"; el nuevo, "INVERSIÓN CON
  COMISIONES" — visible siempre que `totalInvestmentWithFees` no sea `null`,
  ausente (no un guion) cuando `exit_strategy` no está capturado, con una
  pista corta de qué falta.

**`prospectus_html.py`**: los 5 sitios que hoy imprimen "Inversión total" (una
por tarjeta de propiedad + el acumulado del track record) muestran ambas
cifras, sin comisiones primero. `term_sheet_html.py` no se toca — ya está
totalmente desacoplado del cost stack de la propiedad.

## Pruebas

`app/api/tests/test_finance_fees.py`, mismo estilo que
`test_finance_underwriting.py`/`test_finance_waterfall.py`:

- cada base ausente por separado (`purchase_price`, `construction_budgeted`)
- `exit_strategy` sin capturar → `exitFee`/`totalInvestmentWithFees` en
  `None`, `"exitStrategy"` en `missingInputs`
- `exit_strategy = 'venta'` con `projected_sale` vs. con `sale_price` (el
  relevo proyectado→real)
- `exit_strategy = 'renta'` con `rent_monthly_projected` vs.
  `rent_monthly_actual`
- cada % ausente (usa el default) vs. capturado (lo pisa), con su
  procedencia — mismo patrón que
  `test_an_absent_assumption_is_the_model_default_and_says_so`
- un oráculo fijo: números de mano contra `compute_fees()`, igual que
  `test_metrics_matches_locked_oracle`

Migración con `CHECK` de no-negatividad probada interactivamente en psql antes
de aplicarla (inserción con valor negativo debe fallar; con `NULL` debe
pasar), mismo hábito que las migraciones de esta sesión.

## Fuera de alcance (a propósito)

- Variantes con comisiones de `projectedRoi`/`capRate`/`projectedProfit` — el
  pedido es una cifra de capital, no un universo paralelo de rendimiento.
  Si hace falta después, es un pedido propio.
- Una cuarta comisión, o cualquier otra "consideración" — el modelo queda
  listo para agregar una (una columna, una clave en `ASSUMPTION_DEFAULTS`,
  una fila en la ficha) pero no se construye nada especulativo ahora.
