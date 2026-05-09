from dataclasses import dataclass
import re
import time


@dataclass
class SignalRaw:
    portal: str
    url: str
    title: str
    address: str = ''
    city: str = 'Monterrey'
    price: float = 0.0
    sqm_land: float = 0.0


class PortalUnavailable(Exception):
    pass


BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "es-MX,es;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "DNT": "1",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
}


def rate_limit(secs: float = 1.5):
    time.sleep(secs)


def parse_sqm(text: str) -> float:
    """Extract m² from strings like '6,757 m²', '994 m² de terreno', '180m2'."""
    m = re.search(r"([\d,]+(?:\.\d+)?)\s*m[²2²]?", text.replace(",", ""))
    if m:
        try:
            return float(m.group(1).replace(",", ""))
        except ValueError:
            pass
    return 0.0
