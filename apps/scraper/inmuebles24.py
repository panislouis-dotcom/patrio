from .base import SignalRaw
from .pw_base import pw_browser, parse_price, parse_sqm

PORTAL_NAME = "inmuebles24"
BASE_URL = "https://www.inmuebles24.com"
SEARCH_URL = f"{BASE_URL}/terrenos-en-venta-en-nuevo-leon.html"

_CARD_SEL = '[data-qa="posting PROPERTY"]'
_LINK_SEL = 'a[href*="/propiedades/"]'
_PRICE_SEL = '[data-qa="POSTING_CARD_PRICE"]'
_LOC_SEL = '[data-qa="POSTING_CARD_LOCATION"]'
_DESC_SEL = '[data-qa="POSTING_CARD_DESCRIPTION"]'
_FEAT_SEL = '[data-qa="POSTING_CARD_FEATURES"]'


def scrape(city: str = "Monterrey") -> list[SignalRaw]:
    try:
        with pw_browser() as ctx:
            page = ctx.new_page()
            page.goto(SEARCH_URL, wait_until="domcontentloaded", timeout=40000)
            page.wait_for_timeout(3000)

            cards = page.query_selector_all(_CARD_SEL)
            signals = []
            for card in cards:
                try:
                    link_el = card.query_selector(_LINK_SEL)
                    price_el = card.query_selector(_PRICE_SEL)
                    loc_el = card.query_selector(_LOC_SEL)
                    desc_el = card.query_selector(_DESC_SEL)
                    feat_el = card.query_selector(_FEAT_SEL)

                    href = link_el.get_attribute("href") if link_el else None
                    if not href:
                        continue
                    if not href.startswith("http"):
                        href = BASE_URL + href
                    href = href.split("?")[0]

                    title = desc_el.inner_text().strip() if desc_el else ""
                    if not title:
                        title = href.split("/")[-1].replace("-", " ").title()

                    price_raw = price_el.inner_text().strip() if price_el else ""
                    address = loc_el.inner_text().strip() if loc_el else ""
                    feat_raw = feat_el.inner_text().strip() if feat_el else ""

                    signals.append(SignalRaw(
                        portal=PORTAL_NAME,
                        url=href,
                        title=title[:200],
                        address=address,
                        city=city,
                        price=parse_price(price_raw),
                        sqm_land=parse_sqm(feat_raw),
                    ))
                except Exception:
                    continue
            return signals
    except Exception:
        return []
