DB  = data/refigan.db
SQL = data

reset: ## Nuke and rebuild DB from scratch
	rm -f $(DB)
	sqlite3 $(DB) < $(SQL)/schema.sql
	@for f in $$(find $(SQL) -name "seed_*.sql" | sort); do \
		printf "  ▸ %-60s" "$$f"; \
		if out=$$(sqlite3 $(DB) < "$$f" 2>&1); then \
			echo "✓"; \
		else \
			echo "✗  FAILED"; \
			echo "     $$out"; \
			exit 1; \
		fi; \
	done

seed: ## Apply all seed files (additive, no drop)
	@for f in $$(find $(SQL) -name "seed_*.sql" | sort); do \
		printf "  ▸ %-60s" "$$f"; \
		if out=$$(sqlite3 $(DB) < "$$f" 2>&1); then \
			echo "✓"; \
		else \
			echo "✗  FAILED"; \
			echo "     $$out"; \
			exit 1; \
		fi; \
	done

shell: ## Open interactive SQLite shell
	sqlite3 $(DB)

show: ## Quick dump of all projects
	sqlite3 -column -header $(DB) "SELECT id, name, status, total_investment, current_valuation FROM projects;"

prospectus-data: ## Dump raw data used by the prospectus skill
	@echo "=== PROJECTS ==="
	@sqlite3 -column -header $(DB) "SELECT name, total_investment, current_valuation, valuation_date, total_units, acquisition_date FROM projects WHERE status IN ('operating','exited');"
	@echo ""
	@echo "=== PROSPECTS ==="
	@sqlite3 -column -header $(DB) "SELECT name, total_investment, projected_sale, profit, roi, cap_rate, rent_monthly, hold_months FROM prospect_metrics WHERE status='evaluating';"

api: ## Start FastAPI backend (port 8000)
	PYTHONPATH=. uvicorn api.main:app --reload

dev: ## Start React frontend (port 5173)
	cd frontend && npm run dev

app: ## Start both API and frontend
	PYTHONPATH=. uvicorn api.main:app --reload &
	cd frontend && npm run dev

.DEFAULT_GOAL := reset
