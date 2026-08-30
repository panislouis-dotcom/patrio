---
name: use-refigan
description: Use when working with any part of the Refigan platform — reading data, editing state via API, writing code for new features, or opening PRs. Covers all domains, authentication, the API map, and when to call the API vs. open a PR.
---

# Refigan Platform Reference

Refigan is an internal real-estate operations platform for a Monterrey-based investment firm. It tracks one thing — a **property** — from the moment it is spotted to the moment it is sold, and generates investor documents from live data.

There is no separate "prospect" and "project". There used to be, and they turned out to be the same building described twice; they were merged into a single `properties` table whose `status` is the stage of its life. Everything below follows from that: what a property *is* does not change as it advances, only what is known about it and what may be done to it.

> **Read `docs/glosario.md` before you name a number.** Every concept in this
> platform has exactly one name, and this file uses those names. The API field
> is the identifier; the glossary entry is what you call it in front of a person.
> Two rules do most of the work: **«ROI» always means annualized**, and a figure
> and its percentage share one name. If you are about to write a label that is
> not in the glossary, you are about to invent a concept.

## Architecture in One Line

```
PostgreSQL → FastAPI (Python) → React + Vite (phone-friendly UI)
```

- **API** lives at `https://admin.refigan.com` (production). All routes are under `/api/...`.
- **OpenAPI spec** (live, authoritative): `GET https://admin.refigan.com/openapi.json`
- Every route has a stable `operation_id` — use those to find routes in the spec without guessing paths.

---

## Authentication

Every API request requires `Authorization: Bearer <token>`.

### Recommended: API key via the UI (persistent, no password exposure)

1. Log in to `https://admin.refigan.com` in a browser.
2. Click the **⚙ gear icon** in the top-right corner of the tab bar — the **API KEYS** panel is at the top of the settings dropdown.
3. Give the key a name (e.g. "claude-local"), click **+ CREAR KEY**.
4. Copy the token shown once (`rfg_live_<64 hex chars>`).
5. Add to `~/.zshrc`:
   ```bash
   export REFIGAN_API_KEY="rfg_live_..."
   ```
6. Use in any request: `Authorization: Bearer $REFIGAN_API_KEY`

The key never expires until you revoke it from the same panel.

### Two token types

| Type | Format | Lifetime | How to get |
|------|--------|----------|-----------|
| JWT | `eyJ...` (standard JWT) | 8 hours | `POST /api/auth/login` with a JSON body `{"email", "password"}` — the field is `email`, not `username`, and it is not a form |
| API key | `rfg_live_<64 hex chars>` | Until revoked | ⚙ gear icon → API KEYS panel in the UI (or `POST /api/auth/api-keys`) |

The server detects the token type by prefix: anything starting with `rfg_live_` triggers the API-key path; everything else is decoded as JWT.

**API keys are stored as SHA-256 hash only** — the plaintext is shown once at creation. Rotate with `DELETE /api/auth/api-keys/{id}` + create new from the UI.

---

## Error Format

All errors follow a single envelope. Read the message from `error.message` — there is no top-level `detail` key, even though FastAPI's own default would have one:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Propiedad no encontrada",
    "request_id": "uuid"
  }
}
```

Standard codes: `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `BAD_REQUEST`, `CONFLICT`, `VALIDATION_ERROR`, `INTERNAL_ERROR`.

The property domain writes its rejections in Spanish and for a human: *"Falta la
fecha de la primera renta."*, *"No se puede pasar de Prospecto a Desarrollo.
Desde Prospecto solo se puede pasar a Oferta o Archivada."*, *"El precio de
compra no puede ser negativo."* They arrive as `422 VALIDATION_ERROR`. Surface
the sentence; do not replace it with the status code.

A rejection never contains a constraint name, a snake_case column or a raw status
value — `properties_en_renta_needs_first_rent` and `en_renta` are identifiers, not
language. If you ever see one reach a client, a `CHECK` was added to a migration
without its sentence in `_CONSTRAINT_MESSAGES` (`app/api/properties_db.py`); a
test pins that the two lists match.

---

## Discovering Endpoints

The live OpenAPI spec is the single source of truth. Use it rather than guessing paths:

```bash
curl https://admin.refigan.com/openapi.json | jq '.paths | keys'
```

Or browse Swagger UI at `https://admin.refigan.com/docs`.

The spec groups routes by tag. Key `operation_id`s by domain are listed below as an index — fetch the spec for field-level schemas.

---

## Domain Map

### 1. Properties — one entity, one lifecycle

Every building the firm has ever looked at is a row in `properties`. `status` says where in its life it is:

```
prospecto → oferta → desarrollo → en_renta → vendida
                          └──────────────────────┘
```

