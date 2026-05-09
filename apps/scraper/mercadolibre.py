from .base import SignalRaw
from .pw_base import pw_browser, parse_price, parse_sqm

PORTAL_NAME = "mercadolibre"
_SEARCH_BASE = "https://inmuebles.mercadolibre.com.mx/terrenos/nuevo-leon/"
_MAX_PAGES = 5
_PAGE_SIZE = 48  # MercadoLibre shows 48 results per page

_CARD_SEL = '[class*="ui-search-layout__item"]'
_LINK_SEL = "a[href]"
_TITLE_SEL = 'h2, [class*="poly-component__title"], [class*="ui-search-item__title"]'
_PRICE_SEL = '[class*="price__fraction"], [class*="poly-price"]'
_LOC_SEL = '[class*="poly-component__location"], [class*="ui-search-item__location"]'
_SQM_SEL = '[class*="poly-attributes"], [class*="ui-search-item__details"]'


def _page_url(n: int) -> str:
    if n == 1:
        return _SEARCH_BASE
    offset = (n - 1) * _PAGE_SIZE + 1
    return f"{_SEARCH_BASE}_Desde_{offset}_NoIndex_True"


def _scrape_cards(page, city: str, seen: set) -> list[SignalRaw]:
    signals = []
    for card in page.query_selector_all(_CARD_SEL):
        try:
            link_el = card.query_selector(_LINK_SEL)
            title_el = card.query_selector(_TITLE_SEL)
            price_el = card.query_selector(_PRICE_SEL)
            loc_el = card.query_selector(_LOC_SEL)
            sqm_el = card.query_selector(_SQM_SEL)

            href = link_el.get_attribute("href") if link_el else None
            if not href or not href.startswith("http"):
                continue
            href = href.split("?")[0].split("#")[0]
            if href in seen:
                continue
            seen.add(href)

            title = title_el.inner_text().strip() if title_el else ""
            if not title:
                continue

            price_raw = price_el.inner_text().strip() if price_el else ""
            address = loc_el.inner_text().strip() if loc_el else ""
            sqm_raw = sqm_el.inner_text().strip() if sqm_el else ""

            signals.append(SignalRaw(
                portal=PORTAL_NAME,
                url=href,
                title=title[:200],
                address=address,
                city=city,
                price=parse_price(price_raw),
                sqm_land=parse_sqm(sqm_raw),
            ))
        except Exception:
            continue
    return signals


def scrape(city: str = "Monterrey") -> list[SignalRaw]:
    try:
        with pw_browser() as ctx:
            page = ctx.new_page()
            signals: list[SignalRaw] = []
            seen: set[str] = set()

            for n in range(1, _MAX_PAGES + 1):
                page.goto(_page_url(n), wait_until="domcontentloaded", timeout=50000)
                page.wait_for_timeout(3000)
                new = _scrape_cards(page, city, seen)
                if not new:
                    break
                signals.extend(new)

            return signals
    except Exception:
        return []
