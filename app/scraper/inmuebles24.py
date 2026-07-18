import sys
import traceback
from .base import SignalRaw
from .pw_base import pw_browser, stealth_page, parse_price, parse_sqm
from .zones import cve_to_slug, state_to_slug

PORTAL_NAME = "inmuebles24"
BASE_URL = "https://www.inmuebles24.com"
_NL_SEARCH_BASES = [
    f"{BASE_URL}/terrenos-en-venta-en-nuevo-leon",
    f"{BASE_URL}/lotes-en-venta-en-nuevo-leon",
]


def zone_url(cve: str) -> str:
    return f"https://www.inmuebles24.com/terrenos-en-venta-en-{cve_to_slug(cve)}.html"


def _zone_bases(cve: str) -> list[str]:
    city_slug  = cve_to_slug(cve)
    state_slug = state_to_slug(cve)
    return [
        f"{BASE_URL}/terrenos-en-venta-en-{city_slug}-{state_slug}",
        f"{BASE_URL}/lotes-en-venta-en-{city_slug}-{state_slug}",
    ]

_MAX_PAGES = 5

_CARD_SEL = '[data-qa="posting PROPERTY"]'
_LINK_SEL = 'a[href*="/propiedades/"]'
_PRICE_SEL = '[data-qa="POSTING_CARD_PRICE"]'
_LOC_SEL = '[data-qa="POSTING_CARD_LOCATION"]'
_DESC_SEL = '[data-qa="POSTING_CARD_DESCRIPTION"]'
_FEAT_SEL = '[data-qa="POSTING_CARD_FEATURES"]'


def _page_url(base: str, n: int) -> str:
    return f"{base}.html" if n == 1 else f"{base}-pagina-{n}.html"


def _scrape_cards(page, seen: set) -> tuple[list[SignalRaw], int]:
    signals = []
    for card in page.query_selector_all(_CARD_SEL):
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
                price=parse_price(price_raw),
                sqm_land=parse_sqm(feat_raw),
            ))
        except Exception:
            continue
    return signals


def scrape(cves: list[str] | None = None) -> list[SignalRaw]:
    targets = [(cve, _zone_bases(cve)) for cve in cves] if cves else [(None, _NL_SEARCH_BASES)]
    try:
        with pw_browser() as ctx:
            page = stealth_page(ctx)
            all_signals: list[SignalRaw] = []
            seen: set[str] = set()

            for cve, bases in targets:
                for base in bases:
                    for n in range(1, _MAX_PAGES + 1):
                        url = _page_url(base, n)
                        page.goto(url, wait_until="domcontentloaded", timeout=40000)
                        page.wait_for_timeout(2500)
                        new = _scrape_cards(page, seen)
                        if not new:
                            if n == 1:
                                print(f"[WARN] inmuebles24: 0 cards on page 1 — {url} (title: {page.title()!r})", file=sys.stderr)
                            break
                        if cve:
                            for s in new:
                                s.municipio_cve = cve
                        all_signals.extend(new)

            return all_signals
    except Exception:
        print(f"[ERROR] inmuebles24 scrape failed:", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        return []
