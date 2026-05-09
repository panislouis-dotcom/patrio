import re
import httpx
from bs4 import BeautifulSoup
from .base import SignalRaw, BROWSER_HEADERS, rate_limit

PORTAL_NAME = "doorvel"
BASE_URL = "https://www.doorvel.com"
SEARCH_URL = f"{BASE_URL}/home/terrenos-en-venta-en-monterrey-nuevo-leon-mexico"


def _parse_price(text: str) -> float:
    # "$7,950,000MXN" → 7950000.0
    digits = re.sub(r"[^\d.]", "", text.replace(",", ""))
    try:
        return float(digits)
    except ValueError:
        return 0.0


def scrape(city: str = "Monterrey") -> list[SignalRaw]:
    try:
        rate_limit(1.2)
        r = httpx.get(SEARCH_URL, headers=BROWSER_HEADERS,
                      follow_redirects=True, timeout=20)
        if r.status_code != 200:
            return []
        soup = BeautifulSoup(r.text, "lxml")
        cards = soup.select('[data-testid="property-card"]')
        if not cards:
            return []

        signals: list[SignalRaw] = []
        seen: set[str] = set()

        for card in cards:
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
    except Exception:
        return []
