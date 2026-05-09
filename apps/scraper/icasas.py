import re
import httpx
from bs4 import BeautifulSoup
from .base import SignalRaw, BROWSER_HEADERS, rate_limit

PORTAL_NAME = "icasas"
BASE_URL = "https://www.icasas.mx"
SEARCH_URL = f"{BASE_URL}/venta/tierras-lotes-terrenos-nuevo-leon-monterrey-5_9_19_0_983_0"
_MAX_PAGES = 4


def _page_url(page: int) -> str:
    return SEARCH_URL if page == 1 else f"{SEARCH_URL}?page={page}"


def _parse_price(text: str) -> float:
    # "2,400,000 MX$" or "9,750,000 MX$destacado"
    digits = re.sub(r"[^\d.]", "", text.replace(",", ""))
    try:
        return float(digits)
    except ValueError:
        return 0.0


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
            cards = soup.select("li.serp-snippet.ad")
            if not cards:
                break

            new_on_page = 0
            for card in cards:
                try:
                    link_el = card.select_one("a.detail-redirection")
                    if not link_el:
                        continue
                    href = BASE_URL + link_el["href"]
                    if href in seen:
                        continue

                    title = link_el.get_text(strip=True)[:200]
                    price_el = card.select_one("div.price")
                    price_text = price_el.get_text(strip=True) if price_el else ""
                    addr_el = card.select_one('meta[itemprop="addressLocality"]')
                    address = addr_el.get("content", "") if addr_el else ""

                    seen.add(href)
                    signals.append(SignalRaw(
                        portal=PORTAL_NAME,
                        url=href,
                        title=title,
                        address=address,
                        city=city,
                        price=_parse_price(price_text),
                    ))
                    new_on_page += 1
                except Exception:
                    continue

            if new_on_page == 0:
                break
        except Exception:
            break

    return signals
