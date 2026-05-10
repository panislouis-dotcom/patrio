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
ACTIVE_CVES: list[str] = ["19039", "19019", "19046", "19021"]


def cve_to_slug(cve: str) -> str:
    """Derive URL slug from official municipio name. Works for 90% of portals automatically."""
    name = MUNICIPIOS[cve]["name"]
    nfkd = unicodedata.normalize("NFD", name)
    ascii_name = "".join(c for c in nfkd if unicodedata.category(c) != "Mn")
    return ascii_name.lower().replace(" ", "-")


def cve_to_name(cve: str) -> str:
    """Return display name for a CVE, or the CVE itself if unknown."""
    return MUNICIPIOS.get(cve, {}).get("name", cve)


_KEYWORD_MAP: dict[str, str] = {
    "san pedro": "19019",
    "garza garcia": "19019",
    "garza garcía": "19019",
    "spgg": "19019",
    "santa catarina": "19046",
    "garcía": "19021",
    "garcia": "19021",
    "monterrey": "19039",
    "apodaca": "19006",
    "escobedo": "19010",
}


def detect_cve(address: str) -> str:
    """Keyword-based CVE detection from address text. Returns CVE or ''."""
    lower = address.lower()
    for kw, cve in _KEYWORD_MAP.items():
        if kw in lower:
            return cve
    return ""


# Legacy compat: sonar.py still calls detect_zone() in some places
def detect_zone(address: str) -> str:
    """Return municipio display name detected from address, or ''."""
    cve = detect_cve(address)
    return cve_to_name(cve) if cve else ""
