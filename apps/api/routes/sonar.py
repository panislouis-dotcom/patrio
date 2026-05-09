from fastapi import APIRouter, Depends, HTTPException
from api.auth import get_current_user
from api.db import get_signals, create_signal, dismiss_signal, import_signal
from scraper import lamudi

router = APIRouter()

_SCRAPERS = [lamudi]


@router.post("/api/sonar/scan")
def sonar_scan(_: dict = Depends(get_current_user)):
    total_new = 0
    errors = []
    portals: list[dict] = []
    for scraper in _SCRAPERS:
        portal_new = 0
        try:
            signals = scraper.scrape(city="Monterrey")
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
        except Exception as e:
            errors.append({"portal": scraper.PORTAL_NAME, "error": str(e)})
    return {"scanned": len(_SCRAPERS), "new": total_new, "portals": portals, "errors": errors}


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
