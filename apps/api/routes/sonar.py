import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from api.auth import get_current_user
from api.db import get_signals, create_signal, dismiss_signal, import_signal, update_signal_sqm, get_signals_missing_sqm
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
        s.sqm_land = 0  # clear bogus sqm — will be re-enriched from detail page
    return s


def _run_scraper(scraper) -> tuple:
    """Run one scraper and return (scraper, signals, error_str)."""
    try:
        signals = scraper.scrape(city="Monterrey")
        return (scraper, signals, None)
    except Exception as e:
        return (scraper, [], str(e))


def _enrich_batch(rows: list[dict]) -> int:
    """Fetch sqm for a list of {id, url, portal} rows. Returns count updated."""
    updated = 0
    for row in rows:
        mod = _ENRICHABLE.get(row["portal"])
        if not mod:
            continue
        sqm = mod.fetch_sqm(row["url"])
        if sqm > 0:
            update_signal_sqm(row["url"], sqm)
            updated += 1
    return updated


def _process_signals(signals: list, to_enrich: list) -> tuple[int, int]:
    """Validate, insert signals into DB. Returns (new_count, skipped_count)."""
    new = skipped = 0
    for raw in signals:
        s = _sanitize(raw)
        if s is None:
            skipped += 1
            continue
        inserted = create_signal({
            "portal": s.portal,
            "url": s.url,
            "title": s.title,
            "address": s.address,
            "city": s.city,
            "price": s.price,
            "sqm_land": s.sqm_land,
        })
        if inserted:
            new += 1
            if s.sqm_land == 0 and s.portal in _ENRICHABLE:
                to_enrich.append({"url": s.url, "portal": s.portal})
    return new, skipped


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


def _run_combined_stream():
    """Generator: runs scan + enrich and yields SSE events throughout."""
    portal_names = [s.PORTAL_NAME for s in _ALL_SCRAPERS]
    yield _sse({"type": "start", "portals": portal_names, "total": len(_ALL_SCRAPERS)})

    to_enrich: list[dict] = []
    total_new = total_skipped = 0

    # Static scrapers run sequentially — one active at a time
    for scraper in _STATIC_SCRAPERS:
        yield _sse({"type": "portal_start", "portal": scraper.PORTAL_NAME})
        _, signals, err = _run_scraper(scraper)
        if err:
            yield _sse({"type": "portal_error", "portal": scraper.PORTAL_NAME, "error": err})
            continue
        new, skipped = _process_signals(signals, to_enrich)
        total_new += new
        total_skipped += skipped
        yield _sse({"type": "portal_done", "portal": scraper.PORTAL_NAME,
                    "fetched": len(signals), "new": new, "skipped": skipped})

    # PW scrapers run in parallel — all start simultaneously
    for scraper in _PW_SCRAPERS:
        yield _sse({"type": "portal_start", "portal": scraper.PORTAL_NAME})
    with ThreadPoolExecutor(max_workers=len(_PW_SCRAPERS)) as pool:
        futures = {pool.submit(_run_scraper, s): s for s in _PW_SCRAPERS}
        for fut in as_completed(futures):
            scraper, signals, err = fut.result()
            if err:
                yield _sse({"type": "portal_error", "portal": scraper.PORTAL_NAME, "error": err})
                continue
            new, skipped = _process_signals(signals, to_enrich)
            total_new += new
            total_skipped += skipped
            yield _sse({"type": "portal_done", "portal": scraper.PORTAL_NAME,
                        "fetched": len(signals), "new": new, "skipped": skipped})

    # Enrichment phase
    yield _sse({"type": "enriching", "count": len(to_enrich)})
    enriched = 0
    if to_enrich:
        with ThreadPoolExecutor(max_workers=3) as pool:
            futs = [pool.submit(_enrich_batch, [r]) for r in to_enrich]
            for f in as_completed(futs):
                enriched += f.result()

    yield _sse({"type": "complete", "new": total_new, "skipped": total_skipped, "enriched": enriched})


@router.post("/api/sonar/run")
def sonar_run(_: dict = Depends(get_current_user)):
    return StreamingResponse(
        _run_combined_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/api/sonar/scan")
def sonar_scan(_: dict = Depends(get_current_user)):
    total_new = 0
    errors = []
    portals: list[dict] = []
    to_enrich: list[dict] = []
    total_skipped = 0

    results = []
    for s in _STATIC_SCRAPERS:
        results.append(_run_scraper(s))

    with ThreadPoolExecutor(max_workers=len(_PW_SCRAPERS)) as pool:
        futures = {pool.submit(_run_scraper, s): s for s in _PW_SCRAPERS}
        for fut in as_completed(futures):
            results.append(fut.result())

    for scraper, signals, err in results:
        if err:
            errors.append({"portal": scraper.PORTAL_NAME, "error": err})
            continue
        portal_new = 0
        portal_skipped = 0
        new, skipped = _process_signals(signals, to_enrich)
        portal_new += new
        portal_skipped += skipped
        total_new += new
        total_skipped += skipped
        portals.append({"portal": scraper.PORTAL_NAME, "fetched": len(signals),
                        "new": portal_new, "skipped": portal_skipped})

    enriched = 0
    if to_enrich:
        with ThreadPoolExecutor(max_workers=3) as pool:
            futs = [pool.submit(_enrich_batch, [r]) for r in to_enrich]
            for f in as_completed(futs):
                enriched += f.result()

    return {"scanned": len(_ALL_SCRAPERS), "new": total_new, "skipped": total_skipped,
            "enriched": enriched, "portals": portals, "errors": errors}


@router.post("/api/sonar/enrich")
def sonar_enrich(_: dict = Depends(get_current_user)):
    """Backfill sqm_land for all existing signals that are missing it."""
    rows = get_signals_missing_sqm(list(_ENRICHABLE.keys()))
    if not rows:
        return {"checked": 0, "updated": 0}

    with ThreadPoolExecutor(max_workers=3) as pool:
        futs = [pool.submit(_enrich_batch, [r]) for r in rows]
        total_updated = sum(f.result() for f in as_completed(futs))

    return {"checked": len(rows), "updated": total_updated}


@router.get("/api/sonar/signals")
def list_signals(status: str | None = None, portal: str | None = None, _: dict = Depends(get_current_user)):
    return get_signals(status=status, portal=portal)


@router.patch("/api/sonar/signals/{signal_id}")
def patch_signal(signal_id: int, _: dict = Depends(get_current_user)):
    updated = dismiss_signal(signal_id)
    if updated is None:
        raise HTTPException(status_code=404, detail="Signal not found")
    return updated


@router.post("/api/sonar/signals/{signal_id}/import", status_code=201)
def import_signal_route(signal_id: int, _: dict = Depends(get_current_user)):
    signal, prospect = import_signal(signal_id)
    if signal is None:
        raise HTTPException(status_code=404, detail="Signal not found")
    return {"signal": signal, "prospect": prospect}