| Status | What it means |
|---|---|
| `prospecto` | Spotted and modelled. Nobody has committed to anything. |
| `oferta` | The firm is bidding. Capital may be raised against it from here. |
| `desarrollo` | Bought. Works in progress (this absorbs stabilisation — there is no separate state for it). |
| `en_renta` | Producing real, stable rent. |
| `vendida` | Sold. **Terminal**, and frozen: a closed deal is a fact, not a live mark. |
| `archivada` | Dropped. **Terminal**, hidden from the default listing (`?include_archived=true` to see it). Archiving sells nothing, so it keeps the mark it had the minute before. |

A property is **born `prospecto`** — `POST /api/properties` cannot set a status, and neither can `PATCH`. Reaching any other stage means living through the one before it.

**Key raw inputs (the underwriting model):** `purchasePrice` (Precio de compra), `sqmLand`, `sqmConstruction` (Metros de obra a ejecutar), `permitsCost` (Permisos), `subdivisionCost` (Subdivisión), `projectedSale` (Venta proyectada — *not* a valuation), `rentMonthlyProjected` (Renta mensual estimada).

`purchasePrice` is what it costs to **acquire the building as it stands** — a bare lot or a finished house, no special case per asset type. The work *you will execute* on top — a remodel, an extension, a ground-up build — is priced in the property's **work budget**, line by line (below), and nothing already paid for inside the purchase price appears there, which is what stops a built house being counted twice.

`sqmConstruction` is that work's **physical footage and prices nothing.** `constructionCostPerSqm` is the captured **assumption** — what somebody thinks a metre of works costs — and it prices nothing either. The two are multiplied exactly once, by the calculator that seeds the budget's first line at `POST /api/properties`, and after that neither one moves a peso of the budget: editing them is editing two ordinary columns. Both survive because the PDF reads the footage, and because the pair is the honest comparison against `budgetedCostPerSqm` (budget ÷ footage).

**Assumptions** — `acquisitionCostPct` and `holdMonths` — are not inputs like the rest. They always have a value in force, and the payload publishes it under its own key *plus* its provenance in `assumptions`: `{"holdMonths": {"value": 12, "source": "default" | "captured"}}`. `default` means nobody chose and the model applied its own (6.5%, 12 months); `captured` means a person decided. Writing one captures it; clearing it hands it back to the model.

There used to be three. **`constructionOverhead` is no longer an assumption and no longer published**: it multiplies nothing. The ×1.3 of indirect costs is applied exactly once — when the budget's first line is seeded — and lives inside that amount from then on. Do not go looking for it in a payload, and never re-apply it to a construction figure you read: doing so inflates the cost of works by 30% with nothing looking broken.

**Key recorded facts (post-purchase):** `totalUnits`, `acquisitionDate`, `firstRentDate`, `rentMonthlyActual`, `saleDate`, `salePrice`, `currentValuation`, `valuationDate`, `milestones` (JSON).

**Classification:** `assetType` — Casa · Departamento · Local · Edificio · Lote · Bodega — and `strategyType` — `adaptive_reuse` Reconversión · `ground_up` Obra nueva · `flip` Flip · `hold` Renta. These are two different questions — what the building **is**, and what the firm intends to **do** with it — and they are two different columns, so neither ever stands in for the other. Never show a user the raw value, and never de-underscore it into fake Spanish: «Adaptive reuse» is not a word here.

#### The three ways to write

This is the part that matters most, because each door means exactly one thing:

| Operation | What it does | What it cannot do |
|---|---|---|
| `PATCH /api/properties/{id}` | Raise or change a value | Move `status`; empty anything. Null and unset keys are **dropped**, so an omitted field means "leave it alone" |
| `POST /api/properties/{id}/clear-fields` | Empty an allowlisted nullable column | Touch anything outside the allowlist |
| `POST /api/properties/{id}/transition` | Move to the next stage, carrying that stage's inputs | Skip a stage, or move without the evidence |

Emptying is its own operation precisely so that "cleared" never has to be guessed from a `0`. The two rent columns are the clearest case: `null` means *not captured*, `0` means nothing (it is rejected — a property that earns no rent has an empty rent).

#### Transition gates

`POST /api/properties/{id}/transition` takes a body **discriminated on `to`**. Each destination demands the evidence that the property genuinely lives there. The API checks the gate before the UPDATE, so a refusal is a `422` with a sentence; a DB trigger enforces the same rules underneath as a net.

> **This table is a copy, and a copy can go stale.** The authority is
> `stage_requirements()` in `app/api/checks.py` (mirrored by the transition
> trigger in migration 025 and by the request models in
> `app/api/routes/properties.py`). Before you satisfy a gate, read that function.
> This has bitten before: the table once claimed `desarrollo` required
> `currentValuation` after the code had stopped requiring it, and an agent
> following the table would have **invented an appraisal** to get past a gate
> that no longer existed. **A missing input is never a reason to fabricate one.**
> If a gate seems to demand a number nobody measured, the gate is wrong — go
> read it.

