# Repo Consolidation: Bringing refigan into patrio (Sub-project 1)

**Status:** Approved, ready for implementation planning
**Date:** 2026-07-17

## Context

`refigan` (`/Users/eduardo/Documents/repos/refigan`) is a full-stack real-estate investment operations platform — prospect pipeline, project tracking, investor management, ROI analysis, document generation, a real-estate-listing scraper ("Sonar"), construction process/Gantt management, supplier/quotation tracking, profit-sharing waterfall, team org chart, and JWT-based auth. Its own README already brands the product **"Patrio · Real Estate Platform"** — it is not a separate app to draw inspiration from, it is the real app, living under an internal codename.

`patrio` (this repo) is currently a static marketing/investor-pitch site: plain HTML/CSS/JS (one `wizard.js`, one `styles.css`), no build step, deployed straight to Vercel (`vercel.json`, `outputDirectory: "."`, empty `buildCommand`).

**Goal:** refigan gets retired. Its code, features, and (where sensible) git history move into patrio, which becomes the single canonical repo for both the public marketing site and the internal login-gated operations app.

**This is sub-project 1 of a 4-part migration:**
1. **Repo consolidation** (this spec) — move the code, get it running in patrio, tests green. Ops app keeps refigan's current look for now.
2. **Visual reskin** (immediate follow-up, own spec) — restyle the ops app to patrio's actual brand (sage green `#6B8A5E`, Playfair Display + Inter, warm off-white, soft rounded corners/shadows) instead of refigan's own "Mountain Permanence" design system. Deliberately sequenced after sub-project 1 so a functional regression is never confused with a styling regression.
3. **Deployment migration** (own spec) — repoint the Docker/AWS-ECR/Kubernetes/ArgoCD pipeline (or a new target) to build from patrio; decide how the public marketing site and the internal app coexist (e.g. subdomain).
4. **Retire refigan** — archive/delete the repo once patrio is confirmed as the working replacement.

Only sub-project 1 is scoped in detail here.

## Scope

**In scope:** everything on refigan's `main` branch — `apps/api`, `apps/web`, `apps/scraper`, `apps/data`, `db/migrations` + `schema.sql`, seed data, `apps/e2e`, CI (adapted).

**Explicitly out of scope for sub-project 1:**
- The visual reskin (sub-project 1b).
- Any change to production deployment (sub-project 2). `deploy.yml`, `deploy-qa.yml`, `smoke.yml` are not migrated yet — they target refigan's AWS ECR image and infra that doesn't exist for patrio yet.
- refigan's unmerged feature branches: `feat/project-floorplan-editor` (2D floorplan canvas editor), `feat/project-superset` / `feat/project-superset-v2` (financial-layer consolidation, `NUMERIC` money columns, prospect→project conversion), `feat/roi-total-metric`, `tech-debt-hardening`, `bim-mapping`. These get evaluated and merged (or not) as sub-project 3, after patrio is already running the stable `main`-branch app.
- The top-level `bim/` Blender/IFC authoring toolkit. It's disconnected from the web app on every branch (no code in `apps/api`/`apps/web` reads or writes `.ifc` files) and is itself mostly unbuilt scaffolding on `main`. Stays in refigan until there's an actual integration to migrate.

## Target Directory Layout

```
patrio/
├── index.html, jardineria.html, administracion.html, wizard.html, nosotros.html,
│   css/, js/, proyectos/, assets/, vercel.json,
│   Patrio_DesignBrief_v2.md, Patrio_WhitePaper_v2.docx, and other root-level
│   business/marketing docs                                  ← ALL untouched (marketing site)
├── .vercelignore                ← NEW (see Vercel Safety below)
├── app/
│   ├── api/                     ← from refigan apps/api (FastAPI, raw SQL/psycopg2, JWT auth)
│   │   ├── geo_data/             ← from refigan apps/data/geo/ (INEGI shapefiles; only geo.py uses this)
│   │   └── var/files/            ← NEW local-disk upload storage path (gitignored); replaces refigan's data/files/
│   ├── web/                     ← from refigan apps/web (React 18 + TS + Vite + React Router ops UI)
│   ├── scraper/                 ← from refigan apps/scraper (per-portal listing scrapers)
│   └── e2e/                     ← from refigan apps/e2e (Playwright, 16 specs)
├── db/
│   ├── migrations/              ← from refigan db/migrations (dbmate, 000-018 on main)
│   ├── schema.sql
│   └── seeds/                   ← from refigan's top-level data/ (all seed_*.sql + init_seeds.sh)
├── docker-compose.yml, Dockerfile, makefile   ← from refigan, paths updated
├── scripts/                     ← from refigan (seed-e2e-user.py, wait-for-api.sh)
└── docs/
    ├── DESIGN.md, TODO.md, specs/, superpowers/   ← from refigan
    └── superpowers/specs/2026-07-17-repo-consolidation-design.md   ← this file
```

