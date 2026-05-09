import re
import httpx
from bs4 import BeautifulSoup
from .base import SignalRaw, BROWSER_HEADERS, rate_limit, parse_sqm

PORTAL_NAME = "icasas"
BASE_URL = "https://www.icasas.mx"
_NL_SEARCH_URL = f"{BASE_URL}/venta/tierras-lotes-terrenos-nuevo-leon-5_9_0_0_19_0"
_MAX_PAGES = 12


def _search_url(zone_slug: str | None) -> str:
    if zone_slug:
        return f"{BASE_URL}/venta/tierras-lotes-terrenos-{zone_slug}_9_0_0_19_0"
    return _NL_SEARCH_URL


def _page_url(base: str, page: int) -> str:
    return base if page == 1 else f"{base}/p_{page}"


def _parse_price(text: str) -> float:
    # "2,400,000 MX$" or "9,750,000 MX$destacado"
    digits = re.sub(r"[^\d.]", "", text.replace(",", ""))
    try:
        return float(digits)
    except ValueError:
        return 0.0


def _scrape_zone(search_base: str, city: str, seen: set[str]) -> list[SignalRaw]:
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
                        city=city,
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


def scrape(city: str = "Monterrey", zones: list[str] | None = None) -> list[SignalRaw]:
    from .zones import ZONE_DEFS
    zone_list = [(z, ZONE_DEFS[z]["icasas"]) for z in zones if z in ZONE_DEFS] if zones else [(None, None)]
    all_signals: list[SignalRaw] = []
    seen: set[str] = set()
    for zone_name, zone_slug in zone_list:
        new = _scrape_zone(_search_url(zone_slug), city, seen)
        if zone_name:
            for s in new:
                s.zone = zone_name
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