<!-- BEGIN GENERATED: transition-gates · scripts/gen_transition_gates.py -->

| `to` | Required in the body | Accepted, not required |
|---|---|---|
| `oferta` | `projectedSale`† | — |
| `desarrollo` | `acquisitionDate`, `totalUnits`, `purchasePrice`† | `currentValuation`, `valuationDate` |
| `en_renta` | `firstRentDate`, `rentMonthlyActual` | `currentValuation`, `valuationDate` |
| `vendida` | `saleDate`, `salePrice` | — |
| `archivada` | — | — |

† Demanded by the stage, optional in the body: the property may already carry it, and the gate reads the row *after* the body is merged in.

<!-- END GENERATED: transition-gates -->

**Why each one.** `oferta`: every offer models its exit, even when the plan is to
rent. `desarrollo`: a property in development has been bought, and what it cost
has to be on the record — `purchasePrice` is the one component without which
there is no capital base, and with no capital base there is no ROI, no gain and
no cap rate. `en_renta`: the rent asked for is the one being **collected**, and
it never overwrites the estimated one. `vendida`: the exit is frozen at its
actual figures. `archivada`: a terminal drawer, reachable from any non-terminal
stage.

`currentValuation` and `valuationDate` sit in the *accepted* column and in no
other. Buying a building does not produce an appraisal, and demanding one only
ever got one invented. Capture the valuation when a real one exists; until then
`unrealizedGain` is `null`, which is the honest answer.

Nothing else is a gate. `desarrollo` does **not** require the two assumptions
(`acquisitionCostPct`, `holdMonths`): they always resolve, so a gate on them
could never fail — it would only make every freshly captured property claim a
complete underwriting it never had. Nor is the work budget a gate: it exists
from birth, so there is never a stage at which it is missing.

All bodies also accept `effectiveOn` (defaults to today) and `notes`. Every move is recorded in `property_status_events` with its author, so the pipeline has a history: days-in-offer, conversion rate, time-to-first-rent.

Legal moves — anything else is a `422` naming both stages in words and listing the
ones that *are* reachable:
`prospecto→oferta` · `oferta→desarrollo` · `desarrollo→{en_renta,vendida}` · `en_renta→vendida` · any non-terminal `→archivada`.

#### Metrics: the record, and the two groups that assert ownership

Financial metrics are **auto-computed from raw inputs** — never write a computed
field. Only **one kind** of figure is gated by status, and it is not the model:
a figure that *asserts you own the thing*. Everything else is computed wherever
its inputs exist and comes back `null` when they do not — the same answer,
reached from the data instead of from a table of statuses.

**The record — never gated.** The cost stack, what the underwriting promised on
it, and the yield of each of the two rents.

| Field | Name it by |
|---|---|
| `acquisitionCosts` · `acquisitionTotal` | Costos de adquisición · Total de adquisición |
| `constructionBudgeted` | **Obra presupuestada** — the sum of the work budget, and the only cost of works there is |
| `constructionCommitted` · `constructionPaid` | **Obra comprometida** · **Obra pagada** — signed for, and out of the bank |
| `constructionCommittedVariance` · `constructionPaidVariance` | **Comprometido vs presupuesto** · **Pagado vs presupuesto** — execution minus plan, so positive means overrun |
| `constructionCostPerSqm` | **Tu estimado de $/m²** — the captured assumption, a writable column; prices nothing |
| `budgetedCostPerSqm` | **Costo por m² presupuestado** — derived (budget ÷ footage), read-only |
| `purchasePricePerSqm` · `investmentPerSqm` · `salePerSqm` | per-m² figures |
| `projectedProfit` · `projectedRoiTotal` | **Ganancia proyectada** · **Ganancia proyectada %** |
| `projectedRoi` | **ROI proy. anual** — annualized over `holdMonths` |
| `capRate` · `rentAnnual` | Cap rate proy. sobre inversión · Renta anual estimada |
| `capRateActual` · `rentAnnualActual` | Cap rate real sobre inversión · Renta anual cobrada |

A plan does not expire when the deal closes; it becomes the thing the result is
graded against. Switching it off at the sale broke the plan-vs-result pair at the
exact moment it became checkable, so it is no longer switched off.

**The mark — `desarrollo`, `en_renta`, `archivada`.** `unrealizedGain` /
`unrealizedGainPct` (**Ganancia no realizada** / **Ganancia no realizada %**) and `roi` (**ROI anual**): the
valuation against the money in. Gated because marking capital you have not put in
is a wish, not a measurement. `archivada` keeps it: archiving sells nothing, so
an archived property is still owned and its last mark is still its last mark.