**Rationale for deviating from refigan's own layout (not a blind copy):**
- refigan split "data" across two unrelated top-level dirs: `data/` (DB seed SQL, tracked in git) and `apps/data/` (INEGI geo reference data, only consumed by `apps/api/geo.py`) — plus `data/files/` was actually gitignored runtime upload storage, not source data at all.
- New structure: seed SQL moves to `db/seeds/` (seeding is a database-lifecycle concern, belongs next to migrations, not as its own top-level concept). Geo reference data moves to `app/api/geo_data/` (owned by the only module that reads it). Local upload storage becomes `app/api/var/files/` (owned by the api module, gitignored).
- Required code change: `apps/api/storage.py:15` hardcodes `_ROOT = Path(__file__).parent.parent.parent / "data" / "files"` (three levels up to repo root). This becomes a path relative to the module itself (`app/api/var/files`) rather than reaching up to the repo root.
- Required config updates: `.gitignore` (drop `data/files/**`, add `app/api/var/files/**`), `makefile`/`docker-compose.yml`/`init_seeds.sh` references from `data/...` to `db/seeds/...`.

## Git History

refigan's `main` branch history is grafted into patrio under `app/` via `git subtree`-style merge, not a fresh copy:

```bash
git remote add refigan-src ../refigan
git fetch refigan-src main
git merge -s ours --no-commit --allow-unrelated-histories refigan-src/main
git read-tree --prefix=app/ -u refigan-src/main
git commit -m "merge: graft refigan main history under app/"
```

This preserves `git log --follow`/`git blame` on every file that moves, which matters given how much design/decision context lives in refigan's commit messages and `docs/superpowers/plans/`.

Note: because the target layout above moves files during the graft (`apps/api` → `app/api`, `data/` → `db/seeds/`, `apps/data` → `app/api/geo_data`), the graft itself lands files at refigan's original paths, and a **second commit** renames/reorganizes them into the target layout — this keeps the graft commit a pure history import (`git log --follow` still traces through renames) and isolates the deliberate restructuring into its own reviewable commit.

## Vercel & Secrets Safety

**Vercel:** `vercel.json` currently has `outputDirectory: "."` and no build command, meaning every file in the repo is published as a static asset. Adding `app/` (Python/TS source), `db/`, `data/`, and Docker files without a guard would make backend source and internal docs publicly fetchable at the next push. Fix: add `.vercelignore` excluding `app/`, `db/`, `docker-compose.yml`, `Dockerfile`, `makefile`, `scripts/`. Verified as part of Definition of Done (marketing site still deploys correctly, `app/` is not fetchable from the live site).

**Secrets:** refigan's `.env` (root) holds real, populated secrets — `POSTGRES_PASSWORD`, `JWT_SECRET`, `ANTHROPIC_API_KEY`, `ADMIN_PASSWORD_HASH`, `DEPLOY_KEY`, etc. This file is **never** copied into patrio. Only `.env.example` (names, placeholder/blank values) comes over. patrio's local dev setup generates its own fresh secrets (`openssl rand -hex 32` for `JWT_SECRET`/`POSTGRES_PASSWORD`, a freshly created admin user via `make create-user`).

## Local Dev, CI, Definition of Done

- `docker-compose.yml`, `Dockerfile`, `makefile` come over from refigan with paths updated to match the new layout.
- `.github/workflows/ci.yml` comes over adapted to the new paths, keeping its four jobs: `migrate-smoke`, `typecheck`, `api-tests`, `e2e`. `deploy.yml`/`deploy-qa.yml`/`deploy-qa-health-check.yml`/`smoke.yml` are not migrated (sub-project 2).

**Definition of Done** — all verified locally/in CI before this sub-project is called complete:
1. `docker-compose up` brings up `db` + `migrate` + `api` + `web` cleanly from the patrio repo.
2. `make seed-db` seeds successfully from `db/seeds/`.
3. Backend pytest suite (`app/api/tests/`, 16 files) green.
4. Frontend Vitest suite (`app/web`, 3 files) green.
5. Playwright e2e suite (`app/e2e`, 16 specs) green against the local stack.
6. Login works end-to-end in a real browser (JWT auth round-trip), driven manually, not just inferred from passing tests.
7. patrio's existing marketing site still builds/deploys unchanged on Vercel; `app/` is confirmed not publicly fetchable.
8. The adapted CI workflow is green on an actual pull request, not just locally.

## Explicitly Deferred

- Visual reskin of the ops app to patrio's brand (sub-project 1b, next).
- Production deployment / hosting decisions (sub-project 2).
- Merging refigan's unmerged feature branches — floorplan/BIM editor, project-superset financial consolidation, roi-total-metric (sub-project 3).
- Archiving/deleting the refigan repo (sub-project 4).
- The top-level `bim/` Blender/IFC toolkit (not integrated with the web app on any branch; migrated only if/when an actual integration exists).
