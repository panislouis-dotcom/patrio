---
name: use-refigan
description: Use when working with any part of the Refigan platform — reading data, editing state via API, writing code for new features, or opening PRs. Covers all domains, authentication, the API map, and when to call the API vs. open a PR.
---

# Refigan Platform Reference

Refigan is an internal real-estate operations platform for a Monterrey-based investment firm. It tracks the full deal lifecycle — from sourcing raw prospects to exiting completed projects — and generates investor documents from live data.

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
| JWT | `eyJ...` (standard JWT) | 8 hours | `POST /api/auth/login` with `{username, password}` (form body) |
| API key | `rfg_live_<64 hex chars>` | Until revoked | ⚙ gear icon → API KEYS panel in the UI (or `POST /api/auth/api-keys`) |

The server detects the token type by prefix: anything starting with `rfg_live_` triggers the API-key path; everything else is decoded as JWT.

**API keys are stored as SHA-256 hash only** — the plaintext is shown once at creation. Rotate with `DELETE /api/auth/api-keys/{id}` + create new from the UI.

---

## Error Format

All errors follow a single envelope:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Prospect not found",
    "request_id": "uuid"
  }
}
```

Standard codes: `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `BAD_REQUEST`, `CONFLICT`, `VALIDATION_ERROR`, `INTERNAL_ERROR`.

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

### 1. Prospects — deal pipeline before commitment

Raw opportunities under evaluation. Financial metrics (ROI, cap rate, IRR, profit) are **auto-computed from raw inputs** in the DB layer — never write computed fields directly.

**Key raw inputs:** `landPrice`, `sqmLand`, `sqmConstruction`, `constructionCostPerSqm`, `constructionOverhead`, `acquisitionCostPct`, `permitsCost`, `projectedSale`, `rentMonthly`, `holdMonths`.

**Statuses:** `scouting` → `evaluating` → `discarded` / promoted to a Project.

**Score:** `_score(p, all_prospects)` produces a 0–100 composite (50% ROI, 30% cap rate, 20% profit) using **percentile rank against the full unfiltered dataset** — this is intentional; filter after scoring.

Key `operation_id`s:
- `prospects_list` — `GET /api/prospects`
- `prospects_create` — `POST /api/prospects`
- `prospects_get` — `GET /api/prospects/{id}`
- `prospects_update` — `PATCH /api/prospects/{id}`
- `prospects_delete` — `DELETE /api/prospects/{id}`
- `prospect_images_upload` — `POST /api/prospects/{id}/images`
- `prospect_images_delete` — `DELETE /api/prospects/{id}/images/{image_id}`

Prospects carry an `isFavorite` flag. The prospectus document is built from **favorited** prospects.

### 2. Projects — committed deals (full lifecycle)

A project is a prospect that has been committed to. Core fields: `name`, `type`, `address`, `city`, `status`, `totalUnits`, `acquisitionDate`, `conclusionDate`, `totalInvestment`, `currentValuation`, `valuationDate`, `milestones` (JSON).

Key `operation_id`s:
- `projects_list`, `projects_get`, `projects_create`, `projects_update`, `projects_delete`
- `project_images_upload` — `POST /api/projects/{id}/images`
- `project_images_delete`, `project_images_update_type`

### 3. Analyses — financial model snapshots

Run a financial analysis against a prospect to generate a snapshot stored in `analysis_snapshots`. Supports three exit strategies:

- **Flip (build + sell):** revenue = projected sale price minus all costs.
- **Build & Hold (rent):** revenue = monthly rent × months.
- **Blended:** weighted average of calculated and manual ARV.

Key request fields: `prospectId`, `interventionLevel` (`"baja"/"media"/"alta"`), `holdingPeriodMonths`, `exitPriceSource` (`"calculated"/"manual"/"blended"`), `arvManualOverride`.

Key `operation_id`s:
- `analyses_create` — `POST /api/analyses` (runs analysis, saves snapshot, returns it)
- `analyses_list` — `GET /api/analyses?prospect_id=<id>`
- `analyses_get` — `GET /api/analyses/{snapshot_id}`

Snapshots include `comparableIds` (list) and `dataQualityWarnings` (list).

### 4. Sonar — real-time market scraper

Scrapes six real-estate portals: Lamudi, Inmuebles24, Mercadolibre, Vivanuncios, Doorvel, Icasas. Results are geocoded via Nominatim. Runs as an SSE stream.