**The exit — `vendida` only.** `realizedGain` / `realizedGainPct` (**Ganancia
realizada** / **Ganancia realizada %**) and `realizedRoi` (**ROI real anual**), off `salePrice` with its
own clock stopped at `saleDate`. A sale price on a property that has not sold is
not a realized anything.

Three clocks, and they are different on purpose. Each annualized return closes on
the date of its own numerator: the exit runs `acquisitionDate` → `saleDate`, the
mark runs `acquisitionDate` → `valuationDate`. An annualized figure whose
numerator is months older than its denominator falls every month without a single
input changing — it reports the calendar, not the asset.

The third is `holdMonthsActual` (**Plazo real**), and it is not a divisor at all:
it runs `acquisitionDate` → the **first rent**, freezing at the moment the
property became productive (→ `saleDate` for a flip that never rented, → today
only while still in development). Never annualize anything over it. A property
that rented and later sold has a Plazo real shorter than the stretch its ROI real
anual divides by, on purpose — the two are answering different questions and are
not meant to reconcile against each other.

`capRate`/`rentAnnual` answer for the **estimated** rent and
`capRateActual`/`rentAnnualActual` for the **collected** one: same formula, two
facts, never one standing in for the other. Both cap rates are **yield on cost** —
gross annual rent over total investment — so their label always carries its
denominator ("sobre inversión", abbreviated "s/ inversión" only where space
forces it); «cap rate» unqualified means NOI over market value and would be a
different, larger number. Qualify the word, never replace it.

`totalInvestment` (**Inversión total**) is the capital base, and it is **never
written** — no field carries it, in any request body. It is always the same sum,
with no branches:

```
totalInvestment = purchasePrice × (1 + acquisitionCostPct)
                + permitsCost + subdivisionCost
                + constructionBudgeted
```

A component nobody captured counts as 0, so there is no "complete" versus
"incomplete" breakdown. A sum of zero comes back `null` — nothing captured, not a
capital base of zero. There is no second way to reach the figure and no field
saying which way was taken: `totalInvestmentCaptured` and `investmentBasis` both
existed and are gone, because two ways to compute one number is two numbers.

The last term was `sqmConstruction × constructionCostPerSqm × constructionOverhead`
until the work budget arrived, and the same rule is why it changed rather than
gaining a branch. **There is no "use the budget if it exists, else the formula"** —
that disjunction is two numbers wearing one name. Every property has a budget
from birth (it is created in the same transaction as the row, and the migration
that introduced it seeded one for every property that already existed, to the
peso), so the sum is defined in every stage and the question never arises. A
budget with no lines sums to **0**, and 0 is a number, not a missing value:
nothing downstream branches on it.

**A lump sum is written as `purchasePrice`.** When all that is known about an
older property is "it cost $9.5M all in", capture `purchasePrice: 9500000` with
`acquisitionCostPct: 0` — explicitly zero, because leaving it unset means "assume
6.5%" and would quietly add $617,500 nobody spent. That is the whole idiom. Do
not go looking for a total field and never try to PATCH `totalInvestment`; it is
a computed field like `roi`.

**Score:** 0–100 composite (50% `projectedRoi`, 30% `capRate`, 20% `projectedProfit`) as a **percentile rank against the other pre-purchase properties**. It exists only in `prospecto` and `oferta` and is `null` afterwards — a score ranks candidates competing for capital, and a bought property competes with nobody. It is **server-authoritative**: read it, never recompute it.

**Issues:** every property carries an `issues` list — the stage's hard requirements it fails (`severity: "error"`) plus that stage's soft warnings. A prospect is judged on how complete its underwriting is, a building in development on its capital and dates, a rented one on how stale its valuation is.

Key `operation_id`s:
- `properties_list` — `GET /api/properties` — filters: `status`, `city`, `is_favorite`, `min_roi`, `max_roi`, `include_archived`
- `properties_create` — `POST /api/properties` (born `prospecto`; unset fields fall back to server-side capture defaults)
- `properties_get` — `GET /api/properties/{id}`
- `properties_update` — `PATCH /api/properties/{id}`
- `properties_delete` — `DELETE /api/properties/{id}`
- `properties_transition` — `POST /api/properties/{id}/transition`
- `properties_clear_fields` — `POST /api/properties/{id}/clear-fields` — body `{"fields": ["rentMonthlyProjected", ...]}`
- `properties_parse` — `POST /api/properties/parse` — AI capture from a URL, pasted text or a screenshot (multipart)
- `properties_quality` — `GET /api/quality` — every property with what is wrong with it *at its own stage*
- `property_images_upload` — `POST /api/properties/{id}/images` (form field `image_type`: `antes`/`despues`)
- `property_images_delete` — `DELETE /api/properties/{id}/images/{image_id}`
- `property_images_update_type` — `PATCH /api/properties/{id}/images/{image_id}`
- `properties_get_geometry` / `properties_set_geometry` — `GET`/`PUT /api/properties/{id}/geometry`
- `properties_upload_floorplan_image` — `POST /api/properties/{id}/floorplan-image`

