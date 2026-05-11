import json
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from api.auth import get_current_user
from api.db import create_prospect
from api import sonar_db, geo
from scraper import lamudi, icasas, doorvel, inmuebles24, mercadolibre, vivanuncios
from scraper.base import SignalRaw
from scraper.zones import detect_cve, cve_to_name, resolve_cve_from_nominatim, ACTIVE_CVES, MUNICIPIOS

router = APIRouter()

# Static scrapers (httpx): fast, no browser overhead
_STATIC_SCRAPERS = [lamudi, icasas, doorvel]
# Playwright scrapers: launch real Chromium, run in parallel threads
_PW_SCRAPERS = [inmuebles24, mercadolibre, vivanuncios]
_ALL_SCRAPERS = _STATIC_SCRAPERS + _PW_SCRAPERS

# Portals that expose sqm on their detail page (have fetch_sqm())
_ENRICHABLE = {m.PORTAL_NAME: m for m in [lamudi, icasas, doorvel] if hasattr(m, "fetch_sqm")}

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


def _run_scraper(scraper, cves: list[str] | None) -> tuple:
    try:
        signals = scraper.scrape(cves=cves)
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


def _geocode_one(sig_id: int, address: str, state_hint: str = "") -> None:
    """Geocode a single signal and update its geo fields in DB.
    If state_hint is given and geocoded state doesn't match, the signal is deleted."""
    result = geo.geocode(address, state_hint=state_hint)
    if not result:
        return
    lat, lon, colonia, state_name, mun_name = result
    if state_hint and state_name and state_name != state_hint:
        sonar_db.delete_signal(sig_id)
        return
    mun_cve = resolve_cve_from_nominatim(state_name, mun_name)
    sonar_db.update_signal_geo(
        sig_id, lat, lon, colonia,
        state_name=state_name,
        municipio_name=mun_name,
        municipio_cve=mun_cve,
    )


def _geocode_batch(items: list[tuple[int, SignalRaw]]) -> None:
    """Background task: geocode signals, update municipio + colonia from Nominatim."""
    for sig_id, s in items:
        try:
            state_hint = MUNICIPIOS.get(s.municipio_cve, {}).get("state", "")
            _geocode_one(sig_id, s.address, state_hint=state_hint)
        except Exception:
            pass


def _regeocode_all() -> None:
    """Background task: re-geocode all signals to correct stale municipio assignments."""
    rows = sonar_db.get_all_signals()
    for row in rows:
        try:
            state_hint = MUNICIPIOS.get(row.get("municipio_cve", ""), {}).get("state", "")
            _geocode_one(row["id"], row["address"], state_hint=state_hint)
        except Exception:
            pass


def _signal_to_dict(s: SignalRaw) -> dict:
    return {
        "url":           s.url,
        "portal":        s.portal,
        "title":         s.title,
        "address":       s.address,
        "municipioCve":  s.municipio_cve,
        "municipioName": cve_to_name(s.municipio_cve) if s.municipio_cve else "",
        "colonia":       "",           # filled in later by geocoding
        "stateName":     "",           # filled in later by geocoding
        "lat":           s.lat,
        "lon":           s.lon,
        "price":         s.price,
        "sqmLand":       s.sqm_land,
        "lastPrice":     None,         # will come from DB on subsequent scans
        "firstSeen":     None,
        "lastSeen":      None,
    }


def _db_row_to_dict(row: dict) -> dict:
    return {
        "url":           row["url"],
        "portal":        row["portal"],
        "title":         row["title"],
        "address":       row["address"],
        "municipioCve":  row["municipio_cve"],
        "municipioName": row["municipio_name"],
        "colonia":       row["colonia"],
        "stateName":     row.get("state_name", ""),
        "lat":           row["lat"],
        "lon":           row["lon"],
        "price":         float(row["price"]),
        "sqmLand":       float(row["sqm_land"]),
        "lastPrice":     float(row["last_price"]) if row["last_price"] is not None else None,
        "firstSeen":     row["first_seen_at"].isoformat() if row["first_seen_at"] else None,
        "lastSeen":      row["last_seen_at"].isoformat() if row["last_seen_at"] else None,
    }


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


