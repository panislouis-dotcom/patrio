#!/usr/bin/env python3
"""
Download INEGI AGEB urbano GeoJSON for Mexican states.

Source: INEGI Marco Geoestadístico 2025 via gaia.inegi.org.mx REST API.
Output: app/api/geo_data/agebs/{state_code}_{state_name}.geojson

NOTE: AGEB data gives administrative boundaries by code.
Colonia names come from Nominatim geocoding (see api/geo.py), not from this data.
These files are useful for AGEB-level spatial analysis or as a fallback index.

Usage:
    python3 download_inegi_agebs.py              # all 32 states
    python3 download_inegi_agebs.py 19           # Nuevo León only
    python3 download_inegi_agebs.py 19 09 14     # NL + CDMX + Jalisco
"""

import json
import sys
import time
import urllib.request
from pathlib import Path

OUTPUT_DIR = Path(__file__).parent / "agebs"
OUTPUT_DIR.mkdir(exist_ok=True)

BASE_URL = "https://gaia.inegi.org.mx/wscatgeo/v2/geo/agebu"

STATES = {
    "01": "Aguascalientes",
    "02": "Baja California",
    "03": "Baja California Sur",
    "04": "Campeche",
    "05": "Coahuila",
    "06": "Colima",
    "07": "Chiapas",
    "08": "Chihuahua",
    "09": "CDMX",
    "10": "Durango",
    "11": "Guanajuato",
    "12": "Guerrero",
    "13": "Hidalgo",
    "14": "Jalisco",
    "15": "Estado de Mexico",
    "16": "Michoacan",
    "17": "Morelos",
    "18": "Nayarit",
    "19": "Nuevo Leon",
    "20": "Oaxaca",
    "21": "Puebla",
    "22": "Queretaro",
    "23": "Quintana Roo",
    "24": "San Luis Potosi",
    "25": "Sinaloa",
    "26": "Sonora",
    "27": "Tabasco",
    "28": "Tamaulipas",
    "29": "Tlaxcala",
    "30": "Veracruz",
    "31": "Yucatan",
    "32": "Zacatecas",
}


def download_state(code: str) -> bool:
    name = STATES.get(code, f"state_{code}")
    out_file = OUTPUT_DIR / f"{code}_{name.lower().replace(' ', '_')}.geojson"

    if out_file.exists():
        print(f"  skip  {code} {name} (already downloaded)")
        return True

    url = f"{BASE_URL}/{code}"
    print(f"  fetch {code} {name} ...", end="", flush=True)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "refigan-geo/1.0"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read())
        total = data.get("totalReg", len(data.get("features", [])))
        with open(out_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        print(f" {total} AGEBs → {out_file.name}")
        return True
    except Exception as exc:
        print(f" ERROR: {exc}")
        return False


def main():
    targets = sys.argv[1:] if len(sys.argv) > 1 else sorted(STATES.keys())
    invalid = [c for c in targets if c not in STATES]
    if invalid:
        print(f"Unknown state codes: {invalid}")
        print(f"Valid: {sorted(STATES.keys())}")
        sys.exit(1)

    print(f"Downloading {len(targets)} state(s) to {OUTPUT_DIR}/")
    ok = 0
    for i, code in enumerate(targets):
        if i > 0:
            time.sleep(0.5)  # be polite to INEGI servers
        if download_state(code):
            ok += 1

    print(f"\nDone: {ok}/{len(targets)} states")


if __name__ == "__main__":
    main()