Properties carry an `isFavorite` flag; the prospectus is built from **favorited** ones.

> **Note on old URLs.** `/api/prospects` and `/api/projects` are gone and are **not** redirected: the merge gave every property a fresh id, so a preserved path would answer about a different building. They return 404. Ids from before the merge are meaningless; look properties up by name.

#### The work budget — where "what will the works cost" lives

`constructionBudgeted` is not a column. It is `SUM(quantity × unitPrice)` over the property's budget lines, derived on every read, and it is the **only** answer to what the works cost — in every stage, `prospecto` included.

**No stage gate.** The budget travels with the property like the rest of the cost breakdown, not like a tool that opens later: investors open at `oferta`, the waterfall and tareas at `desarrollo`, but you must be able to budget a building before bidding on it. It is nested under `/api/properties/{id}/budget` because that is what it is — a budget does not exist without its property and is shared with no other.

Two levels: **capítulo → partida**. A chapter is a name its lines carry (`chapterName`), not a row, so it exists exactly as long as some line names it — which is why nothing creates an empty one.

**No total is ever stored, and there is no operation that sets one.** Budgeted, committed and paid are derived every time somebody asks, exactly like `totalInvestment`. **The total of a budget is the sum of its lines** — always, with no mode, no fallback and no "base" field. To move it, move lines.

**Every line is an ordinary line.** A property born with the calculator gets exactly one, named with the arithmetic that produced it — «Estimado inicial · 200 m² × $9,000/m² × 1.3» — carrying the rough estimate from `sqmConstruction`, `constructionCostPerSqm` and the overhead. From that instant it is editable, renameable and deletable like any other, and **nothing ever rewrites it**: the calculator runs once, at birth, and there is no write path from the property's metrics into the budget afterwards — not automatic, not behind a button. Editing the m² or the $/m² of a property moves no money.

So adding a $300k line **raises** the cost of works by $300k and deleting one lowers it by the same. There used to be an `isResidual` line that absorbed the difference, which meant a quote landing $45k over its allowance moved nothing and the overrun vanished — that absorption is gone, and the movement is the point. `budgetIncrease` still ships in every write response but is now **always 0**; it reported an overflow condition that can no longer occur, and it is being retired. Ignore it.

**Every write returns `{line, budget, property, budgetIncrease}`.** The `property` comes back recomputed, because moving a line moves the cost of works and with it `totalInvestment`, `projectedProfit`, `projectedRoi` and `capRate`. Take it whole; do not re-fetch the property and do not re-sum the lines client-side.

Per line: `budgetedAmount` (`quantity × unitPrice`), `committedAmount` (what was signed with a supplier) and `paidAmount` (the sum of its payments), plus `committedVariance` and `paidVariance` against the budgeted figure. **A payment never touches the budgeted amount** — paying does not change what the works were planned to cost, and the gap between the two is the information. Payments are append-only: a mis-keyed one is deleted, never rewritten.

In a line `PATCH`, **a `null` travels and means "clear it"** — the opposite of the property ficha, where emptying is its own operation. The route uses `exclude_unset`, not `exclude_none`, because the supplier selector has a "— Sin proveedor" option and choosing it must remove the supplier. On `POST` a null is dropped instead: an absent column and a null column produce the same new row, so there is nothing to distinguish.

Deleting a property that holds captured work is a `422` with its reason in words, not a silent cascade.

Key `operation_id`s:
- `budget_get` — `GET /api/properties/{id}/budget` → `{id, propertyId, lines, chapters}`, ordered by chapter
- `budget_line_create` — `POST /api/properties/{id}/budget/lines` — `chapterName` and `name` required; the rest is filled cell by cell
- `budget_line_update` — `PATCH /api/properties/{id}/budget/lines/{line_id}`
- `budget_line_delete` — `DELETE /api/properties/{id}/budget/lines/{line_id}`
- `budget_chapter_rename` — `PATCH /api/properties/{id}/budget/chapters/{chapter}`
- `budget_chapter_delete` — `DELETE /api/properties/{id}/budget/chapters/{chapter}`
- `budget_payment_create` — `POST /api/properties/{id}/budget/lines/{line_id}/payments`
- `budget_payment_delete` — `DELETE /api/properties/{id}/budget/lines/{line_id}/payments/{payment_id}`
- `budget_apply` — `POST /api/properties/{id}/budget/apply` — body `{budgetId, chapters?, proportional?}`; copies the budget of another job over this one. `chapters` absent or `null` copies the whole thing; a list copies only those chapters, named exactly as `budget_get` publishes them. Answers `{…, linesAdded, linesSkipped}`.

