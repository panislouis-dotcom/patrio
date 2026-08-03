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

- **Metrics follow the stage.** The projection (`projectedRoi`, `projectedProfit`, `capRate`) is computed from `prospecto` through `en_renta` and survives the purchase on purpose — it is what reality gets measured against. What has actually been earned (`unrealizedGain`, `roi`) appears once the property is owned. The exit figures (`realizedGain`, `realizedRoi`) exist only after the sale, and freeze there.
- **Tools open when their stage does.** Investors from `oferta`, the profit waterfall and works tracking from `desarrollo`, the analyzer until `desarrollo`. Nothing is hidden on the way up: in later steps you can still read everything from before.
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
