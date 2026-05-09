import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from api.auth import get_current_user
from api.db import create_prospect
from scraper import lamudi, mitula, icasas, doorvel, inmuebles24, mercadolibre, vivanuncios
from scraper.base import SignalRaw

router = APIRouter()

# Static scrapers (httpx): fast, no browser overhead
_STATIC_SCRAPERS = [lamudi, mitula, icasas, doorvel]
# Playwright scrapers: launch real Chromium, run in parallel threads
_PW_SCRAPERS = [inmuebles24, mercadolibre, vivanuncios]
_ALL_SCRAPERS = _STATIC_SCRAPERS + _PW_SCRAPERS

# Portals that expose sqm on their detail page (have fetch_sqm())
_ENRICHABLE = {m.PORTAL_NAME: m for m in [lamudi, mitula, icasas, doorvel] if hasattr(m, "fetch_sqm")}

# Validation thresholds for terrenos in Monterrey area (MXN)
_MIN_PRICE = 100_000   # below this is almost certainly a unit price or data error
_MIN_SQM   = 50        # below this is almost certainly a parse error (not a real lot)


def _sanitize(s: SignalRaw) -> SignalRaw | None:
    """Return None to discard, or the signal (possibly with sqm cleared) to keep."""
    if 0 < s.price < _MIN_PRICE:
        return None
    if 0 < s.sqm_land < _MIN_SQM:
        s.sqm_land = 0
    return s


def _run_scraper(scraper) -> tuple:
    try:
        signals = scraper.scrape(city="Monterrey")
        return (scraper, signals, None)
    except Exception as e:
        return (scraper, [], str(e))


def _enrich_signal(signal: SignalRaw) -> None:
    """Fetch sqm from detail page and update signal in place."""
    mod = _ENRICHABLE.get(signal.portal)
    if not mod or signal.sqm_land > 0:
        return
    sqm = mod.fetch_sqm(signal.url)
    if sqm >= _MIN_SQM:
        signal.sqm_land = sqm


def _signal_to_dict(s: SignalRaw) -> dict:
    return {
        "url":      s.url,
        "portal":   s.portal,
        "title":    s.title,
        "address":  s.address,
        "city":     s.city,
        "price":    s.price,
        "sqmLand":  s.sqm_land,
    }


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


def _run_combined_stream():
    """Generator: runs scan + in-memory enrich and yields SSE events."""
    portal_names = [s.PORTAL_NAME for s in _ALL_SCRAPERS]
    yield _sse({"type": "start", "portals": portal_names, "total": len(_ALL_SCRAPERS)})

    all_signals: list[SignalRaw] = []
    total_skipped = 0

    # Static scrapers — sequential
    for scraper in _STATIC_SCRAPERS:
        yield _sse({"type": "portal_start", "portal": scraper.PORTAL_NAME})
        _, raw_signals, err = _run_scraper(scraper)
        if err:
            yield _sse({"type": "portal_error", "portal": scraper.PORTAL_NAME, "error": err})
            continue
        skipped = 0
        valid: list[SignalRaw] = []
        for s in raw_signals:
            s = _sanitize(s)
            if s is None:
                skipped += 1
            else:
                valid.append(s)
        all_signals.extend(valid)
        total_skipped += skipped
        yield _sse({"type": "portal_done", "portal": scraper.PORTAL_NAME,
                    "fetched": len(raw_signals), "skipped": skipped})

    # PW scrapers — all start simultaneously
    for scraper in _PW_SCRAPERS:
        yield _sse({"type": "portal_start", "portal": scraper.PORTAL_NAME})
    with ThreadPoolExecutor(max_workers=len(_PW_SCRAPERS)) as pool:
        futures = {pool.submit(_run_scraper, s): s for s in _PW_SCRAPERS}
        for fut in as_completed(futures):
            scraper, raw_signals, err = fut.result()
            if err:
                yield _sse({"type": "portal_error", "portal": scraper.PORTAL_NAME, "error": err})
                continue
            skipped = 0
            valid = []
            for s in raw_signals:
                s = _sanitize(s)
                if s is None:
                    skipped += 1
                else:
                    valid.append(s)
            all_signals.extend(valid)
            total_skipped += skipped
            yield _sse({"type": "portal_done", "portal": scraper.PORTAL_NAME,
                        "fetched": len(raw_signals), "skipped": skipped})

    # Enrich signals missing sqm — in memory, parallel
    needs_enrich = [s for s in all_signals if s.sqm_land == 0 and s.portal in _ENRICHABLE]
    yield _sse({"type": "enriching", "total": len(needs_enrich)})
    enriched = 0
    if needs_enrich:
        with ThreadPoolExecutor(max_workers=3) as pool:
            futs = [pool.submit(_enrich_signal, s) for s in needs_enrich]
            done = 0
            for f in as_completed(futs):
                f.result()
                done += 1
                if done % 5 == 0 or done == len(needs_enrich):
                    yield _sse({"type": "enrich_progress", "total": len(needs_enrich), "done": done})
        enriched = sum(1 for s in needs_enrich if s.sqm_land > 0)

    yield _sse({
        "type":    "complete",
        "found":   len(all_signals),
        "skipped": total_skipped,
        "enriched": enriched,
        "signals": [_signal_to_dict(s) for s in all_signals],
    })


@router.post("/api/sonar/run")
def sonar_run(_: dict = Depends(get_current_user)):
    return StreamingResponse(
        _run_combined_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class _ImportRequest(BaseModel):
    url: str
    title: str
    address: str = ""
    city: str = "Monterrey"
    price: float = 0.0
    sqmLand: float = 0.0
    portal: str = ""


@router.post("/api/sonar/import", status_code=201)
def sonar_import(req: _ImportRequest, _: dict = Depends(get_current_user)):
    prospect = create_prospect({
        "name":                   req.title,
        "address":                req.address or req.title,
        "city":                   req.city,
        "status":                 "evaluating",
        "url":                    req.url,
        "latitude":               0.0,
        "longitude":              0.0,
        "sqmLand":                req.sqmLand,
        "sqmConstruction":        0.0,
        "landPrice":              req.price,
        "acquisitionCostPct":     0.065,
        "permitsCost":            0.0,
        "subdivisionCost":        0.0,
        "constructionCostPerSqm": 0.0,
        "constructionOverhead":   1.3,
        "projectedSale":          0.0,
        "holdMonths":             12,
        "rentMonthly":            0,
        "notes":                  "-",
    })
    return {"prospect": prospect}