**`proportional: true` copies the shape and not the size.** The copied lines are scaled so their sum lands exactly on the cost of works **this** job already has — the sum of its own budget — instead of arriving with the other job's amounts. Lines marked `isProportional: false` (permits, licences: they cost what they cost) come over untouched and are excluded from both ends of the ratio; everything else, the source's estimate line included, is scaled by one server-computed factor, so the destination inherits how much is left to detail too. **The target is read, never sent**: there is no `costPerSqm` and no factor in the body, and a job whose budget is still $0 is refused, pointing at its budget. Note that **both modes ADD**: the copied lines land on top of what was already there, so a job copied proportionally onto its own estimate ends at twice its cost of works until that estimate line is deleted — which is the normal next step, since the breakdown is what replaces it.

**Applying never overwrites a line this job already has.** A source line whose `(chapter, name)` — lowercased and trimmed — already exists here is **skipped**, never updated: the one here may carry a supplier, a committed amount, payments or a close, and overwriting its price or quantity would rewrite money already captured. So applying the same source twice adds nothing the second time, and `linesSkipped` says how much was left alone. Copying to several jobs is this same route called once per destination — there is no broadcast route, because each budget is independent and the correct atomicity is per property.

**Copying from another job is the only start that is not manual capture.** There are no budget templates: every budget belongs to a job, and the database now requires it. A curated template only beats "copy the job next door" while somebody keeps it curated, and the most recent similar job is more up to date than any template without anyone doing anything.

Key `operation_id`s:
- `budget_sources_list` — `GET /api/budget/sources?excludePropertyId=…` — the jobs `budget_apply` can copy from, each with its property's name and how many lines it would actually bring (every line travels, the estimate included); jobs with no lines at all are left out, and `excludePropertyId` drops the asking job's own budget

### 2. Sonar — real-time market scraper

Scrapes six real-estate portals: Lamudi, Inmuebles24, Mercadolibre, Vivanuncios, Doorvel, Icasas. Results are geocoded via Nominatim. Runs as an SSE stream.

Key `operation_id`s:
- `sonar_run` — `POST /api/sonar/run` → SSE stream; each line is a JSON signal or `{"done": true}`
- `sonar_signals` — `GET /api/sonar/signals`
- `sonar_import` — `POST /api/sonar/import` → promote a signal to a **property** (which is born `prospecto`, like any other capture)
- `sonar_to_comparables` — `POST /api/sonar/to-comparables` → promote signals to comparables
- `sonar_zones` — `GET /api/sonar/zones`
- `sonar_zone_medians` — `GET /api/sonar/zone-medians`
- `sonar_re_geocode` — `POST /api/sonar/re-geocode` → re-run Nominatim on signals

### 3. Comparables — market comp database

Curated price comps used to read what a zone is selling at. Fields: `address`, `zoneId`, `m2`, `price`, `listingUrl`, `sourcePortal`, `listedAt`, `neighborhood`, `city`, `lat`, `lng`, `bedrooms`, `bathrooms`, `parkingSpots`, `propertyType`, `condition`, `styleTags`.

Key `operation_id`s:
- `zones_list` — `GET /api/zones`
- `comparables_list` — `GET /api/comparables`
- `comparables_create` — `POST /api/comparables`
- `comparables_get`, `comparables_update`, `comparables_delete`

### 4. Processes / Templates / Tareas — workflow engine

**Two-layer system:**

| Layer | API term | UI term | Purpose |
|-------|----------|---------|---------|
| Template | `template` | Proceso | Reusable blueprint — defines the tree of nodes once |
| Instance | `instance` | Tarea | Live run of a template, attached to an optional property and a start date |

A **tarea** in the UI is always a process instance. Attaching one to a property is done via `propertyId` in the create body or a subsequent `PATCH`. A property can have many tareas; a tarea belongs to at most one property.

**Window: `desarrollo`, `en_renta`, `vendida`.** Works are tracked on a building the firm owns; attaching a tarea to a pre-purchase property is rejected.

**Typical workflow:**
1. Define or reuse a template (`GET /api/process/templates`)
2. Create an instance from it: `POST /api/process/instances` with `{name, startDate, templateId, propertyId}`  
   — this clones the template's node tree and computes a Gantt schedule from node `durationDays` and `dependsOnId` chains
3. Track progress per node: `PATCH /api/process/instances/{iid}/nodes/{nid}/state`
4. List all tareas for a property: `GET /api/process/instances?property_id={pid}`

**Instance fields (`InstanceCreate`):** `name`*, `startDate`* (ISO date), `templateId` (clones nodes from template), `propertyId` (links to a property), `ownerId`, `dueDate`, `notes`, `status`, `frequencyDays` (recurring), `originInstanceId`.

