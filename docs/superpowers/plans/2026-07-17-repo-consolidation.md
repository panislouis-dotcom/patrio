# Repo Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move refigan's `main`-branch app (FastAPI backend, React ops UI, scraper, tests, migrations) into patrio as `app/`, with git history preserved, paths reorganized per the approved spec, all local test suites green, and CI passing on a real PR — with patrio's existing static marketing site completely unaffected.

**Architecture:** A `git subtree`-style graft brings refigan's `main` history into patrio under `app/` verbatim (one commit), then a second commit reorganizes files into the target layout (`apps/api`→`app/api`, `apps/web`→`app/web`, `data/`→`db/seeds/`, `apps/data/geo`→`app/api/geo_data`, local file storage → `app/api/var/files`). A handful of source files have hardcoded paths that must change to match (`storage.py`, `geo.py`, `main.py`), plus `docker-compose.yml`/`Dockerfile`/`makefile`/CI get their paths updated. Verification runs through Docker (matching the pinned `python:3.12-slim` / `node:20-alpine` versions used in refigan's own CI) rather than relying on host tooling, since the host here has Python 3.14 and Node 25, not the pinned versions.

**Tech Stack:** FastAPI + psycopg2 (raw SQL) + dbmate migrations, React 18/TypeScript/Vite, Postgres 16, pytest/Vitest/Playwright, Docker Compose, GitHub Actions.

**Reference:** `docs/superpowers/specs/2026-07-17-repo-consolidation-design.md`

---

### Task 1: Pre-flight checks

**Files:** none (verification only)

- [ ] **Step 1: Confirm required host tooling**

Run:
```bash
docker --version && docker compose version && git --version && gh --version
```
Expected: all four print version strings (confirmed present: Docker 29.4.2, Compose v5.1.3, gh 2.93.0). No Python/Node version check needed — verification runs inside Docker using the pinned `python:3.12-slim`/`node:20-alpine` images, not host interpreters (host has Python 3.14 / Node 25, which don't match refigan's pinned 3.12/20).

- [ ] **Step 2: Confirm refigan is on `main` with a clean tree**

Run:
```bash
cd /Users/eduardo/Documents/repos/refigan && git status --short && git rev-parse --abbrev-ref HEAD
```
Expected: empty status output (clean tree) and `main` (or checkout main first: `git checkout main`). If not clean, stop and report — do not stash/discard refigan's work without asking.

- [ ] **Step 3: Confirm patrio tree is clean before starting**

