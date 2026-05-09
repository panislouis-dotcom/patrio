import re
import httpx
from bs4 import BeautifulSoup
from .base import SignalRaw, BROWSER_HEADERS, rate_limit

PORTAL_NAME = "realtorcom"
BASE_URL = "https://www.realtor.com"
SEARCH_URL = f"{BASE_URL}/international/mx/land-for-sale/monterrey-nuevo-leon"
_MAX_PAGES = 4

_LISTING_PATTERN = re.compile(r"/international/mx/[^/]+-\d+/")


def _page_url(page: int) -> str:
    return SEARCH_URL if page == 1 else f"{SEARCH_URL}?page={page}"


def _parse_price(text: str) -> float:
    # "MXN $14,000,000" → 14000000.0
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
            rate_limit(1.5)
            r = httpx.get(_page_url(page), headers=BROWSER_HEADERS,
                          follow_redirects=True, timeout=20)
            if r.status_code != 200:
                break
            soup = BeautifulSoup(r.text, "lxml")

            listing_links = [
                a for a in soup.find_all("a", href=True)
                if _LISTING_PATTERN.search(a["href"])
            ]
            if not listing_links:
                break

            new_on_page = 0
            for link in listing_links:
                try:
                    href = BASE_URL + link["href"] if not link["href"].startswith("http") else link["href"]
                    if href in seen:
                        continue

                    card = link.select_one('[data-testid="standard-listing-card"]')
                    if not card:
                        continue

                    price_el = card.select_one(".displayListingPrice")
                    addr_el = card.select_one(".address")

                    address = addr_el.get_text(strip=True) if addr_el else ""
                    price_text = price_el.get_text(strip=True) if price_el else ""
                    title = f"Terreno en {address.split(',')[0].strip()}"[:200] if address else "Terreno en Monterrey"

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
