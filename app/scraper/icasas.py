import re
import httpx
from bs4 import BeautifulSoup
from .base import SignalRaw, BROWSER_HEADERS, rate_limit, parse_sqm
from .zones import cve_to_slug, state_to_slug

PORTAL_NAME = "icasas"
BASE_URL = "https://www.icasas.mx"
_MAX_PAGES = 12

# icasas municipio IDs for NL — used in URL pattern below
# URL format (verified 2025-05): /venta/tierras-lotes-terrenos-{state_slug}-{city_slug}-5_9_{state_id}_0_{mun_id}_0
# state_id = first 2 digits of INEGI CVE (19 = Nuevo León)
_MUN_IDS: dict[str, str] = {
    "19039": "983",   # Monterrey
    "19019": "990",   # San Pedro Garza García
    "19046": "991",   # Santa Catarina
    "19021": "960",   # García
}


def zone_url(cve: str) -> str | None:
    mid = _MUN_IDS.get(cve)
    if not mid:
        return None
    state_id   = cve[:2]           # "19" from CVE like "19039"
    state_slug = state_to_slug(cve)
    city_slug  = cve_to_slug(cve)
    return f"{BASE_URL}/venta/tierras-lotes-terrenos-{state_slug}-{city_slug}-5_9_{state_id}_0_{mid}_0"


def _page_url(base: str, page: int) -> str:
    return base if page == 1 else f"{base}/p_{page}"


def _parse_price(text: str) -> float:
    # "2,400,000 MX$" or "9,750,000 MX$destacado"
    digits = re.sub(r"[^\d.]", "", text.replace(",", ""))
    try:
        return float(digits)
    except ValueError:
        return 0.0


def _scrape_zone(search_base: str, seen: set[str]) -> list[SignalRaw]:
    signals: list[SignalRaw] = []
    for page in range(1, _MAX_PAGES + 1):
        try:
            rate_limit(1.2)
            r = httpx.get(_page_url(search_base, page), headers=BROWSER_HEADERS,
                          follow_redirects=True, timeout=20)
            if r.status_code != 200:
                break
            soup = BeautifulSoup(r.text, "lxml")
            cards = soup.select("li.serp-snippet.ad")
            if not cards:
                break

            new_on_page = 0
            for card in cards:
                try:
                    link_el = card.select_one("a.detail-redirection")
                    if not link_el:
                        continue
                    href = BASE_URL + link_el["href"]
                    if href in seen:
                        continue

                    title = link_el.get_text(strip=True)[:200]
                    price_el = card.select_one("div.price")
                    price_text = price_el.get_text(strip=True) if price_el else ""
                    addr_el = card.select_one('meta[itemprop="addressLocality"]')
                    address = addr_el.get("content", "") if addr_el else ""
                    desc_el = card.select_one("p.description")
                    desc_text = desc_el.get_text(strip=True) if desc_el else ""
                    sqm = parse_sqm(title) or parse_sqm(desc_text)

                    seen.add(href)
                    signals.append(SignalRaw(
                        portal=PORTAL_NAME,
                        url=href,
                        title=title,
                        address=address,
                        price=_parse_price(price_text),
                        sqm_land=sqm,
                    ))
                    new_on_page += 1
                except Exception:
                    continue

            if new_on_page == 0:
                break
        except Exception:
            break
    return signals


def scrape(cves: list[str] | None = None) -> list[SignalRaw]:
    # When no CVEs given, iterate all known zones (NL-wide URL is JS-rendered, won't work with httpx)
    target_cves = cves if cves else list(_MUN_IDS.keys())
    targets = [(cve, zone_url(cve)) for cve in target_cves]
    all_signals: list[SignalRaw] = []
    seen: set[str] = set()
    for cve, url in targets:
        if url is None:
            continue
        new = _scrape_zone(url, seen)
        if cve:
            for s in new:
                s.municipio_cve = cve
        all_signals.extend(new)
    return all_signals


def fetch_sqm(url: str) -> float:
    """Visit the listing detail page and extract land area from page text."""
    try:
        r = httpx.get(url, headers=BROWSER_HEADERS, follow_redirects=True, timeout=15)
        if r.status_code != 200:
            return 0.0
        soup = BeautifulSoup(r.text, "lxml")
        # Try structured feature list first, then full page text
        for el in soup.find_all(string=re.compile(r"\d+\s*m[²2]", re.IGNORECASE)):
            sqm = parse_sqm(str(el))
            if sqm > 0:
                return sqm
        return 0.0
    except Exception:
        return 0.0
