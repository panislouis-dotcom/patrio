from .base import SignalRaw
from .pw_base import pw_browser, parse_price, parse_sqm

PORTAL_NAME = "mercadolibre"
SEARCH_URL = "https://inmuebles.mercadolibre.com.mx/terrenos/nuevo-leon/"

_CARD_SEL = '[class*="ui-search-layout__item"]'
_LINK_SEL = "a[href]"
_TITLE_SEL = 'h2, [class*="poly-component__title"], [class*="ui-search-item__title"]'
_PRICE_SEL = '[class*="price__fraction"], [class*="poly-price"]'
_LOC_SEL = '[class*="poly-component__location"], [class*="ui-search-item__location"]'
_SQM_SEL = '[class*="poly-attributes"], [class*="ui-search-item__details"]'


def scrape(city: str = "Monterrey") -> list[SignalRaw]:
    try:
        with pw_browser() as ctx:
            page = ctx.new_page()
            page.goto(SEARCH_URL, wait_until="domcontentloaded", timeout=50000)
            page.wait_for_timeout(4000)

            cards = page.query_selector_all(_CARD_SEL)
            signals = []
            for card in cards:
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
    except Exception:
        return []
