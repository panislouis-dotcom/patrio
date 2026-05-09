"""Shared Playwright browser context for all PW-based scrapers."""
import re
from contextlib import contextmanager
from playwright.sync_api import sync_playwright, Browser, BrowserContext


_LAUNCH_ARGS = [
    "--disable-blink-features=AutomationControlled",
    "--no-sandbox",
    "--disable-dev-shm-usage",
]

_CONTEXT_OPTS = dict(
    user_agent=(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    viewport={"width": 1280, "height": 800},
    locale="es-MX",
)


@contextmanager
def pw_browser():
    """Yield a Playwright browser context; caller is responsible for closing pages."""
    with sync_playwright() as pw:
        browser: Browser = pw.chromium.launch(headless=True, args=_LAUNCH_ARGS)
        try:
            ctx: BrowserContext = browser.new_context(**_CONTEXT_OPTS)
            yield ctx
        finally:
            browser.close()


def parse_price(text: str) -> float:
    """Extract numeric value from price strings like 'MN 6,400,000' or 'MXN18,000,000'."""
    digits = re.sub(r"[^\d.]", "", text.replace(",", ""))
    try:
        return float(digits)
    except ValueError:
        return 0.0


def parse_sqm(text: str) -> float:
    """Extract m² value from strings like '753 m² lote' or '994 m² de terreno'."""
    m = re.search(r"([\d,]+(?:\.\d+)?)\s*m", text.replace(",", ""))
    if m:
        try:
            return float(m.group(1))
        except ValueError:
            pass
    return 0.0