**Node structure:** Nodes nest via `parentId`, sequence via `dependsOnId`, and embed sub-templates via `sourceTemplateId`. Each node has `durationDays` which feeds the Gantt computation.

**Node state (`PATCH /api/process/instances/{iid}/nodes/{nid}/state`):** `status`, `assigneeId`, `actualStart`, `actualEnd`, `notes`, `durationOverrideDays`, `supplierId`. Nodes can also have attached files and comments.

**Cotizaciones on nodes:** After updating a node's state you get a `state_id`; attach quotes to it via `POST /api/instance-node-states/{state_id}/cotizaciones` (fields: `proveedorId`, `monto`, `moneda`, `descripcion`, `fechaCotizacion`, `validezDias`).

Key `operation_id`s:
- `process_templates_list`, `process_templates_create`, `process_templates_update`, `process_templates_delete`
- `process_template_nodes_list`, `process_template_nodes_create` — `POST /api/process/templates/{tid}/nodes`
- `process_nodes_update` — `PATCH /api/process/nodes/{nid}`
- `process_nodes_delete` — `DELETE /api/process/nodes/{nid}`
- `process_template_preview` — `GET /api/process/templates/{tid}/preview`
- `process_instances_list` — `GET /api/process/instances?property_id={pid}`
- `process_instances_create` — `POST /api/process/instances`
- `process_instances_get` — `GET /api/process/instances/{iid}`
- `process_instances_update` — `PATCH /api/process/instances/{iid}`
- `process_instance_node_state_update` — `PATCH /api/process/instances/{iid}/nodes/{nid}/state`
- `process_instance_node_get` — `GET /api/process/instances/{iid}/nodes/{nid}`
- `process_node_files_*`, `process_node_comments_*`, `process_instance_files_*`
- `cotizaciones_list`, `cotizaciones_create` — on `instance-node-states/{state_id}/cotizaciones`

### 5. Proveedores — vendor / supplier directory

Three-level: **categories** → **proveedores** (vendors) → **cotizaciones** (quotes).

Proveedor fields: `name`, `phone`, `email`, `zona`, `status` (`activo`/`vetado`), `calidad`/`puntualidad`/`precio` ratings (1–5), `vetoReason`. Has photos.

Cotización fields: `monto`, `moneda`, `descripcion`, `validezDias`, `fechaCotizacion`, linked to a proveedor and optionally to a node of a tarea.

Key `operation_id`s:
- `proveedor_categories_list`, `proveedor_categories_create`, `proveedor_categories_update`, `proveedor_categories_delete`
- `proveedor_categories_set` — `PUT /api/proveedores/{id}/categories`
- `proveedores_list`, `proveedores_create`, `proveedores_get`, `proveedores_update`, `proveedores_delete`
- `proveedor_assignments_list` — `GET /api/proveedores/{id}/assignments`
- `proveedor_photos_upload`, `proveedor_photos_delete`
- Cotizaciones live on the node state, not on the proveedor: `cotizaciones_list` / `cotizaciones_create` on `/api/instance-node-states/{state_id}/cotizaciones`, then `cotizaciones_update`, `cotizaciones_delete` and `cotizacion_select` on `/api/cotizaciones/{id}`

### 6. Investors — investor CRM

Global investor registry (`/api/investors`) + per-property investment tracking (`/api/properties/{id}/investors`).

Investor fields: `name`, `apellidos`, `email`, `phone`, `temperatura` (warm/cold), `capacidad` (investment capacity), `fuente` (source), `confianza` (trust level), `notes`.

Per-property investment: `status` (`interesado`/`comprometido`/`fondeado`/`retornado`), `interestedAmount`, `committedAmount`, `fundedAmount`, `interestRateAnnual`, `investmentDate`, `returnAmount`, `returnDate`.

**Window: `oferta`, `desarrollo`, `en_renta`, `vendida`** (`INVESTOR_STATUSES`). Capital is raised against a deal the firm is actually bidding on, never against something still being evaluated. Adding an investor to a `prospecto` — or to an `archivada` — is a `422`.

Key `operation_id`s:
- `investors_list`, `investors_create`, `investors_get`, `investors_update`, `investors_delete`
- `property_investors_list` — `GET /api/properties/{id}/investors`
- `property_investors_add` — `POST /api/properties/{id}/investors`
- `property_investment_update` — `PUT /api/properties/{id}/investors/{investment_id}`
- `property_investment_delete` — `DELETE /api/properties/{id}/investors/{investment_id}`

### 7. Profit — waterfall calculator

Computes exit profit distribution for a property across: investor return, finder fee, director cut, team roles (responsable, líder, maestros, ayudantes), and ISR.

Two layers: a **template** with firm-wide defaults, and a per-property **config** that overrides them.

