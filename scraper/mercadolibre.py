import httpx
from .base import SignalRaw, PortalUnavailable, rate_limit

PORTAL_NAME = "mercadolibre"

SEARCH_URL = (
    "https://api.mercadolibre.com/sites/MLM/search"
    "?category=MLM1459&q=terreno+monterrey&limit=50"
)


def scrape(city: str = "Monterrey") -> list[SignalRaw]:
    try:
        rate_limit()
        r = httpx.get(SEARCH_URL, timeout=15)
        if r.status_code != 200:
            return []
        results = r.json().get("results", [])
        signals = []
        for item in results:
            url = item.get("permalink", "")
            title = item.get("title", "")
            price = float(item.get("price") or 0)
            if not url or not title:
                continue
            signals.append(SignalRaw(
                portal=PORTAL_NAME,
                url=url,
                title=title,
                city=city,
                price=price,
            ))
        return signals
    except Exception:
        return []
