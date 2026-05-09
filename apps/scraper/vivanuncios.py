from .base import SignalRaw
from .pw_base import pw_browser, parse_price, parse_sqm

PORTAL_NAME = "vivanuncios"
BASE_URL = "https://www.vivanuncios.com.mx"
_SEARCH_BASE = f"{BASE_URL}/s-venta-terrenos/nuevo-leon/v1c31l1018p"
_MAX_PAGES = 6

_CARD_SEL = '[data-qa="posting PROPERTY"]'
_LINK_SEL = 'a[href*="/a-venta"]'
_PRICE_SEL = '[data-qa="POSTING_CARD_PRICE"]'
_LOC_SEL = '[data-qa="POSTING_CARD_LOCATION"]'
_DESC_SEL = '[data-qa="POSTING_CARD_DESCRIPTION"]'
_FEAT_SEL = '[data-qa="POSTING_CARD_FEATURES"]'


def _scrape_page(page_obj, url: str, city: str, seen: set) -> list[SignalRaw]:
    page_obj.goto(url, wait_until="domcontentloaded", timeout=40000)
    page_obj.wait_for_timeout(2500)
    signals = []
    for card in page_obj.query_selector_all(_CARD_SEL):
        try:
            link_el = card.query_selector(_LINK_SEL)
            href = link_el.get_attribute("href") if link_el else None
            if not href:
                continue
            if not href.startswith("http"):
                href = BASE_URL + href
            href = href.split("?")[0]
            if href in seen:
                continue
            seen.add(href)

            price_el = card.query_selector(_PRICE_SEL)
            loc_el = card.query_selector(_LOC_SEL)
            desc_el = card.query_selector(_DESC_SEL)
            feat_el = card.query_selector(_FEAT_SEL)

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


def scrape(city: str = "Monterrey") -> list[SignalRaw]:
    try:
        signals: list[SignalRaw] = []
        seen: set[str] = set()
        with pw_browser() as ctx:
            page = ctx.new_page()
            for p in range(1, _MAX_PAGES + 1):
                page_signals = _scrape_page(page, f"{_SEARCH_BASE}{p}", city, seen)
                if not page_signals:
                    break
                signals.extend(page_signals)
        return signals
    except Exception:
        return []
