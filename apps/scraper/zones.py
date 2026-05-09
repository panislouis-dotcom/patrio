# Zone display name → per-portal URL identifier
ZONE_DEFS: dict[str, dict[str, str]] = {
    "Monterrey": {
        "lamudi":       "monterrey",
        "icasas":       "monterrey-983",
        "inmuebles24":  "monterrey",
        "mercadolibre": "monterrey",
        "vivanuncios":  "10980",
        "doorvel":      "monterrey",
    },
    "San Pedro": {
        "lamudi":       "san-pedro-garza-garcia",
        "icasas":       "san-pedro-garza-garcia-990",
        "inmuebles24":  "san-pedro-garza-garcia",
        "mercadolibre": "san-pedro-garza-garcia",
        "vivanuncios":  "14842",
        "doorvel":      "san-pedro-garza-garcia",
    },
    "Santa Catarina": {
        "lamudi":       "santa-catarina",
        "icasas":       "santa-catarina-991",
        "inmuebles24":  "santa-catarina",
        "mercadolibre": "santa-catarina",
        "vivanuncios":  "14843",
        "doorvel":      "santa-catarina",
    },
    "García": {
        "lamudi":       "garcia",
        "icasas":       "garcia-960",
        "inmuebles24":  "garcia",
        "mercadolibre": "garcia",
        "vivanuncios":  "14848",
        "doorvel":      "garcia",
    },
}

ALL_ZONES: list[str] = list(ZONE_DEFS.keys())

_ZONE_KEYWORDS: dict[str, list[str]] = {
    "San Pedro": ["san pedro", "garza garcia", "spgg"],
    "Santa Catarina": ["santa catarina"],
    "García": ["garcia", "garcía"],
    "Monterrey": ["monterrey", "mty"],
}


def detect_zone(address: str) -> str:
    lower = address.lower()
    for zone, keywords in _ZONE_KEYWORDS.items():
        if any(k in lower for k in keywords):
            return zone
    return ""