Key `operation_id`s:
- `sonar_run` — `POST /api/sonar/run` → SSE stream; each line is a JSON signal or `{"done": true}`
- `sonar_signals_list` — `GET /api/sonar/signals`
- `sonar_import` — `POST /api/sonar/import` → promote signal to prospect
- `sonar_to_comparables` — `POST /api/sonar/to-comparables` → promote signals to comparables
- `sonar_zones_list` — `GET /api/sonar/zones`
- `sonar_zone_medians` — `GET /api/sonar/zone-medians`
- `sonar_re_geocode` — `POST /api/sonar/re-geocode` → re-run Nominatim on signals

### 5. Comparables — market comp database

Curated price comps used in financial analyses. Fields: `address`, `zoneId`, `m2`, `price`, `listingUrl`, `sourcePortal`, `listedAt`, `neighborhood`, `city`, `lat`, `lng`, `bedrooms`, `bathrooms`, `parkingSpots`, `propertyType`, `condition`, `styleTags`.

Key `operation_id`s:
- `zones_list` — `GET /api/zones`
- `comparables_list` — `GET /api/comparables`
- `comparables_create` — `POST /api/comparables`
- `comparables_get`, `comparables_update`, `comparables_delete`

### 6. Processes / Templates / Tareas — workflow engine

**Two-layer system:**

| Layer | API term | UI term | Purpose |
|-------|----------|---------|---------|
| Template | `template` | Proceso | Reusable blueprint — defines the tree of nodes once |
| Instance | `instance` | Tarea | Live run of a template, attached to an optional project and a start date |

A **tarea** in the UI is always a process instance. Attaching one to a project is done via `projectId` in the create body or a subsequent `PATCH`. A project can have many tareas; a tarea belongs to at most one project.

**Typical workflow:**
1. Define or reuse a template (`GET /api/process/templates`)
2. Create an instance from it: `POST /api/process/instances` with `{name, startDate, templateId, projectId}`  
   — this clones the template's node tree and computes a Gantt schedule from node `durationDays` and `dependsOnId` chains
3. Track progress per node: `PATCH /api/process/instances/{iid}/nodes/{nid}/state`
4. List all tareas for a project: `GET /api/process/instances?project_id={pid}`

**Instance fields (`InstanceCreate`):** `name`*, `startDate`* (ISO date), `templateId` (clones nodes from template), `projectId` (links to a project), `ownerId`, `dueDate`, `notes`, `status`, `frequencyDays` (recurring), `originInstanceId`.

**Node structure:** Nodes nest via `parentId`, sequence via `dependsOnId`, and embed sub-templates via `sourceTemplateId`. Each node has `durationDays` which feeds the Gantt computation.

**Node state (`PATCH /api/process/instances/{iid}/nodes/{nid}/state`):** `status`, `assigneeId`, `actualStart`, `actualEnd`, `notes`, `durationOverrideDays`, `supplierId`. Nodes can also have attached files and comments.

**Cotizaciones on nodes:** After updating a node's state you get a `state_id`; attach quotes to it via `POST /api/instance-node-states/{state_id}/cotizaciones` (fields: `proveedorId`, `monto`, `moneda`, `descripcion`, `fechaCotizacion`, `validezDias`).

Key `operation_id`s:
- `process_templates_list`, `process_templates_create`, `process_templates_update`, `process_templates_delete`
- `process_template_nodes_list`, `process_template_nodes_create` — `POST /api/process/templates/{tid}/nodes`
- `process_nodes_update` — `PATCH /api/process/nodes/{nid}`
- `process_nodes_delete` — `DELETE /api/process/nodes/{nid}`
- `process_template_preview` — `GET /api/process/templates/{tid}/preview`
- `process_instances_list` — `GET /api/process/instances?project_id={pid}`
- `process_instances_create` — `POST /api/process/instances`
- `process_instances_get` — `GET /api/process/instances/{iid}`
- `process_instances_update` — `PATCH /api/process/instances/{iid}`
- `process_instance_node_state_update` — `PATCH /api/process/instances/{iid}/nodes/{nid}/state`
- `process_instance_node_get` — `GET /api/process/instances/{iid}/nodes/{nid}`
- `process_node_files_*`, `process_node_comments_*`, `process_instance_files_*`
- `cotizaciones_list`, `cotizaciones_create` — on `instance-node-states/{state_id}/cotizaciones`

### 7. Proveedores — vendor / supplier directory

