import httpx
from bs4 import BeautifulSoup
from .base import SignalRaw, PortalUnavailable, rate_limit

PORTAL_NAME = "doorvel"

SEARCH_URL = "https://www.doorvel.com/venta/terrenos/nuevo-leon"


def scrape(city: str = "Monterrey") -> list[SignalRaw]:
    try:
        rate_limit()
        headers = {"User-Agent": "Mozilla/5.0 (compatible; Refigan/1.0)"}
        r = httpx.get(SEARCH_URL, headers=headers, timeout=15, follow_redirects=True)
        if r.status_code != 200:
            return []
        soup = BeautifulSoup(r.text, "lxml")
        # Doorvel may require JS rendering; return [] gracefully if no listings found
        signals = []
        for card in soup.select(".property-card, .listing-item, article"):
            try:
                link_el = card.select_one("a[href]")
                title_el = card.select_one("h2, h3, .title")
                if not link_el or not title_el:
                    continue
                url = link_el["href"]
                if not url.startswith("http"):
                    url = "https://www.doorvel.com" + url
                title = title_el.get_text(strip=True)
                signals.append(SignalRaw(
                    portal=PORTAL_NAME,
                    url=url,
                    title=title,
                    city=city,
                ))
            except Exception:
                continue
        return signals
    except Exception:
        return []
