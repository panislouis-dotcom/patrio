# Patrio · Real Estate Platform

Internal tool for managing real estate investment operations — from sourcing prospects to closing deals and reporting to investors.

## Vision

Buy, develop, and exit high-quality real estate opportunities in Monterrey. Fund acquisitions through a private fixed-income vehicle that pays between CETES and consumer lending rates.

This repo is the operational backbone: a structured database, AI-powered document generation, and a phone-friendly internal web UI — all working together to run the firm without overhead.

## How It Works

```text
SQLite DB  →  AI skills  →  Markdown  →  Documents / UI
```

## Key Features

### 1. Prospect Pipeline

Track opportunities before commitment: location, size, projected financials, deal metrics (ROI, cap rate, IRR). All metrics auto-computed from raw inputs.

### 2. Project Tracking

Full lifecycle records for committed deals: budget breakdown, milestones, valuations, operational performance.

### 3. Investor Prospectus — build first

High-level pitch document generated from DB data:

- Fund vision and core offering
- Track record with key numbers (past projects)
- Active opportunity with prospect financials
- Photos, dates, key metrics only — no fluff

### 4. Investor Term Sheet

Detailed document: deal structure, compensation, projected returns, timeline.

### 5. Operations UI

Phone-friendly web app, internal only. Manage prospects, update project data, trigger document generation.

## Phases

| Phase | Focus |
| --- | --- |
| 1 · Now | Data model — schema, seed real data, queries |
| 2 · Next | Investor prospectus — AI skill generates from DB |
| 3 | Term sheet generation |
| 4 | Operations web UI |
| 5 | Clients web UI | 

Can see open investments. In the future other funds can add investments. Website becomes private development marketplace.

## Stack

- **Data**: SQLite (`data/refigan.db`)
- **Documents**: Claude Code AI skills → Markdown
- **UI**: Web app, phone-friendly, internal only