def _run_combined_stream(scan_id: int, cves: list[str] | None):
    """Generator: runs scan + in-memory enrich and yields SSE events."""
    portal_names = [s.PORTAL_NAME for s in _ALL_SCRAPERS]
    yield _sse({"type": "start", "portals": portal_names, "total": len(_ALL_SCRAPERS), "cves": cves or []})

    all_signals: list[SignalRaw] = []
    total_skipped = 0

    # Static scrapers — sequential
    for scraper in _STATIC_SCRAPERS:
        yield _sse({"type": "portal_start", "portal": scraper.PORTAL_NAME})
        _, raw_signals, err = _run_scraper(scraper, cves)
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
        futures = {pool.submit(_run_scraper, s, cves): s for s in _PW_SCRAPERS}
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

    # Keyword-based CVE fallback for signals that scrapers couldn't tag (e.g. vivanuncios)
    for s in all_signals:
        if not s.municipio_cve:
            s.municipio_cve = detect_cve(s.address)

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

    # Persist signals to DB
    scan_rows: list[tuple[int, float]] = []
    geo_items: list[tuple[int, SignalRaw]] = []
    for s in all_signals:
        try:
            sig_id = sonar_db.upsert_signal(
                url=s.url, portal=s.portal, title=s.title, address=s.address,
                municipio_cve=s.municipio_cve,
                municipio_name=cve_to_name(s.municipio_cve) if s.municipio_cve else "",
                price=s.price, sqm_land=s.sqm_land, lat=s.lat, lon=s.lon,
            )
            scan_rows.append((sig_id, s.price))
            if s.address:
                geo_items.append((sig_id, s))
        except Exception:
            pass
    sonar_db.link_signals_to_scan(scan_id, scan_rows)
    sonar_db.complete_scan(scan_id, found=len(all_signals), skipped=total_skipped, enriched=enriched)

    # Fire background geocoding thread (non-blocking — runs after SSE stream closes)
    if geo_items:
        threading.Thread(target=_geocode_batch, args=(geo_items,), daemon=True).start()

    yield _sse({
        "type":    "complete",
        "found":   len(all_signals),
        "skipped": total_skipped,
        "enriched": enriched,
        "signals": [_signal_to_dict(s) for s in all_signals],
    })


class _RunRequest(BaseModel):
    cves: list[str] = []    # INEGI CVEs; empty = NL-wide


@router.post("/api/sonar/run")
def sonar_run(req: _RunRequest, _: dict = Depends(get_current_user)):
    cves = req.cves or None
    scan_id = sonar_db.create_scan(cves)
    return StreamingResponse(
        _run_combined_stream(scan_id, cves),
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


@router.get("/api/sonar/zones")
def sonar_zones(_: dict = Depends(get_current_user)):
    """Return active municipios grouped by state, derived from ACTIVE_CVES."""
    grouped: dict[str, list[dict]] = {}
    for cve in ACTIVE_CVES:
        info = MUNICIPIOS[cve]
        state = info["state"]
        grouped.setdefault(state, []).append({"cve": cve, "name": info["name"]})
    return {"states": [{"name": s, "municipios": m} for s, m in grouped.items()]}


@router.get("/api/sonar/signals")
def sonar_signals(_: dict = Depends(get_current_user)):
    rows = sonar_db.get_latest_scan_signals()
    return {"signals": [_db_row_to_dict(r) for r in rows]}


@router.get("/api/sonar/zone-medians")
def sonar_zone_medians(_: dict = Depends(get_current_user)):
    return {"medians": sonar_db.get_zone_medians()}


@router.post("/api/sonar/re-geocode")
def sonar_re_geocode(_: dict = Depends(get_current_user)):
    """Re-geocode all signals to correct stale municipio/colonia assignments.
    Runs in background at 1 req/sec (Nominatim rate limit).
    Returns immediately with the number of signals queued."""
    rows = sonar_db.get_all_signals()
    threading.Thread(target=_regeocode_all, daemon=True).start()
    return {"queued": len(rows)}
