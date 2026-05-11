import sys
import traceback
from .base import SignalRaw
from .pw_base import pw_browser, stealth_page, parse_price, parse_sqm
from .zones import cve_to_slug

PORTAL_NAME = "mercadolibre"
_NL_SEARCH_BASE = "https://inmuebles.mercadolibre.com.mx/terrenos/nuevo-leon/"
_MAX_PAGES = 5
_PAGE_SIZE = 48  # MercadoLibre shows 48 results per page


def zone_url(cve: str) -> str:
    return f"https://inmuebles.mercadolibre.com.mx/terrenos/venta/nuevo-leon/{cve_to_slug(cve)}/"

_CARD_SEL = '[class*="ui-search-layout__item"]'
_LINK_SEL = "a[href]"
_TITLE_SEL = 'h2, [class*="poly-component__title"], [class*="ui-search-item__title"]'
_PRICE_SEL = '[class*="price__fraction"], [class*="poly-price"]'
_LOC_SEL = '[class*="poly-component__location"], [class*="ui-search-item__location"]'
_SQM_SEL = '[class*="poly-attributes"], [class*="ui-search-item__details"]'


def _page_url(base: str, n: int) -> str:
    if n == 1:
        return base
    offset = (n - 1) * _PAGE_SIZE + 1
    return f"{base}_Desde_{offset}_NoIndex_True"


def _scrape_cards(page, seen: set) -> list[SignalRaw]:
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
                price=parse_price(price_raw),
                sqm_land=parse_sqm(sqm_raw),
            ))
        except Exception:
            continue
    return signals


def scrape(cves: list[str] | None = None) -> list[SignalRaw]:
    targets = [(cve, zone_url(cve)) for cve in cves] if cves else [(None, _NL_SEARCH_BASE)]
    try:
        with pw_browser() as ctx:
            page = stealth_page(ctx)
            all_signals: list[SignalRaw] = []
            seen: set[str] = set()

            for cve, base in targets:
                for n in range(1, _MAX_PAGES + 1):
                    url = _page_url(base, n)
                    page.goto(url, wait_until="domcontentloaded", timeout=50000)
                    page.wait_for_timeout(3000)
                    new = _scrape_cards(page, seen)
                    if not new:
                        if n == 1:
                            print(f"[WARN] mercadolibre: 0 cards on page 1 — {url} (title: {page.title()!r})", file=sys.stderr)
                        break
                    if cve:
                        for s in new:
                            s.municipio_cve = cve
                    all_signals.extend(new)

            return all_signals
    except Exception:
        print(f"[ERROR] mercadolibre scrape failed:", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        return []
