DB_URL     ?= $(shell grep DATABASE_URL .env | cut -d= -f2-)
PG_CTR     ?= refigan-postgres
PG_USER    ?= postgres
PG_DB      ?= refigan
PSQL        = docker exec -i $(PG_CTR) psql -U $(PG_USER) -d $(PG_DB) --set=ON_ERROR_STOP=on

init-db: ## Apply schema to existing database
	$(PSQL) -f - < data/schema.sql

reset-db: ## Drop and recreate schema
	$(PSQL) -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
	$(PSQL) -f - < data/schema.sql

seed-db: ## Apply all seed_*.sql files
	@for f in $$(find data -name "seed_*.sql" | sort); do \
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
	DATABASE_URL="$(DB_URL)" PYTHONPATH=.:apps python -m api.create_user "$$email" "$$pw"

shell: ## Open psql shell
	docker exec -it $(PG_CTR) psql -U $(PG_USER) -d $(PG_DB)

api: ## Start FastAPI backend (port 8000)
	PYTHONPATH=.:apps uvicorn api.main:app --reload

dev: ## Start React frontend (port 5173)
	cd apps/web && npm run dev

test: ## Run Python test suite
	PYTHONPATH=.:apps pytest apps/api/tests/ -v

app: ## Start both API and frontend
	make -j2 api dev

.DEFAULT_GOAL := reset-db
