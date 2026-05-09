import base64
import httpx
from bs4 import BeautifulSoup

from .base import SignalRaw, BROWSER_HEADERS, rate_limit
from .pw_base import parse_sqm

PORTAL_NAME = "mitula"
BASE_URL = "https://casas.mitula.mx"
SEARCH_URL = f"{BASE_URL}/casas/terrenos-venta-nuevo-leon"
_MAX_PAGES = 4


def _page_url(page: int) -> str:
    return SEARCH_URL if page == 1 else f"{SEARCH_URL}?page={page}"


def _extract_url(card) -> str | None:
    b64 = card.get("data-clickdestination", "")
    if not b64:
        return None
    try:
        path = base64.b64decode(b64 + "==").decode("utf-8", errors="ignore")
        path = path.split("?")[0]
        return BASE_URL + path
    except Exception:
        return None


def scrape(city: str = "Monterrey") -> list[SignalRaw]:
    signals: list[SignalRaw] = []
    seen: set[str] = set()

    for page in range(1, _MAX_PAGES + 1):
        try:
            rate_limit(1.2)
            r = httpx.get(_page_url(page), headers=BROWSER_HEADERS,
                          follow_redirects=True, timeout=20)
            if r.status_code != 200:
                break
            soup = BeautifulSoup(r.text, "lxml")
            cards = soup.select("article.listing-card")
            if not cards:
                break

            new_on_page = 0
            for card in cards:
                try:
                    url = _extract_url(card)
                    if not url or url in seen:
                        continue

                    price_raw = card.get("data-price", "0").replace(",", "")
                    try:
                        price = float(price_raw)
                    except ValueError:
                        price = 0.0

                    address = card.get("data-location", "")
                    sqm_raw = card.get("data-floorarea", "")
                    desc_el = card.select_one(".listing-card__description__text")
                    title = desc_el.get_text(strip=True)[:200] if desc_el else f"Terreno en {address}"
                    if not title:
                        title = f"Terreno en {address}"

                    seen.add(url)
                    signals.append(SignalRaw(
                        portal=PORTAL_NAME,
                        url=url,
                        title=title,
                        address=address,
                        city=city,
                        price=price,
                        sqm_land=parse_sqm(sqm_raw),
                    ))
                    new_on_page += 1
                except Exception:
                    continue

            if new_on_page == 0:
                break
        except Exception:
            break

    return signals
