"""
Geocoding + colonia name extraction via Nominatim.

Nominatim returns the colonia name directly in the `address` object under
the `residential`, `suburb`, `neighbourhood`, or `quarter` key — no shapefile
or point-in-polygon logic needed.

Works anywhere in Mexico without any static data files.
Rate limit: 1 req/sec per Nominatim policy (enforced internally).
"""

import logging
import time
from typing import Optional

logger = logging.getLogger(__name__)

_geolocator = None
_last_request: float = 0.0
_MIN_INTERVAL = 1.05  # 1 req/sec + buffer

# Fields Nominatim uses for colonia/neighbourhood in Mexico, in preference order
_COLONIA_FIELDS = ("residential", "neighbourhood", "suburb", "quarter", "hamlet")


def _get_geolocator():
    global _geolocator
    if _geolocator is None:
        try:
            from geopy.geocoders import Nominatim
            _geolocator = Nominatim(user_agent="refigan-sonar/1.0", timeout=10)
        except ImportError:
            logger.warning("geo: geopy not installed — geocoding disabled")
    return _geolocator


def _colonia_from_raw(raw: dict) -> str:
    """Extract colonia name from a Nominatim raw result dict."""
    addr = raw.get("address", {})
    for field in _COLONIA_FIELDS:
        val = addr.get(field, "")
        if val:
            return str(val).strip()
    return ""


def _place_from_raw(raw: dict) -> tuple[str, str]:
    """Extract (state_name, municipio_name) from a Nominatim raw result dict."""
    addr = raw.get("address", {})
    state = str(addr.get("state", "")).strip()
    municipio = (
        addr.get("county") or
        addr.get("municipality") or
        addr.get("city_district") or
        addr.get("city") or ""
    )
    return state, str(municipio).strip()


def geocode(address: str, state_hint: str = "") -> Optional[tuple[float, float, str, str, str]]:
    """
    Geocode address via Nominatim.
    Returns (lat, lon, colonia, state_name, municipio_name) or None on failure.
    state_hint (e.g. "Nuevo León") is appended to the query when the address
    doesn't already mention the state, preventing cross-state homonym mismatches.
    Rate-limited to 1 req/sec.
    """
    global _last_request
    geo = _get_geolocator()
    if geo is None:
        return None

    elapsed = time.monotonic() - _last_request
    if elapsed < _MIN_INTERVAL:
        time.sleep(_MIN_INTERVAL - elapsed)

    try:
        lower_addr = address.lower()
        has_country = "méxico" in lower_addr or "mexico" in lower_addr
        has_state   = bool(state_hint) and state_hint.lower() in lower_addr

        if state_hint and not has_state:
            query = f"{address}, {state_hint}, México"
        elif not has_country:
            query = f"{address}, México"
        else:
            query = address

        loc = geo.geocode(query, addressdetails=True)
        _last_request = time.monotonic()
        if not loc:
            return None
        colonia = _colonia_from_raw(loc.raw)
        state, municipio = _place_from_raw(loc.raw)
        return (loc.latitude, loc.longitude, colonia, state, municipio)
    except Exception as exc:
        logger.debug("geo: geocode failed for %r — %s", address, exc)
        _last_request = time.monotonic()
        return None


# ---------------------------------------------------------------------------
# Optional: load INEGI AGEB shapefile for offline/high-volume use
# Place .shp in apps/data/geo/colonias_inegi_2024/ to enable.
# If absent, Nominatim geocoding provides colonia names at query time.
# ---------------------------------------------------------------------------

_colonias_gdf = None
_Point = None

from pathlib import Path
_GEO_DIR = Path(__file__).parent.parent / "data" / "geo" / "colonias_inegi_2024"


def load_colonias() -> bool:
    """
    Optional: load INEGI AGEB shapefile for offline colonia lookup.
    Returns True if loaded; False if no shapefile found (non-fatal).
    When loaded, assign_colonia() uses polygon lookup instead of Nominatim.
    """
    global _colonias_gdf, _Point
    shps = list(_GEO_DIR.glob("*.shp")) if _GEO_DIR.exists() else []
    if not shps:
        logger.info("geo: no shapefile found — using Nominatim for colonia names")
        return False
    try:
        import geopandas as gpd
        from shapely.geometry import Point
        _Point = Point
        gdf = gpd.read_file(shps[0])
        _colonias_gdf = gdf.to_crs("EPSG:4326")
        logger.info("geo: loaded %d colonia polygons from %s", len(_colonias_gdf), shps[0])
        return True
    except Exception as exc:
        logger.warning("geo: failed to load shapefile — %s", exc)
        return False


def assign_colonia(lat: float, lon: float) -> str:
    """Point-in-polygon colonia lookup. Only works when shapefile is loaded."""
    if _colonias_gdf is None or _Point is None:
        return ""
    try:
        pt = _Point(lon, lat)
        match = _colonias_gdf[_colonias_gdf.geometry.contains(pt)]
        if not match.empty:
            for col in ("NOMGEO", "NOM_LOC", "NOM_MUN"):
                if col in match.columns:
                    val = match.iloc[0][col]
                    if val and str(val).strip():
                        return str(val).strip().title()
        return ""
    except Exception:
        return ""
