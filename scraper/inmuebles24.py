import re
import httpx
from bs4 import BeautifulSoup
from .base import SignalRaw, rate_limit

PORTAL_NAME = "inmuebles24"

SEARCH_URL = "https://www.inmuebles24.com/terrenos-en-venta-en-nuevo-leon.html"


def scrape(city: str = "Monterrey") -> list[SignalRaw]:
    try:
        rate_limit()
        headers = {"User-Agent": "Mozilla/5.0 (compatible; Refigan/1.0)"}
        r = httpx.get(SEARCH_URL, headers=headers, timeout=15, follow_redirects=True)
        if r.status_code != 200:
            return []
        soup = BeautifulSoup(r.text, "lxml")
        signals = []
        for card in soup.select("[data-qa='posting PROPERTY']"):
            try:
                link_el = card.select_one("a[href]")
                title_el = card.select_one("[data-qa='posting-title']")
                price_el = card.select_one("[data-qa='price-value']")
                if not link_el or not title_el:
                    continue
                url = link_el["href"]
                if not url.startswith("http"):
                    url = "https://www.inmuebles24.com" + url
                title = title_el.get_text(strip=True)
                price_text = price_el.get_text(strip=True) if price_el else ""
                price = _parse_price(price_text)
                signals.append(SignalRaw(
                    portal=PORTAL_NAME,
                    url=url,
                    title=title,
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