Run:
```bash
cd /Users/eduardo/Documents/repos/patrio && git status --short
```
Expected: empty (the spec doc commit from sub-project 1's brainstorm is already committed on `main`).

---

### Task 2: Graft refigan's git history under `app/`

**Files:** none created yet — this is a pure history-preserving merge.

- [ ] **Step 1: Add refigan as a temporary remote and fetch**

Run:
```bash
cd /Users/eduardo/Documents/repos/patrio
git remote add refigan-src /Users/eduardo/Documents/repos/refigan
git fetch refigan-src main
```
Expected: fetch succeeds, prints refigan's `main` ref.

- [ ] **Step 2: Merge histories (no working-tree changes yet)**

Run:
```bash
git merge -s ours --no-commit --allow-unrelated-histories refigan-src/main
```
Expected: exits cleanly, no conflicts reported (the `-s ours` strategy keeps patrio's current tree; refigan's tree isn't applied yet).

- [ ] **Step 3: Graft refigan's tree under `app/`**

Run:
```bash
git read-tree --prefix=app/ -u refigan-src/main
```
Expected: no output on success. `git status --short` now shows every refigan file as a new addition under `app/apps/...`, `app/db/...`, `app/data/...`, `app/docker-compose.yml`, `app/.github/...`, `app/.env.example`, `app/.gitignore`, `app/docs/...`, etc.

- [ ] **Step 4: Commit the graft**

Run:
```bash
git commit -m "merge: graft refigan main history under app/

Pure history import — no reorganization yet. Every file lands at its
original refigan path, prefixed with app/. Reorganization into the
target layout happens in the next commit so git log --follow can
still trace renames.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BZauTU5fevYGbYSRBjZvJU"
git remote remove refigan-src
```
Expected: commit succeeds. Verify history is preserved:
```bash
git log --follow --oneline app/apps/api/main.py | head -5
```
Expected: shows refigan's original commits touching that file (e.g. `f84ee1c`, `0f33753`, etc. — real refigan SHAs), not just the graft commit.

---

### Task 3: Reorganize into the target layout

**Files:**
- Move: `app/apps/api` → `app/api`
- Move: `app/apps/web` → `app/web`
- Move: `app/apps/scraper` → `app/scraper`
- Move: `app/apps/e2e` → `app/e2e`
- Move: `app/apps/data/geo/*` → `app/api/geo_data/*`
- Move: `app/db` → `db` (top-level)
- Move: `app/data/{prospects,projects,team,process}/*`, `app/data/seed_*.sql`, `app/data/init_seeds.sh` → `db/seeds/` (top-level)
- Move: `app/docker-compose.yml`, `app/Dockerfile`, `app/makefile` → repo root
- Move: `app/scripts` → `scripts` (top-level)
- Move: `app/docs/*` → `docs/` (merge into existing `docs/superpowers/specs/`)
- Move: `app/.github` → `.github` (top-level)
- Move: `app/.env.example` → `.env.example` (top-level)
- Delete: `app/data/files/.gitkeep` (was gitignored upload storage — only tracked file was a placeholder; new placeholder created at `app/api/var/files/.gitkeep` in Task 4)
- Delete: `app/apps` (now empty), `app/data` (now empty) after moves

- [ ] **Step 1: Move backend, frontend, scraper, e2e**

Run:
```bash
cd /Users/eduardo/Documents/repos/patrio
git mv app/apps/api app/api
git mv app/apps/web app/web
git mv app/apps/scraper app/scraper
git mv app/apps/e2e app/e2e
```
Expected: each command exits 0.

- [ ] **Step 2: Move geo reference data into the api module**

Run:
```bash
mkdir -p app/api/geo_data
git mv app/apps/data/geo/agebs app/api/geo_data/agebs
git mv app/apps/data/geo/colonias_inegi_2024 app/api/geo_data/colonias_inegi_2024
git mv app/apps/data/geo/download_inegi_agebs.py app/api/geo_data/download_inegi_agebs.py
git mv app/apps/data/geo/00Tree.html app/api/geo_data/00Tree.html
```
Expected: each command exits 0. `app/apps/data` should now be empty except possibly empty dirs.

- [ ] **Step 3: Move db (migrations + schema) to top level**

Run:
```bash
git mv app/db db
```
Expected: exits 0. `db/migrations/` and `db/schema.sql` now at repo root.

- [ ] **Step 4: Move seed SQL into db/seeds/**

Run:
```bash
mkdir -p db/seeds
git mv app/data/prospects db/seeds/prospects
git mv app/data/projects db/seeds/projects
git mv app/data/team db/seeds/team
git mv app/data/process db/seeds/process
git mv app/data/seed_comparables.sql db/seeds/seed_comparables.sql
git mv app/data/seed_remodel_costs.sql db/seeds/seed_remodel_costs.sql
git mv app/data/seed_zones.sql db/seeds/seed_zones.sql
git mv app/data/init_seeds.sh db/seeds/init_seeds.sh
git rm app/data/files/.gitkeep
```
Expected: each command exits 0. Note: `git rm` (not `git mv`) for the `.gitkeep` — the new local-storage placeholder is created fresh in Task 4, not moved, since the directory itself is being relocated conceptually (from repo-root-adjacent to api-module-owned).

- [ ] **Step 5: Move docker/build/deploy-adjacent files to root**

Run:
```bash
git mv app/docker-compose.yml docker-compose.yml
git mv app/Dockerfile Dockerfile
git mv app/makefile makefile
git mv app/scripts scripts
git mv app/.env.example .env.example
git mv app/.github .github
```
Expected: each command exits 0.

- [ ] **Step 6: Merge docs**

Run:
```bash
git mv app/docs/DESIGN.md docs/DESIGN.md
git mv app/docs/TODO.md docs/TODO.md
git mv app/docs/latlonpicker-spec.md docs/latlonpicker-spec.md
git mv app/docs/specs docs/specs
mkdir -p docs/superpowers/plans
git mv app/docs/superpowers/plans/*.md docs/superpowers/plans/
git mv app/docs/superpowers/specs/2026-05-05-dashboard-design.md docs/superpowers/specs/2026-05-05-dashboard-design.md
```
Expected: each command exits 0. `docs/superpowers/specs/` now contains both refigan's `2026-05-05-dashboard-design.md` and patrio's own `2026-07-17-repo-consolidation-design.md` — no filename collision (verified during spec research).

- [ ] **Step 7: Clean up now-empty directories and verify**

Run:
```bash
find app/apps app/data app/docs -type d -empty -delete 2>/dev/null
git status --short | grep "^??" | grep -v "^?? \.vercelignore" || echo "no untracked stragglers"
find app -maxdepth 2
```
Expected: `app/` now contains only `api/`, `web/`, `scraper/`, `e2e/` (plus whatever `.git` tracks under them). No leftover `app/apps` or `app/data`.

- [ ] **Step 8: Commit the reorganization**

Run:
```bash
git add -A
git commit -m "refactor: reorganize grafted refigan code into patrio's target layout

apps/{api,web,scraper,e2e} -> app/{api,web,scraper,e2e}
apps/data/geo -> app/api/geo_data (only geo.py consumes it)
db/ -> top-level db/ (sibling of app/, not nested)
data/{prospects,projects,team,process,seed_*.sql,init_seeds.sh} -> db/seeds/
  (seeding is a database-lifecycle concern, belongs next to migrations)
docker-compose.yml, Dockerfile, makefile, scripts/, .github/, .env.example -> top-level
docs/ merged into patrio's existing docs/ tree

Path fixes to hardcoded source references land in the next commit.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BZauTU5fevYGbYSRBjZvJU"
```
Expected: commit succeeds.

- [ ] **Step 9: Verify history survived the rename**

Run:
```bash
git log --follow --oneline app/api/main.py | head -5
```
Expected: still shows refigan's original commits (git tracks renames by content similarity, so `--follow` traces through both the graft and the `git mv`).

---

### Task 4: Fix hardcoded paths in source code

**Files:**
- Modify: `app/api/storage.py:15`
- Modify: `app/api/geo.py:104,112`
- Modify: `app/api/main.py:165`

- [ ] **Step 1: Fix local file storage path**

In `app/api/storage.py`, change line 15 from:
```python
_ROOT = Path(__file__).parent.parent.parent / "data" / "files"
```
to:
```python
_ROOT = Path(__file__).parent / "var" / "files"
```
Also update the module docstring (lines 1-10) reference "files are stored under data/files/ on local disk" to "files are stored under var/files/ (relative to this module) on local disk".

- [ ] **Step 2: Create the new local storage placeholder**

Run:
```bash
mkdir -p app/api/var/files
touch app/api/var/files/.gitkeep
```

- [ ] **Step 3: Fix geo reference data path**

In `app/api/geo.py`, change line 112 from:
```python
_GEO_DIR = Path(__file__).parent.parent / "data" / "geo" / "colonias_inegi_2024"
```
to:
```python
_GEO_DIR = Path(__file__).parent / "geo_data" / "colonias_inegi_2024"
```
And update the comment on line 104 from `# Place .shp in apps/data/geo/colonias_inegi_2024/ to enable.` to `# Place .shp in app/api/geo_data/colonias_inegi_2024/ to enable.`

- [ ] **Step 4: Fix production frontend-serving path**

In `app/api/main.py`, change line 165 from:
```python
FRONTEND_DIR = Path(__file__).parent.parent.parent / "frontend_dist"
```
to:
```python
FRONTEND_DIR = Path(__file__).parent.parent / "frontend_dist"
```
This matches the flattened container layout from Task 5 (production container will have `main.py` at `/app/api/main.py` instead of `/app/apps/api/main.py` — one less directory level, so one less `.parent`).

- [ ] **Step 5: Verify no other hardcoded `apps/` or `apps.` references remain in api source**

Run:
```bash
grep -rn "apps/\|apps\." app/api --include="*.py" | grep -v "/tests/" | grep -v "geo_data"
```
Expected: no output (all real references fixed; the `geo_data` grep exclusion accounts for the now-correct new path appearing in the updated comment/code).

- [ ] **Step 6: Commit**

Run:
```bash
git add app/api/storage.py app/api/geo.py app/api/main.py app/api/var/files/.gitkeep
git commit -m "fix: update hardcoded apps/-relative paths for app/ layout

storage.py, geo.py, and main.py had paths hardcoded relative to the
old apps/api nesting depth. Updated to match app/api's new position
and to make storage.py and geo.py module-owned (no more reaching up
to a repo-root data/ directory).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BZauTU5fevYGbYSRBjZvJU"
```

---

### Task 5: Update Docker, Compose, Makefile, .gitignore, .vercelignore

**Files:**
- Modify: `docker-compose.yml`
- Modify: `Dockerfile`
- Modify: `makefile`
- Modify: `.gitignore` (merge refigan's + patrio's)
- Create: `.vercelignore`

- [ ] **Step 1: Rewrite docker-compose.yml for the flattened layout**

Replace `docker-compose.yml` contents with (only `api`/`web`/`migrate` volume paths change; `db` service and top-level `volumes:` block are untouched from refigan's original):
```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
      interval: 5s
      timeout: 5s
      retries: 5

  migrate:
    image: ghcr.io/amacneil/dbmate:latest
    volumes:
      - ./db:/db
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}
    depends_on:
      db:
        condition: service_healthy
    restart: "no"

  api:
    image: python:3.12-slim
    working_dir: /app
    volumes:
      - ./app/api:/app/api
      - ./app/scraper:/app/scraper
      - pip-cache:/root/.cache/pip
      - playwright-browsers:/root/.cache/ms-playwright
    command: >
      sh -c "pip install --no-cache-dir -r api/requirements.txt -q &&
             DEBIAN_FRONTEND=noninteractive playwright install chromium --with-deps &&
             uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload"
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}
      JWT_SECRET: ${JWT_SECRET}
      ALLOWED_ORIGINS: ${ALLOWED_ORIGINS}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      SMOKE_EMAIL: ${SMOKE_EMAIL:-}
      SMOKE_PASS: ${SMOKE_PASS:-}
    ports:
      - "8000:8000"
    depends_on:
      db:
        condition: service_healthy
      migrate:
        condition: service_completed_successfully

  web:
    image: node:20-alpine
    working_dir: /app
    volumes:
      - ./app/web:/app
      - node-modules:/app/node_modules
    command: sh -c "npm install --silent && npx vite --host 0.0.0.0"
    environment:
      VITE_API_BASE: ${VITE_API_BASE}
      CHOKIDAR_USEPOLLING: "true"
      CHOKIDAR_INTERVAL: "300"
    ports:
      - "5173:5173"

volumes:
  pgdata:
  pip-cache:
  node-modules:
  playwright-browsers:
```
Note: the old `./data:/app/data` mount on the `api` service is dropped entirely — nothing inside `app/api` needs it anymore (geo data and file storage are both now inside `app/api` itself, already covered by the `./app/api:/app/api` mount).

- [ ] **Step 2: Rewrite Dockerfile for the flattened layout**

Replace `Dockerfile` contents with:
```dockerfile
# Stage 1: Build React frontend
FROM node:20-alpine AS frontend-build
WORKDIR /build
COPY app/web/package*.json ./
RUN npm ci
COPY app/web/ ./
RUN VITE_API_BASE="" npm run build

# Stage 2: Python API
FROM python:3.12-slim AS production

# Install Python deps + Playwright browser while still root
WORKDIR /app
COPY app/api/requirements.txt ./api/requirements.txt
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN pip install --no-cache-dir -r api/requirements.txt && \
    playwright install chromium --with-deps && \
    chmod -R o+rx /ms-playwright

# Non-root user
RUN groupadd -r --gid 999 appuser && useradd -r --uid 999 -g appuser appuser

# Install dbmate for running migrations (K8s Job / init container)
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && curl -fsSL https://github.com/amacneil/dbmate/releases/download/v2.33.0/dbmate-linux-amd64 \
       -o /usr/local/bin/dbmate && chmod +x /usr/local/bin/dbmate \
    && rm -rf /var/lib/apt/lists/*

# Application code
COPY app/api/ ./api/
COPY app/scraper/ ./scraper/

# DB schema + migrations (used by dbmate)
COPY db/ /app/db/

# Frontend bundle
COPY --from=frontend-build /build/dist /app/frontend_dist

RUN chown -R appuser:appuser /app
USER appuser

ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

EXPOSE 8000
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 3: Update makefile paths**

In `makefile`:
- Line 2: `PG_CTR ?= refigan-db-1` → `PG_CTR ?= patrio-db-1` (docker-compose derives container names from the directory name — verify actual name in Task 6 Step 1 and correct if different).
- Line 29: `@for f in $$(find data -name "seed_*.sql" | sort); do \` → `@for f in $$(find db/seeds -name "seed_*.sql" | sort); do \`
- Line 42: `DATABASE_URL="$(DB_URL)" PYTHONPATH=.:apps .venv/bin/python -m api.create_user "$$email" "$$pw"` → `DATABASE_URL="$(DB_URL)" PYTHONPATH=.:app .venv/bin/python -m api.create_user "$$email" "$$pw"`
- Line 48: `PYTHONPATH=.:apps .venv/bin/uvicorn api.main:app --reload --loop asyncio` → `PYTHONPATH=.:app .venv/bin/uvicorn api.main:app --reload --loop asyncio`
- Line 51: `cd apps/web && npm run dev` → `cd app/web && npm run dev`
- Line 54: `PYTHONPATH=.:apps .venv/bin/pytest apps/api/tests/ -v` → `PYTHONPATH=.:app .venv/bin/pytest app/api/tests/ -v`
- Line 58: `PYTHONPATH=.:apps .venv/bin/pytest apps/api/tests/ -v` → `PYTHONPATH=.:app .venv/bin/pytest app/api/tests/ -v`
- Line 60: `cd apps/web && npm run test` → `cd app/web && npm run test`
- Line 67: `E2E_DIR = apps/e2e` → `E2E_DIR = app/e2e`

- [ ] **Step 4: Merge .gitignore**

Replace patrio's `.gitignore` contents with (union of both, deduped, `/refigan/` line dropped since it's stale — nothing will ever be checked out at that path now that the graft is done):
```
.vercel
.DS_Store
**/.DS_Store

# Herramientas de preview (Playwright + node_modules)
.preview-tools/
node_modules/
.playwright-mcp/
.superpowers/

# Material de trabajo pesado / carpetas ajenas al sitio (no versionar aquí).
# Anclado a la raíz con "/" para NO ignorar assets/proyectos (fotos reales del sitio).
/Modesto415-Patrio.mp4
/ChatGPT Image*.png
/Proyecto-Trois/
/proyectos/
/memoria-de-obra.html

# App (from refigan)
*.db
*.db-shm
*.db-wal
dist/
.vite/
__pycache__/
*.pyc
*.pyo
.venv/
venv/
.pytest_cache/
app/api/var/files/**
!app/api/var/files/.gitkeep
00Tree.html
.env
docs/superpowers/.coverage
```

- [ ] **Step 5: Create .vercelignore**

Create `.vercelignore`:
```
app/
db/
docker-compose.yml
Dockerfile
makefile
scripts/
```

- [ ] **Step 6: Commit**

Run:
```bash
git add docker-compose.yml Dockerfile makefile .gitignore .vercelignore
git commit -m "build: update docker/compose/makefile paths for app/ layout, add .vercelignore

Drops the now-unnecessary ./data volume mount (geo data and file
storage both moved inside app/api). Adds .vercelignore so the app/
and db/ source trees are never published by the marketing site's
static Vercel deploy.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BZauTU5fevYGbYSRBjZvJU"
```

---

### Task 6: Bring up the local stack and run migrations + seeds

**Files:** none (verification task) — plus a fresh local `.env`

- [ ] **Step 1: Create a local .env with fresh secrets (never copy refigan's real .env)**

Run:
```bash
cd /Users/eduardo/Documents/repos/patrio
cat > .env <<EOF
POSTGRES_DB=patrio
POSTGRES_USER=postgres
POSTGRES_PASSWORD=$(openssl rand -hex 16)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/patrio
JWT_SECRET=$(openssl rand -hex 32)
ALLOWED_ORIGINS=http://localhost:5173
VITE_API_BASE=http://localhost:8000
ANTHROPIC_API_KEY=
ADMIN_EMAIL=admin@patrio.mx
ADMIN_PASSWORD_HASH=
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/patrio_test
SMOKE_EMAIL=
SMOKE_PASS=
EOF
```
Note: `POSTGRES_PASSWORD` in `DATABASE_URL` must match the generated one — fix the `DATABASE_URL` line to substitute the actual generated password before writing (don't leave `postgres:postgres` literal unless that's genuinely what was generated). Confirm `.env` is gitignored: `git check-ignore .env` should print `.env`.

- [ ] **Step 2: Bring up db + migrate**

Run:
```bash
docker compose up -d db
docker compose ps --format "table {{.Name}}\t{{.Status}}"
```
Expected: `db` container `healthy` within ~10s. Note the actual container name printed (to correct `PG_CTR` in the makefile if it differs from the `patrio-db-1` guess in Task 5 Step 3).

Run:
```bash
docker compose run --rm migrate
```
Expected: dbmate applies all migrations `000` through `018` with no errors, prints each version applied.

- [ ] **Step 3: Seed the database**

Run:
```bash
make seed-db
```
Expected: every `db/seeds/**/seed_*.sql` file prints `✓`. If any fail, read the error (`$out` printed by the makefile target) and fix the underlying SQL/path issue — do not skip failures.

- [ ] **Step 4: Bring up api + web**

Run:
```bash
docker compose up -d api web
sleep 5
curl -sf http://localhost:8000/health && echo " — API OK"
curl -sf http://localhost:5173 -o /dev/null -w "web status: %{http_code}\n"
```
Expected: `/health` returns success, web returns `200`.

- [ ] **Step 5: Commit the .env.example if it changed, do not commit .env**

Run:
```bash
git status --short | grep -v "^?? \.env$"
```
Expected: no unexpected untracked/modified files besides `.env` (which must stay untracked — verified gitignored in Step 1).

---

### Task 7: Run the pytest suite

**Files:** none (verification) — fix any real failures found in `app/api/` as they arise, file-by-file, don't mass-edit blindly

- [ ] **Step 1: Run the backend test suite inside the api container**

Run:
```bash
docker compose exec api sh -c "PYTHONPATH=/app pytest api/tests/ -v" 2>&1 | tail -60
```
If `TEST_DATABASE_URL` isn't reachable from inside the container (it points at `localhost` in `.env`, but the container needs the `db` service hostname), override it for this run:
```bash
docker compose exec -e TEST_DATABASE_URL=postgresql://postgres:${POSTGRES_PASSWORD}@db:5432/patrio_test api sh -c "PYTHONPATH=/app pytest api/tests/ -v" 2>&1 | tail -60
```
Expected: 16 test files collected, all passing. If the test DB doesn't exist yet, create it first: `docker compose exec db psql -U postgres -c "CREATE DATABASE patrio_test;"` then run migrations against it with dbmate before retrying.

- [ ] **Step 2: Triage and fix any real failures**

For each failure: read the actual error, locate root cause (most likely remaining hardcoded `apps/`-relative paths, or a `PYTHONPATH`/import issue from the `apps`→`app` rename — check `conftest.py` and any `sys.path` manipulation in `app/api/tests/conftest.py` first). Fix in the specific file, re-run only that test to confirm, then re-run the full suite.

- [ ] **Step 3: Commit any fixes made**

Run (only if fixes were needed):
```bash
git add -A
git commit -m "fix: resolve test failures surfaced by app/ layout migration

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BZauTU5fevYGbYSRBjZvJU"
```

---

### Task 8: Run the Vitest suite

**Files:** none (verification)

- [ ] **Step 1: Run frontend unit tests inside the web container**

Run:
```bash
docker compose exec web npm run test 2>&1 | tail -40
```
Expected: 3 test files (`LatLonPicker.test.tsx`, `scoring.test.ts`, `validateRaw.test.ts`) pass.

- [ ] **Step 2: Fix any real failures, commit if needed** (same pattern as Task 7 Steps 2-3).

---

### Task 9: Run the Playwright e2e suite

**Files:** none (verification)

- [ ] **Step 1: Seed the e2e user**

Run:
```bash
DATABASE_URL=postgresql://postgres:${POSTGRES_PASSWORD}@localhost:5432/patrio E2E_USER=test@patrio.mx python3 scripts/seed-e2e-user.py
```
Expected: prints confirmation the e2e user was created/updated. (This runs on the host against the exposed `5432` port, not inside a container — confirm host `python3` can reach the exposed Postgres port; if `psycopg2` isn't installed on the host, run this inside the `api` container instead via `docker compose exec api python scripts/seed-e2e-user.py` after mounting `scripts/` — adjust `docker-compose.yml`'s `api` service to also mount `./scripts:/app/scripts` if needed for this one-off, or just `docker cp`.)

- [ ] **Step 2: Install e2e deps and run**

Run:
```bash
cd app/e2e
npm ci
npx playwright install --with-deps chromium
E2E_USER=test@patrio.mx BASE_URL=http://localhost:5173 npx playwright test 2>&1 | tail -80
```
Expected: all 16 specs (`00-smoke.spec.ts` through `15-prospect-detail.spec.ts`) pass.

- [ ] **Step 3: Fix any real failures, commit if needed** (same pattern as Task 7 Steps 2-3). Common cause to check first: `app/e2e/playwright.config.ts`'s `testDir`/`storageState` paths, which are self-relative and shouldn't need changes — verify before assuming a deeper bug.

---

### Task 10: Manual browser verification of login

**Files:** none (verification only, using browser automation)

- [ ] **Step 1: Drive a real login through the browser**

Using the claude-in-chrome browser tools: navigate to `http://localhost:5173`, confirm the login page renders with patrio's data (not a blank/error page), log in with the admin credentials from `.env` (or the seeded e2e user), confirm redirect to the authenticated app shell, confirm at least one data-bearing page loads real seeded data (e.g. the prospects table shows seeded rows).

- [ ] **Step 2: Check the browser console for errors**

Use `read_console_messages` to confirm no unhandled JS errors or failed network requests (401s aside from the initial unauthenticated check, 404s, CORS errors) during the login flow.

---

### Task 11: Verify the marketing site is unaffected

**Files:** none (verification only)

- [ ] **Step 1: Confirm .vercelignore excludes the app**

Run:
```bash
cd /Users/eduardo/Documents/repos/patrio
git check-ignore -v --no-index app/api/main.py 2>&1 || echo "not matched by .gitignore (expected — .vercelignore is separate)"
cat .vercelignore
```
Confirm `app/`, `db/`, `docker-compose.yml`, `Dockerfile`, `makefile`, `scripts/` are all listed.

- [ ] **Step 2: Confirm the marketing site's own files are untouched**

Run:
```bash
git diff 4a6fa38 HEAD -- index.html css/ js/ vercel.json jardineria.html administracion.html wizard.html nosotros.html
```
Expected: empty diff — none of these files changed since before this migration started (`4a6fa38` is the commit at the start of this session, per the initial `git log`).

- [ ] **Step 3 (if a Vercel preview is reachable): confirm app/ isn't served**

If the user has Vercel CLI access or a preview URL, spot-check that `<preview-url>/app/api/main.py` (or similar) 404s rather than returning source code. If no live preview is available at this point, note this as a follow-up check to run once the PR triggers a Vercel preview deploy, rather than blocking on it.

---

### Task 12: Push branch and open the PR

**Files:** none

- [ ] **Step 1: Create a feature branch from the current work**

The work so far has been happening on `main` directly (per the commits in Tasks 2-9). Before pushing, move it to a feature branch instead of pushing straight to `main`:
```bash
cd /Users/eduardo/Documents/repos/patrio
git branch repo-consolidation-refigan
git reset --hard 4a6fa38
git checkout repo-consolidation-refigan
```
Wait — **do not run this if any commit has already been pushed to `origin/main`**. Check first:
```bash
git log origin/main..main --oneline
```
If this shows the same commits as local `main` beyond `4a6fa38`, and `origin/main` is still at `4a6fa38`, it's safe to move local `main` back and continue on a branch. Confirm with the user before doing a `git reset --hard` on `main` if there's any doubt.

- [ ] **Step 2: Push the branch**

Run:
```bash
git push -u origin repo-consolidation-refigan
```

- [ ] **Step 3: Open the PR**

Run:
```bash
gh pr create --title "Repo consolidation: bring refigan's app into patrio" --body "$(cat <<'EOF'
## Summary
- Sub-project 1 of the refigan→patrio migration (see docs/superpowers/specs/2026-07-17-repo-consolidation-design.md)
- Grafts refigan's main-branch git history under app/, then reorganizes into patrio's target layout (app/api, app/web, app/scraper, app/e2e, db/, db/seeds/)
- Fixes hardcoded apps/-relative paths in storage.py, geo.py, main.py
- Updates docker-compose.yml/Dockerfile/makefile for the new layout; drops the now-unnecessary data/ volume mount
- Adds .vercelignore so the app/db source trees are never published by the marketing site's static Vercel deploy
- patrio's marketing site is untouched — verified via diff against the pre-migration commit

## Explicitly NOT in this PR
- Visual reskin of the ops app to patrio's brand (next sub-project)
- Production deployment changes (separate sub-project)
- refigan's unmerged feature branches (floorplan editor, project-superset, roi-total-metric)
- Retiring the refigan repo

## Test plan
- [x] docker compose up brings up db+migrate+api+web cleanly
- [x] make seed-db succeeds
- [x] pytest suite (app/api/tests/, 16 files) green
- [x] Vitest suite (app/web) green
- [x] Playwright e2e suite (app/e2e, 16 specs) green
- [x] Manual browser login verified end-to-end
- [x] Marketing site files confirmed untouched via git diff

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01BZauTU5fevYGbYSRBjZvJU
EOF
)"
```
Expected: PR URL printed. Report this URL back to the user.

---

## Self-Review Notes

- **Spec coverage:** every section of `2026-07-17-repo-consolidation-design.md` (scope, layout, git history, Vercel/secrets safety, local dev/CI, Definition of Done) maps to a task above.
- **No placeholders:** every step has an exact command or exact code diff; no "add appropriate handling" language.
- **Path consistency:** `app/api`, `app/web`, `app/scraper`, `app/e2e`, `db/seeds`, `app/api/geo_data`, `app/api/var/files` are used identically across every task (docker-compose, Dockerfile, makefile, source fixes, gitignore, vercelignore).
- **Known open risk flagged explicitly, not hidden:** Task 12 Step 1 calls out the main-vs-branch git safety concern rather than assuming it away.