**Window: `desarrollo`, `en_renta`, `vendida`** (`PROFIT_STATUSES`). There is nothing to split until the money is committed.

Key `operation_id`s:
- `profit_template_get`, `profit_template_update` — `GET/PUT /api/profit/template`
- `property_profit_get`, `property_profit_update` — `GET/PUT /api/properties/{id}/profit`

Both GET endpoints return `{"config": {...}, "waterfall": {...}}` — the waterfall is always recomputed live.

### 8. Documents — PDF generation

HTML → Playwright/Chromium → PDF. Returns `application/pdf` with a `Content-Disposition: attachment` header.

Key `operation_id`s:
- `documents_prospectus` — `POST /api/documents/prospectus`
  - No body required. Builds the investor pitch from **favorited** properties, partitioned by stage: track record from `vendida` (realised figures) then `en_renta` (current mark), En Desarrollo from `desarrollo`, and the opportunity pages from `oferta` first and `prospecto` last.
  - `400` when nothing is favorited.
- `documents_term_sheet` — `POST /api/documents/term-sheet`
  - Body: `{"investor_name": "...", "investment_amount": 500000, "property_id": null, "rate": 0.12}`
  - If `property_id` is null, picks the highest projected-ROI property in **`oferta`** — a term sheet is raised against a deal the firm has committed to, not one it is still evaluating.
  - `400` when the property has no `holdMonths`: the term is the spine of the document and the three return scenarios are computed on it, so it is never invented.

### 9. Team

Internal team members. Used in process node assignment and profit waterfall.

Key `operation_id`s:
- `team_list` — `GET /api/team`
- `team_create`, `team_update`, `team_delete`

### 10. Users & API Keys

User management (admin-only for cross-user operations). API key lifecycle.

Key `operation_id`s:
- `users_list`, `users_create`, `users_update`, `users_delete`
- `api_keys_list` — `GET /api/auth/api-keys`
- `api_keys_create` — `POST /api/auth/api-keys` → returns `{"token": "rfg_live_..."}` (shown once)
- `api_keys_revoke` — `DELETE /api/auth/api-keys/{id}`

### 11. Auth

- `auth_login` — `POST /api/auth/login` — JSON body `{"email", "password"}`
- `auth_me` — `GET /api/auth/me` (returns `{"email": "..."}` for current token)

---

## When to Use the API vs. Open a PR

This is the most important judgment call you will make.

### Use the API when:

- You are reading or mutating **existing data** — capture a property, correct a field, advance a stage, import sonar signals, update node state, add an investor.
- The desired outcome is achievable with **existing endpoints** — if the operation_id exists in the spec, use the API.
- You are running an autonomous agent loop that interacts with real operational data.

### Open a PR when:

- The required capability **does not yet exist** in the codebase. A new endpoint, a new computed field, a new UI screen, a new document type — these require code changes.
- The change affects **schema** (new table, new column) — write a dbmate migration, add it to `db/migrations/`.
- The change affects **behavior** that is currently wrong — bug fix goes in code, not in data.
- You need to change **business logic** (e.g., how score is computed, how the waterfall divides profit) — open a PR and explain the rationale.

**Principle:** If you can achieve the goal without touching source code, do it via the API. If you need to teach the system new tricks, open a PR.

---

## PR / Git Workflow

- **Never commit to `main` directly.** Always branch → PR → merge to `qa`.
- `qa` branch auto-deploys to QA. After QA is verified, the Deploy workflow fast-forwards `main` and triggers production deployment.
- PR titles should be concise (<70 chars). Use conventional commit prefixes: `feat:`, `fix:`, `test:`, `chore:`, `refactor:`.
- Before opening a PR, have **local evidence** the change works — run tests, check the affected behavior. "It should work" is not evidence.

---

## Key Design Principles

1. **Computed fields are not stored raw.** Metrics like ROI, cap rate and profit are derived in the domain layer from raw inputs. Never patch a computed field directly.
2. **One way to do things.** If an operation already has an endpoint, use it. Don't duplicate logic in a new endpoint.
3. **Score before filter.** The score is a percentile against the whole pre-purchase cohort, computed on the server. Read it; filter afterwards. Recomputing it client-side over a filtered subset distorts the ranking — that duplicate used to exist and was deleted.
4. **12-factor config.** All secrets and environment-specific values come from env vars, never from source code.
5. **Data integrity first.** A clean, correct DB record is worth more than a fast feature. Validate at boundaries; trust internal code.
6. **A stage is not a field.** `status` moves only through `POST /transition`, which demands that stage's evidence and records who moved it and when. Nothing else may write it — not `PATCH`, not a script.
7. **Empty is not zero.** A missing value is `null` and is set only through `clear-fields`. `0` means the number zero. Conflating them is how data disappears silently.
