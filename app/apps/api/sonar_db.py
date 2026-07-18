from api.db import get_db


def create_scan(cves: list[str] | None) -> int:
    """Insert a new scan record. Returns the scan id."""
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO sonar_scans (cves) VALUES (%s) RETURNING id",
            (cves,),
        )
        return cur.fetchone()["id"]


def complete_scan(scan_id: int, found: int, skipped: int, enriched: int) -> None:
    """Mark scan as completed with counts."""
    with get_db() as conn:
        conn.execute(
            """UPDATE sonar_scans
               SET completed_at = NOW(), found = %s, skipped = %s, enriched = %s
               WHERE id = %s""",
            (found, skipped, enriched, scan_id),
        )


def upsert_signal(
    url: str,
    portal: str,
    title: str,
    address: str,
    municipio_cve: str,
    municipio_name: str,
    price: float,
    sqm_land: float,
    lat: float | None = None,
    lon: float | None = None,
) -> int:
    """Upsert a signal by url. Returns signal id. Records price history."""
    with get_db() as conn:
        cur = conn.execute(
            """INSERT INTO sonar_signals
                   (url, portal, title, address, municipio_cve, municipio_name,
                    price, sqm_land, lat, lon)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (url) DO UPDATE SET
                   last_seen_at   = NOW(),
                   last_price     = sonar_signals.price,
                   price          = EXCLUDED.price,
                   sqm_land       = CASE WHEN EXCLUDED.sqm_land > 0
                                         THEN EXCLUDED.sqm_land
                                         ELSE sonar_signals.sqm_land END,
                   title          = EXCLUDED.title,
                   address        = EXCLUDED.address,
                   municipio_cve  = EXCLUDED.municipio_cve,
                   municipio_name = EXCLUDED.municipio_name,
                   lat            = COALESCE(EXCLUDED.lat, sonar_signals.lat),
                   lon            = COALESCE(EXCLUDED.lon, sonar_signals.lon)
               RETURNING id""",
            (url, portal, title, address, municipio_cve, municipio_name,
             price, sqm_land, lat, lon),
        )
        return cur.fetchone()["id"]


def link_signals_to_scan(scan_id: int, rows: list[tuple[int, float]]) -> None:
    """Bulk insert (signal_id, price_at_scan) pairs into sonar_scan_signals."""
    if not rows:
        return
    with get_db() as conn:
        for sid, price in rows:
            conn.execute(
                "INSERT INTO sonar_scan_signals (scan_id, signal_id, price_at_scan) VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
                (scan_id, sid, price),
            )


def get_latest_scan_signals() -> list[dict]:
    """Return all signals from the most recently completed scan."""
    with get_db() as conn:
        cur = conn.execute(
            """SELECT ss.id, ss.url, ss.portal, ss.title, ss.address,
                      ss.municipio_cve, ss.municipio_name, ss.colonia, ss.state_name,
                      ss.lat, ss.lon, ss.price, ss.sqm_land,
                      ss.first_seen_at, ss.last_seen_at, ss.last_price
               FROM sonar_signals ss
               JOIN sonar_scan_signals sss ON sss.signal_id = ss.id
               WHERE sss.scan_id = (
                   SELECT id FROM sonar_scans
                   WHERE completed_at IS NOT NULL
                   ORDER BY completed_at DESC
                   LIMIT 1
               )
               ORDER BY ss.price DESC"""
        )
        return [dict(row) for row in cur.fetchall()]


def get_all_signals() -> list[dict]:
    """Return all signals with address and municipio_cve, for re-geocodification."""
    with get_db() as conn:
        cur = conn.execute(
            "SELECT id, address, municipio_cve FROM sonar_signals WHERE address != '' ORDER BY id"
        )
        return [dict(row) for row in cur.fetchall()]


def delete_signal(signal_id: int) -> None:
    """Delete a signal confirmed out-of-zone after geocoding."""
    with get_db() as conn:
        conn.execute("DELETE FROM sonar_signals WHERE id = %s", (signal_id,))


def update_signal_geo(
    signal_id: int,
    lat: float,
    lon: float,
    colonia: str,
    state_name: str = "",
    municipio_name: str = "",
    municipio_cve: str = "",
) -> None:
    """Update geo fields for a signal.
    state_name is always overwritten. municipio_name and municipio_cve are only
    overwritten when non-empty, preserving scraper-assigned values when Nominatim
    cannot resolve them."""
    with get_db() as conn:
        conn.execute(
            """UPDATE sonar_signals
               SET lat            = %s,
                   lon            = %s,
                   colonia        = CASE WHEN %s != '' THEN %s ELSE colonia END,
                   state_name     = %s,
                   municipio_name = CASE WHEN %s != '' THEN %s ELSE municipio_name END,
                   municipio_cve  = CASE WHEN %s != '' THEN %s ELSE municipio_cve  END
               WHERE id = %s""",
            (lat, lon,
             colonia, colonia,
             state_name,
             municipio_name, municipio_name,
             municipio_cve, municipio_cve,
             signal_id),
        )


def get_zone_medians() -> dict[str, float]:
    """Return {municipio_name: median_price_per_sqm} from all historical signals with sqm > 0."""
    with get_db() as conn:
        cur = conn.execute(
            """SELECT municipio_name,
                      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price / sqm_land) AS median_ppsqm
               FROM sonar_signals
               WHERE sqm_land > 0 AND municipio_name != ''
               GROUP BY municipio_name
               HAVING COUNT(*) >= 3"""
        )
        return {row["municipio_name"]: float(row["median_ppsqm"]) for row in cur.fetchall()}
