import re
import httpx
from bs4 import BeautifulSoup
from .base import SignalRaw, BROWSER_HEADERS, rate_limit, parse_sqm

PORTAL_NAME = "doorvel"
BASE_URL = "https://www.doorvel.com"
_SEARCH_BASE = f"{BASE_URL}/home/terrenos-en-venta-en-monterrey-nuevo-leon-mexico"
_MAX_PAGES = 4


def _page_url(n: int) -> str:
    return _SEARCH_BASE if n == 1 else f"{_SEARCH_BASE}?page={n}"


def _parse_price(text: str) -> float:
    # "$7,950,000MXN" → 7950000.0
    digits = re.sub(r"[^\d.]", "", text.replace(",", ""))
    try:
        return float(digits)
    except ValueError:
        return 0.0


def _scrape_page(soup, city: str, seen: set) -> list[SignalRaw]:
    signals = []
    for card in soup.select('[data-testid="property-card"]'):
        try:
            a_parent = card.find_parent("a", href=re.compile(r"/propiedades/"))
            if not a_parent:
                continue
            href = BASE_URL + a_parent["href"]
            if href in seen:
                continue

            title_el = card.find("h2")
            addr_el = card.find("h3")
            price_el = next(
                (s for s in card.find_all("span")
                 if re.search(r"\$[\d,]{3}", s.get_text(strip=True))),
                None,
            )

            title = title_el.get_text(strip=True)[:200] if title_el else ""
            address = addr_el.get_text(strip=True) if addr_el else ""
            price_text = price_el.get_text(strip=True) if price_el else ""

            if not title:
                continue

            seen.add(href)
            signals.append(SignalRaw(
                portal=PORTAL_NAME,
                url=href,
                title=title,
                address=address,
                city=city,
                price=_parse_price(price_text),
            ))
        except Exception:
            continue
    return signals


def scrape(city: str = "Monterrey") -> list[SignalRaw]:
    try:
        signals: list[SignalRaw] = []
        seen: set[str] = set()

        for n in range(1, _MAX_PAGES + 1):
            rate_limit(1.2)
            r = httpx.get(_page_url(n), headers=BROWSER_HEADERS,
                          follow_redirects=True, timeout=20)
            if r.status_code != 200:
                break
            soup = BeautifulSoup(r.text, "lxml")
            new = _scrape_page(soup, city, seen)
            if not new:
                break
            signals.extend(new)

        return signals
    except Exception:
        return []


def fetch_sqm(url: str) -> float:
    """Visit the listing detail page and extract land area from JSON-LD description or page text."""
    try:
        r = httpx.get(url, headers=BROWSER_HEADERS, follow_redirects=True, timeout=15)
        if r.status_code != 200:
            return 0.0
        # JSON-LD description has "de 406.797 m² ubicado" — first m² hit is the lot area
        # Require whitespace before m to avoid SVG path false positives
        m = re.search(r"([\d,]+(?:[.,]\d+)?)\s+m[²2]", r.text, re.IGNORECASE)
        return parse_sqm(m.group(0)) if m else 0.0
    except Exception:
        return 0.0
