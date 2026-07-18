import unicodedata

# INEGI CVE → municipio info. CVE = 2-digit state + 3-digit municipio.
MUNICIPIOS: dict[str, dict] = {
    "19039": {"name": "Monterrey",      "state": "Nuevo León", "metro": "ZMM"},
    "19019": {"name": "San Pedro Garza García", "state": "Nuevo León", "metro": "ZMM"},
    "19046": {"name": "Santa Catarina", "state": "Nuevo León", "metro": "ZMM"},
    "19021": {"name": "García",         "state": "Nuevo León", "metro": "ZMM"},
    "19006": {"name": "Apodaca",        "state": "Nuevo León", "metro": "ZMM"},
    "19010": {"name": "Escobedo",       "state": "Nuevo León", "metro": "ZMM"},
}

# CVEs active for scanning (subset of MUNICIPIOS)
ACTIVE_CVES: list[str] = ["19039", "19019", "19046", "19021", "19006", "19010"]


def cve_to_slug(cve: str) -> str:
    """Derive URL slug from official municipio name. Works for 90% of portals automatically."""
    name = MUNICIPIOS[cve]["name"]
    nfkd = unicodedata.normalize("NFD", name)
    ascii_name = "".join(c for c in nfkd if unicodedata.category(c) != "Mn")
    return ascii_name.lower().replace(" ", "-")


def state_to_slug(cve: str) -> str:
    """Return URL slug for the state that contains the given CVE (e.g. '19019' → 'nuevo-leon')."""
    state = MUNICIPIOS.get(cve, {}).get("state", "")
    nfkd = unicodedata.normalize("NFD", state)
    ascii_state = "".join(c for c in nfkd if unicodedata.category(c) != "Mn")
    return ascii_state.lower().replace(" ", "-")


def cve_to_name(cve: str) -> str:
    """Return display name for a CVE, or the CVE itself if unknown."""
    return MUNICIPIOS.get(cve, {}).get("name", cve)


# Keyword fallback — only used when geocoding is unavailable.
# Terms must be specific enough to avoid false positives with homonyms in other states.
_KEYWORD_MAP: dict[str, str] = {
    "san pedro garza": "19019",
    "garza garcia":    "19019",
    "garza garcía":    "19019",
    "spgg":            "19019",
    "santa catarina":  "19046",
    "garcía":          "19021",
    "garcia":          "19021",
    "monterrey":       "19039",
    "apodaca":         "19006",
    "escobedo":        "19010",
}

# Nominatim reverse lookup: (state_name, municipio_name) → INEGI CVE.
# Add entries here when expanding to new cities — no code changes required.
_NOMINATIM_TO_CVE: dict[tuple[str, str], str] = {
    ("Nuevo León", "San Pedro Garza García"): "19019",
    ("Nuevo León", "Monterrey"):               "19039",
    ("Nuevo León", "Santa Catarina"):          "19046",
    ("Nuevo León", "García"):                  "19021",
    ("Nuevo León", "Apodaca"):                 "19006",
    ("Nuevo León", "General Escobedo"):        "19010",
    # To expand to other cities, add entries like:
    # ("Jalisco", "Guadalajara"): "14039",
    # ("Ciudad de México", "Cuauhtémoc"): "09015",
}


def detect_cve(address: str) -> str:
    """Keyword-based CVE detection from address text. Returns CVE or ''.
    Used only as fallback when Nominatim geocoding is unavailable."""
    lower = address.lower()
    for kw, cve in _KEYWORD_MAP.items():
        if kw in lower:
            return cve
    return ""


def resolve_cve_from_nominatim(state: str, municipio: str) -> str:
    """Return INEGI CVE for a (state, municipio) pair from Nominatim. Returns '' if unknown."""
    return _NOMINATIM_TO_CVE.get((state, municipio), "")


# Legacy compat: sonar.py still calls detect_zone() in some places
def detect_zone(address: str) -> str:
    """Return municipio display name detected from address, or ''."""
    cve = detect_cve(address)
    return cve_to_name(cve) if cve else ""
