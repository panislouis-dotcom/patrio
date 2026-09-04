DB_URL            ?= $(shell grep '^DATABASE_URL=' .env | cut -d= -f2-)
PG_CTR            ?= patrio-db-1
PG_USER           ?= $(shell grep '^POSTGRES_USER=' .env | cut -d= -f2)
PG_DB             ?= $(shell grep '^POSTGRES_DB=' .env | cut -d= -f2)
TEST_PG_DB        ?= $(shell grep '^TEST_DATABASE_URL=' .env | cut -d= -f2- | sed 's|.*/||')
# Replace localhost→db so dbmate connects via compose network
TEST_DB_URL_COMPOSE ?= $(shell grep '^TEST_DATABASE_URL=' .env | cut -d= -f2- | sed 's/localhost/db/g;s/127\.0\.0\.1/db/g')
PSQL               = docker exec -i $(PG_CTR) psql -U $(PG_USER) -d $(PG_DB) --set=ON_ERROR_STOP=on
PSQL_TEST          = docker exec -i $(PG_CTR) psql -U $(PG_USER) -d $(TEST_PG_DB) --set=ON_ERROR_STOP=on

dev-env: ## Deja el .env de este worktree listo (credenciales de ~/.config/patrio/dev.env)
	@python3 scripts/dev_env.py

install-dev: ## Install development tools — run once after cloning (Mac)
	@command -v dbmate >/dev/null 2>&1 && echo "dbmate already installed" || brew install dbmate

migrate: ## Run pending DB migrations (via docker compose)
	docker compose run --rm migrate

reset-db: ## Drop schema and re-run all migrations from scratch
	$(PSQL) -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
	docker compose run --rm migrate

reset-test-db: ## Wipe and recreate the test DB, then migrate
	-docker exec -i $(PG_CTR) psql -U $(PG_USER) -d postgres -c "DROP DATABASE IF EXISTS $(TEST_PG_DB);"
	docker exec -i $(PG_CTR) psql -U $(PG_USER) -d postgres -c "CREATE DATABASE $(TEST_PG_DB);"
	docker compose run --rm -e DATABASE_URL=$(TEST_DB_URL_COMPOSE) migrate

full-reset: reset-db seed-db ## Drop schema, recreate, and apply all seeds

seed-db: ## Apply all seed_*.sql files
	@for f in $$(find db/seeds -name "seed_*.sql" | sort); do \
		printf "  ▸ %-60s" "$$f"; \
		if out=$$($(PSQL) -f - < "$$f" 2>&1); then \
			echo "✓"; \
		else \
			echo "✗  FAILED"; \
			echo "     $$out"; \
			exit 1; \
		fi; \
	done

create-user: ## Create a user (prompts for email and password)
	@read -p "Email: " email; read -s -p "Password: " pw; echo; \
	DATABASE_URL="$(DB_URL)" PYTHONPATH=.:app .venv/bin/python -m api.create_user "$$email" "$$pw"

shell: ## Open psql shell
	docker exec -it $(PG_CTR) psql -U $(PG_USER) -d $(PG_DB)

api: ## Start FastAPI backend (port 8000)
	PYTHONPATH=.:app .venv/bin/uvicorn api.main:app --reload --loop asyncio

dev: ## Start React frontend (port 5173)
	cd app/web && npm run dev

build-plano: ## Empaquetar floorToSvg para que el API dibuje los planos del prospecto
	cd app/web && npm run build:plano
	mkdir -p app/api/assets && cp app/web/dist-plano/plano.iife.js app/api/assets/plano.iife.js

test: ## Run Python test suite
	PYTHONPATH=.:app .venv/bin/pytest app/api/tests/ -v

test-all: ## Run all tests: pytest + vitest + playwright e2e (requires stack running)
	@echo "\n── pytest ──────────────────────────────────"
	PYTHONPATH=.:app .venv/bin/pytest app/api/tests/ -v
	@echo "\n── vitest ──────────────────────────────────"
	cd app/web && npm run test
	@echo "\n── playwright ──────────────────────────────"
	cd $(E2E_DIR) && npx playwright test

app: ## Start both API and frontend
	make -j2 api dev

E2E_DIR = app/e2e

e2e: ## Run Playwright e2e suite (requires: docker compose up or make app)
	cd $(E2E_DIR) && npx playwright test

e2e-ui: ## Run Playwright in interactive UI mode
	cd $(E2E_DIR) && npx playwright test --ui

e2e-headed: ## Run Playwright with visible browser window (like a human using the app)
	cd $(E2E_DIR) && npx playwright test --headed

e2e-report: ## Open last Playwright HTML report
	cd $(E2E_DIR) && npx playwright show-report

e2e-install: ## Install Playwright and Chromium (run once after cloning)
	cd $(E2E_DIR) && npm install && npx playwright install chromium

.DEFAULT_GOAL := help

help: ## List available targets
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  %-20s %s\n", $$1, $$2}'
