import re
import httpx
from bs4 import BeautifulSoup
from .base import SignalRaw, BROWSER_HEADERS, rate_limit, parse_sqm

PORTAL_NAME = "lamudi"
BASE_URL = "https://www.lamudi.com.mx"
SEARCH_URL = f"{BASE_URL}/nuevo-leon/terreno/for-sale/"
_MAX_PAGES = 10


def _scrape_page(url: str, city: str) -> list[SignalRaw]:
    r = httpx.get(url, headers=BROWSER_HEADERS, timeout=20, follow_redirects=True)
    if r.status_code != 200:
        return []
    soup = BeautifulSoup(r.text, "lxml")
    signals = []
    for card in soup.select("div.snippet.js-snippet"):
        try:
            link_el = card.select_one("a[href]")
            title_el = card.select_one("h3") or card.select_one("h2") or card.select_one("[class*=title]")
            price_el = card.select_one(".snippet__content__price")
            location_el = card.select_one("[class*=location]") or card.select_one("[class*=address]")

            if not link_el or not title_el:
                continue

            href = link_el["href"]
            if not href.startswith("http"):
                href = BASE_URL + href
            title = title_el.get_text(strip=True)
            price = _parse_price(price_el.get_text(strip=True) if price_el else "")
            address = location_el.get_text(strip=True) if location_el else ""
            area_el = card.select_one("span.property__number.area")
            sqm = parse_sqm(area_el.get_text(strip=True)) if area_el else 0.0

            signals.append(SignalRaw(
                portal=PORTAL_NAME,
                url=href,
                title=title,
                address=address,
                city=city,
                price=price,
                sqm_land=sqm,
            ))
        except Exception:
            continue
    return signals


def scrape(city: str = "Monterrey") -> list[SignalRaw]:
    try:
        signals: list[SignalRaw] = []
        seen_urls: set[str] = set()
        for page in range(1, _MAX_PAGES + 1):
            rate_limit(1.0)
            url = SEARCH_URL if page == 1 else f"{SEARCH_URL}?page={page}"
            page_signals = _scrape_page(url, city)
            if not page_signals:
                break
            new = [s for s in page_signals if s.url not in seen_urls]
            if not new:
                break
            seen_urls.update(s.url for s in new)
            signals.extend(new)
        return signals
    except Exception:
        return []


def _parse_price(text: str) -> float:
    digits = re.sub(r"[^\d.]", "", text.replace(",", ""))
    try:
        return float(digits)
    except ValueError:
        return 0.0


def fetch_sqm(url: str) -> float:
    """Visit the listing detail page and extract land area from page text."""
    try:
        r = httpx.get(url, headers=BROWSER_HEADERS, follow_redirects=True, timeout=15)
        if r.status_code != 200:
            return 0.0
        m = re.search(r"([\d,]+(?:\.\d+)?)\s+m[²2]", r.text, re.IGNORECASE)
        return parse_sqm(m.group(0)) if m else 0.0
    except Exception:
        return 0.0
