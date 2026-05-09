import re
import httpx
from bs4 import BeautifulSoup
from .base import SignalRaw, BROWSER_HEADERS, rate_limit

PORTAL_NAME = "lamudi"
BASE_URL = "https://www.lamudi.com.mx"
SEARCH_URL = f"{BASE_URL}/nuevo-leon/terreno/for-sale/"


def scrape(city: str = "Monterrey") -> list[SignalRaw]:
    try:
        rate_limit()
        r = httpx.get(SEARCH_URL, headers=BROWSER_HEADERS, timeout=20, follow_redirects=True)
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

                signals.append(SignalRaw(
                    portal=PORTAL_NAME,
                    url=href,
                    title=title,
                    address=address,
                    city=city,
                    price=price,
                ))
            except Exception:
                continue
        return signals
    except Exception:
        return []


def _parse_price(text: str) -> float:
    digits = re.sub(r"[^\d.]", "", text.replace(",", ""))
    try:
        return float(digits)
    except ValueError:
        return 0.0
