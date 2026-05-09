from concurrent.futures import ThreadPoolExecutor, as_completed
from fastapi import APIRouter, Depends, HTTPException
from api.auth import get_current_user
from api.db import get_signals, create_signal, dismiss_signal, import_signal
from scraper import lamudi, mitula, icasas, doorvel, realtorcom, inmuebles24, mercadolibre, vivanuncios

router = APIRouter()

# Static scrapers (httpx): fast, no browser overhead
_STATIC_SCRAPERS = [lamudi, mitula, icasas, doorvel, realtorcom]
# Playwright scrapers: launch real Chromium, run in parallel threads
_PW_SCRAPERS = [inmuebles24, mercadolibre, vivanuncios]
_ALL_SCRAPERS = _STATIC_SCRAPERS + _PW_SCRAPERS


def _run_scraper(scraper) -> tuple:
    """Run one scraper and return (scraper, signals, error_str)."""
    try:
        signals = scraper.scrape(city="Monterrey")
        return (scraper, signals, None)
    except Exception as e:
        return (scraper, [], str(e))


@router.post("/api/sonar/scan")
def sonar_scan(_: dict = Depends(get_current_user)):
    total_new = 0
    errors = []
    portals: list[dict] = []

    # Run static scrapers inline, PW scrapers in parallel threads
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
        for s in signals:
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
                portal_new += 1
                total_new += 1
        portals.append({"portal": scraper.PORTAL_NAME, "fetched": len(signals), "new": portal_new})

    return {"scanned": len(_ALL_SCRAPERS), "new": total_new, "portals": portals, "errors": errors}


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
