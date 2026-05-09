from dataclasses import dataclass
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
