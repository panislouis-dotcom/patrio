"""
Parse a property prospect from a URL and/or free-text description.

Pipeline:
  1. Fetch URL HTML (httpx) → strip to plain text
  2. Send combined text to Claude Haiku → structured JSON
     OR: Send image bytes to Claude Sonnet (vision) → structured JSON
  3. geo.geocode(address) → lat, lon, colonia, state, municipio
  4. CVE keyword fallback if Nominatim can't resolve

No DB writes — safe to call speculatively from any route.
"""

import base64
import io
import json
import logging
import os

import anthropic
import httpx
from bs4 import BeautifulSoup
from PIL import Image

from api import geo
from scraper.base import parse_sqm
from scraper.pw_base import parse_price
from scraper.zones import cve_to_name, detect_cve, resolve_cve_from_nominatim

logger = logging.getLogger(__name__)

_BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "es-MX,es;q=0.9",
}

_PROMPT = """\
Extract real estate property information from the text below.
Properties are in Mexico (primarily Monterrey, Nuevo León area).

Return ONLY a JSON object with these fields:
{{
  "name": "<property title or short description, max 120 chars>",
  "address": "<full address: street number, colonia, city>",
  "city": "<city name only, default Monterrey>",
  "price": <total asking price in MXN as a plain integer, 0 if not found>,
  "sqmLand": <land area in square metres as a plain integer, 0 if not found>,
  "notes": "<any other useful context, max 300 chars>"
}}

Rules:
- price is a number, e.g. 2500000 not "$2.5M"
- sqmLand is a number, e.g. 350 not "350 m²"
- Use 0 for unknown numbers, empty string for unknown text
- Return only JSON — no markdown, no explanation

Text:
{text}"""

_VISION_PROMPT = """\
Extract real estate property information from the listing screenshot above.
Properties are in Mexico (primarily Monterrey, Nuevo León area).

Return ONLY a JSON object with these fields:
{
  "name": "<property title or short description, max 120 chars>",
  "address": "<full address: street number, colonia, city>",
  "city": "<city name only, default Monterrey>",
  "price": <total asking price in MXN as a plain integer, 0 if not found>,
  "sqmLand": <land area in square metres as a plain integer, 0 if not found>,
  "notes": "<any other useful context, max 300 chars>"
}

Rules:
- price is a number, e.g. 2500000 not "$2.5M"
- sqmLand is a number, e.g. 350 not "350 m²"
- Use 0 for unknown numbers, empty string for unknown text
- Return only JSON — no markdown, no explanation"""


def _fetch_url_text(url: str) -> str:
    """Fetch URL and return cleaned plain text, truncated to 4000 chars."""
    try:
        r = httpx.get(url, timeout=15, follow_redirects=True, headers=_BROWSER_HEADERS)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "lxml")
        for tag in soup(["script", "style", "nav", "footer", "header", "meta", "link"]):
            tag.decompose()
        return soup.get_text(separator=" ", strip=True)[:4000]
    except Exception as e:
        logger.warning("_fetch_url_text failed for %s: %s", url, e)
        return ""


def _image_media_type(data: bytes) -> str:
    """Detect MIME type from image magic bytes."""
    if data.startswith(b'\x89PNG'):
        return "image/png"
    elif data.startswith(b'\xff\xd8'):
        return "image/jpeg"
    elif data.startswith(b'RIFF') and len(data) > 12 and data[8:12] == b'WEBP':
        return "image/webp"
    elif data.startswith(b'GIF8'):
        return "image/gif"
    return "image/jpeg"


_MAX_B64_BYTES = 4_500_000   # stay well under Anthropic's 5 MB base64 limit
_MAX_DIMENSION  = 1568        # Claude's recommended max side length


def _compress_for_claude(image_bytes: bytes) -> tuple[bytes, str]:
    """Resize and JPEG-compress image to fit Anthropic's 5 MB base64 limit."""
    img = Image.open(io.BytesIO(image_bytes))
    img = img.convert("RGB")

    # Resize if either dimension exceeds the recommended max
    w, h = img.size
    if max(w, h) > _MAX_DIMENSION:
        scale = _MAX_DIMENSION / max(w, h)
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)

    # Iteratively lower quality until base64 size fits
    for quality in (85, 70, 55, 40):
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality, optimize=True)
        data = buf.getvalue()
        if len(base64.b64encode(data)) <= _MAX_B64_BYTES:
            return data, "image/jpeg"

    raise ValueError(f"Cannot compress image to fit {_MAX_B64_BYTES} B base64 limit")


