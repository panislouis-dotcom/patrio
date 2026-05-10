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
                      ss.municipio_cve, ss.municipio_name, ss.colonia,
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


def update_signal_geo(signal_id: int, lat: float, lon: float, colonia: str) -> None:
    """Update lat/lon and colonia for a signal. Only overwrites if values are not already set."""
    with get_db() as conn:
        conn.execute(
            """UPDATE sonar_signals
               SET lat     = COALESCE(lat, %s),
                   lon     = COALESCE(lon, %s),
                   colonia = CASE WHEN colonia = '' THEN %s ELSE colonia END
               WHERE id = %s""",
            (lat, lon, colonia, signal_id),
        )


def get_zone_medians() -> dict[str, float]:
    """Return {colonia: median_price_per_sqm} from all historical signals with sqm > 0."""
    with get_db() as conn:
        cur = conn.execute(
            """SELECT colonia, PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price / sqm_land) AS median_ppsqm
               FROM sonar_signals
               WHERE sqm_land > 0 AND colonia != ''
               GROUP BY colonia
               HAVING COUNT(*) >= 3"""
        )
        return {row["colonia"]: float(row["median_ppsqm"]) for row in cur.fetchall()}