Three-level: **categories** → **proveedores** (vendors) → **cotizaciones** (quotes).

Proveedor fields: `name`, `phone`, `email`, `zona`, `status` (`activo`/`vetado`), `calidad`/`puntualidad`/`precio` ratings (1–5), `vetoReason`. Has photos.

Cotización fields: `monto`, `moneda`, `descripcion`, `validezDias`, `fechaCotizacion`, linked to a proveedor and optionally a project node.

Key `operation_id`s:
- `proveedor_categories_list`, `proveedor_categories_create`
- `proveedores_list`, `proveedores_create`, `proveedores_get`, `proveedores_update`, `proveedores_delete`
- `proveedor_cotizaciones_list`, `proveedor_cotizacion_create`, `proveedor_cotizacion_update`, `proveedor_cotizacion_delete`
- `proveedor_photos_*`

### 8. Investors — investor CRM

Global investor registry (`/api/investors`) + per-project investment tracking (`/api/projects/{id}/investors`).

Investor fields: `name`, `apellidos`, `email`, `phone`, `temperatura` (warm/cold), `capacidad` (investment capacity), `fuente` (source), `confianza` (trust level), `notes`.

Per-project investment: `status` (`interesado`/`comprometido`/`fondeado`/`retornado`), `interestedAmount`, `committedAmount`, `fundedAmount`, `interestRateAnnual`, `investmentDate`, `returnAmount`, `returnDate`.

Key `operation_id`s:
- `investors_list`, `investors_create`, `investors_get`, `investors_update`, `investors_delete`
- `project_investors_list`, `project_investors_add`, `project_investment_update`, `project_investment_delete`

### 9. Profit — waterfall calculator

Computes exit profit distribution for a project across: investor return, finder fee, director cut, team roles (responsable, líder, maestros, ayudantes), and ISR.

Two layers: a **template** with firm-wide defaults, and a per-project **config** that overrides them.

Key `operation_id`s:
- `profit_template_get`, `profit_template_update` — `GET/PUT /api/profit/template`
- `project_profit_get`, `project_profit_update` — `GET/PUT /api/projects/{id}/profit`

Both GET endpoints return `{"config": {...}, "waterfall": {...}}` — the waterfall is always recomputed live.

### 10. Documents — PDF generation

HTML → Playwright/Chromium → PDF. Returns `application/pdf` with a `Content-Disposition: attachment` header.

Key `operation_id`s:
- `documents_prospectus` — `POST /api/documents/prospectus`
  - No body required. Builds a 2-page investor pitch from **favorited** prospects.
- `documents_term_sheet` — `POST /api/documents/term-sheet`
  - Body: `{"investor_name": "...", "investment_amount": 500000, "prospect_id": null, "rate": 0.12}`
  - If `prospect_id` is null, picks the highest-ROI prospect with `status = "evaluating"`.

### 11. Team

Internal team members. Used in process node assignment and profit waterfall.

Key `operation_id`s:
- `team_list` — `GET /api/team`
- `team_create`, `team_update`, `team_delete`

### 12. Users & API Keys

User management (admin-only for cross-user operations). API key lifecycle.

Key `operation_id`s:
- `users_list`, `users_create`, `users_update`, `users_delete`
- `api_keys_list` — `GET /api/auth/api-keys`
- `api_keys_create` — `POST /api/auth/api-keys` → returns `{"token": "rfg_live_..."}` (shown once)
- `api_keys_revoke` — `DELETE /api/auth/api-keys/{id}`

### 13. Auth

- `auth_login` — `POST /api/auth/login` (form body)
- `auth_me` — `GET /api/auth/me` (returns `{"email": "..."}` for current token)

---

## When to Use the API vs. Open a PR

This is the most important judgment call you will make.

### Use the API when:

- You are reading or mutating **existing data** — create a prospect, update a project field, run an analysis, import sonar signals, update node state, add an investor.
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

1. **Computed fields are not stored raw.** Metrics like ROI, cap rate, IRR, profit are derived in the DB layer from raw inputs. Never patch a computed field directly.
2. **One way to do things.** If an operation already has an endpoint, use it. Don't duplicate logic in a new endpoint.
3. **Score before filter.** When ranking prospects, compute scores against the full dataset, then apply filters. Filtering first distorts percentiles.
4. **12-factor config.** All secrets and environment-specific values come from env vars, never from source code.
5. **Data integrity first.** A clean, correct DB record is worth more than a fast feature. Validate at boundaries; trust internal code.