def _parse_llm_response(raw: str) -> dict:
    """Strip optional markdown fences and parse JSON from an LLM response."""
    raw = raw.strip()
    if raw.startswith("```"):
        lines = raw.splitlines()
        raw = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
    return json.loads(raw)


def _llm_extract(text: str) -> dict:
    """Call Claude Haiku to extract structured fields from property text."""
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=512,
        messages=[{"role": "user", "content": _PROMPT.format(text=text)}],
    )
    return _parse_llm_response(msg.content[0].text)


def _llm_extract_vision(image_bytes: bytes, text: str = "") -> dict:
    """Call Claude Sonnet with vision to extract structured fields from a listing image."""
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    compressed, media_type = _compress_for_claude(image_bytes)
    b64 = base64.standard_b64encode(compressed).decode("ascii")
    content: list[dict] = [
        {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64}},
    ]
    if text:
        content.append({"type": "text", "text": text})
    content.append({"type": "text", "text": _VISION_PROMPT})
    msg = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        messages=[{"role": "user", "content": content}],
    )
    return _parse_llm_response(msg.content[0].text)


def parse_prospect(url: str = "", text: str = "", image_bytes: bytes | None = None) -> dict:
    """
    Parse a property from a URL, free-text description, and/or image.

    When image_bytes is provided the URL is not fetched and vision is used
    instead of the text path.  Returns a partial prospect dict (no DB writes).
    """
    extracted: dict = {}
    price_regex = 0
    sqm_regex = 0

    if image_bytes is not None:
        # Vision path — skip URL fetch and regex fast-pass entirely
        if not image_bytes:
            logger.warning("parse_prospect: empty image_bytes received, skipping vision extraction")
        else:
            try:
                extracted = _llm_extract_vision(image_bytes, text)
            except Exception as e:
                logger.warning("Vision LLM extraction failed: %s", e)
    else:
        clean_url = url.split("#")[0].split("?")[0] if url else ""
        url_text = _fetch_url_text(url) if url else ""
        if url and not url_text:
            # Page fetch blocked (bot protection). Include clean URL so LLM can
            # extract whatever it can from the URL slug and domain.
            logger.info("URL fetch returned empty for %s — falling back to URL slug", clean_url)
            url_text = f"URL de la propiedad: {clean_url}"

        combined = "\n\n".join(filter(None, [url_text, text]))

        if not combined:
            return {}

        # Regex fast-pass — cheap fallback if LLM fails
        price_regex = parse_price(combined)
        sqm_regex   = parse_sqm(combined)

        try:
            extracted = _llm_extract(combined)
        except Exception as e:
            logger.warning("LLM extraction failed: %s", e)

    result = {
        "name":          extracted.get("name", ""),
        "address":       extracted.get("address", ""),
        "city":          extracted.get("city", "") or "Monterrey",
        "price":         float(extracted.get("price", 0) or price_regex),
        "sqmLand":       float(extracted.get("sqmLand", 0) or sqm_regex),
        "notes":         extracted.get("notes", ""),
        "url":           url or "",
        "status":        "evaluating",
        "latitude":      0.0,
        "longitude":     0.0,
        "municipioCve":  "",
        "municipioName": "",
        "colonia":       "",
        "stateName":     "",
    }

    # Geocode address
    address = result["address"]
    if address:
        try:
            geo_result = geo.geocode(address)
            if geo_result:
                lat, lon, colonia, state_name, mun_name = geo_result
                result.update({
                    "latitude":      lat,
                    "longitude":     lon,
                    "colonia":       colonia or "",
                    "stateName":     state_name or "",
                    "municipioName": mun_name or "",
                })
                cve = resolve_cve_from_nominatim(state_name, mun_name)
                result["municipioCve"] = cve
                if cve and not result["municipioName"]:
                    result["municipioName"] = cve_to_name(cve)
        except Exception as e:
            logger.warning("Geocoding failed for %r: %s", address, e)

    # CVE keyword fallback
    if not result["municipioCve"] and address:
        cve = detect_cve(address)
        result["municipioCve"] = cve
        if cve and not result["municipioName"]:
            result["municipioName"] = cve_to_name(cve)

    return result
