# Patrio · Real Estate Platform

Internal tool for managing real estate investment operations — from spotting a building to selling it and reporting to investors.

## Vision

Buy, develop, and exit high-quality real estate opportunities in Monterrey. Fund acquisitions through a private fixed-income vehicle that pays between CETES and consumer lending rates.

This repo is the operational backbone: a structured database, AI-powered document generation, and a phone-friendly internal web UI — all working together to run the firm without overhead.

## How It Works

```text
PostgreSQL  →  AI skills  →  Markdown  →  Documents / UI
```

## Key Features

### 1. Propiedades — one entity, one lifecycle

Every building the firm has looked at is a single record whose `status` says where in its life it is:

```text
prospecto → oferta → desarrollo → en_renta → vendida
                          └──────────────────────┘
```

plus `archivada`, the terminal drawer for the ones that were dropped.

There is no separate "prospect" and "project". There used to be, and they turned out to be the same building described twice — with the same fields drifting apart, photos and favourites lost at the hand-off, and `roi` meaning two different things depending on which table you read. They are now one row that keeps its history.

What changes as a property advances is not *what it is* but what is known about it and what may be done to it:

- **Only claims of ownership follow the stage.** The projection (`projectedRoi`, `projectedProfit`, `capRate`) and the cost breakdown are computed in every stage, including after the sale — a plan does not expire, it gets graded, and it is what reality gets measured against. What the property is *marked* at (`unrealizedGain`, `roi`) exists only while it is owned and unsold, `archivada` included: archiving files a property away, it does not sell it. The exit figures (`realizedGain`, `realizedRoi`) exist only after the sale, and freeze there. Everything else comes back `null` when its inputs are missing, never as a fabricated zero.
- **Every annualized return closes its clock on its own numerator.** The realized ROI runs to `saleDate`; the live one runs to `valuationDate`, not to today — otherwise the figure falls a little every month without a single input changing.
- **What the works will cost is the budget's sum, in every stage.** Always, with no second path: no target total, no line that absorbs the difference, no fallback for a property nobody has priced yet. A property is born with a work budget, and from that instant the sum of its lines *is* the construction cost that feeds `totalInvestment` — including when there are no lines and that sum is a real zero, which is a legitimate state («nothing has been costed yet») rather than a symptom. `m² × $/m² × overhead` runs **exactly once**, when the property is created, and lands as an ordinary line named after the arithmetic that produced it («Estimado inicial · 200 m² × $8,000/m²»); from that moment it is edited, renamed and deleted like any other, and nothing ever rewrites it. There is no write path from the property's metrics back into the budget — correcting the square metres afterwards moves the total by nothing, which is the whole point: a field labelled as a physical measurement used to reprice thirteen hand-quoted chapters. `constructionCostPerSqm` is therefore a captured assumption of yours again, shown next to the budget's own `budgetedCostPerSqm` (budget ÷ m²) — two independent numbers, neither one the other's fallback, which is the only arrangement in which comparing them says anything. What was signed with a supplier and what left the bank are tracked against that plan as figures of their own, and never redefine it.
- **Tools open when their stage does.** Investors from `oferta`, the profit waterfall and works tracking from `desarrollo`, the analyzer until `desarrollo`. Nothing is hidden on the way up: in later steps you can still read everything from before. The budget is not one of them — it travels with the property from `prospecto`, because the works have to be priceable before there is a bid.
- **The score only ranks candidates.** A 0–100 percentile over the pre-purchase cohort, computed on the server. A bought property competes with nobody, so it has none.
- **A stage is not a field.** `status` moves only through a gated transition that demands that stage's evidence (an acquisition date to enter development, a real rent to enter tenancy, a date and a price to be sold) and records who moved it and when.

### 2. Investor Prospectus

High-level pitch document generated from DB data, built from the **favorited** properties and partitioned by stage:

- Fund vision and core offering
- Track record — sold properties with their realised figures, then rented ones with their current mark
- Works in progress, and the opportunities still open to investment
- Photos, dates, key metrics only — no fluff

### 3. Investor Term Sheet

Detailed document for a named investor and amount: deal structure, compensation, projected returns, timeline. Raised against a property in `oferta` — a deal the firm is actually bidding on.

### 4. Operations UI

Phone-friendly web app, internal only. One PROPIEDADES table with stage filters and columns that adapt to them, plus the map, the sonar scraper and the comparables database alongside. Manage properties, advance their stage, trigger document generation.

## Stack

- **Data**: PostgreSQL on CNPG (Kubernetes); local dev via docker-compose
- **Documents**: Claude Code AI skills → Markdown
- **API**: FastAPI (Python)
- **UI**: React + Vite, phone-friendly, internal only
- **Infra**: K8s on Hetzner, ArgoCD, CNPG, S3 backups
