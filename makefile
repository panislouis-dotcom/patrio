DB  = data/real_estate.db
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

.DEFAULT_GOAL := reset
