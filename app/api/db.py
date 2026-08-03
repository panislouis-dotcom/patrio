import json
import threading
from contextlib import contextmanager

import psycopg2
import psycopg2.extras
from psycopg2.pool import ThreadedConnectionPool

from api.config import DATABASE_URL, DB_POOL_MIN, DB_POOL_MAX

_pool: ThreadedConnectionPool | None = None
# Gates connection acquisition so at most DB_POOL_MAX callers hold a connection
# at once. psycopg2's ThreadedConnectionPool.getconn() *raises* when exhausted
# rather than waiting; the semaphore makes over-capacity callers block until a
# connection frees, turning a hard 500 ceiling into graceful queueing.
_pool_slots = threading.BoundedSemaphore(DB_POOL_MAX)
_pool_lock = threading.Lock()


def _get_pool() -> ThreadedConnectionPool:
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                _pool = ThreadedConnectionPool(
                    minconn=DB_POOL_MIN,
                    maxconn=DB_POOL_MAX,
                    dsn=DATABASE_URL,
                )
    return _pool


class _ConnProxy:
    """Thin wrapper over a psycopg2 connection that executes SQL via RealDictCursor."""

    def __init__(self, conn):
        self._conn = conn

    def execute(self, sql: str, params=None):
        cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(sql, params or ())
        return cur


@contextmanager
def get_db():
    pool = _get_pool()
    # Block here when DB_POOL_MAX connections are already checked out, instead of
    # letting getconn() raise PoolError. Released in finally, paired 1:1.
    _pool_slots.acquire()
    try:
        conn = pool.getconn()
        try:
            conn.autocommit = False
            yield _ConnProxy(conn)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            pool.putconn(conn)
    finally:
        _pool_slots.release()



def _snake_to_camel(name: str) -> str:
    parts = name.split("_")
    return parts[0] + "".join(p.title() for p in parts[1:])


def _camel_to_snake(name: str) -> str:
    """Convert camelCase to snake_case.

    Examples:
        sqmLand -> sqm_land
        acquisitionCostPct -> acquisition_cost_pct
        name -> name
    """
    result = []
    for i, char in enumerate(name):
        if char.isupper():
            if i > 0:
                result.append("_")
            result.append(char.lower())
        else:
            result.append(char)
    return "".join(result)


def _row_to_dict(row) -> dict | None:
    if row is None:
        return None
    return {_snake_to_camel(k): v for k, v in dict(row).items()}


# ─── Sonar signals ───────────────────────────────

def get_signals(status: str | None = None, portal: str | None = None) -> list[dict]:
    query = "SELECT * FROM signals"
    conditions, params = [], []
    if status:
        conditions.append("status = %s")
        params.append(status)
    if portal:
        conditions.append("portal = %s")
        params.append(portal)
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY scraped_at DESC"
    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()
    return [_row_to_dict(r) for r in rows]


def create_signal(data: dict) -> bool:
    """Insert a signal. Returns True if inserted, False if duplicate (url UNIQUE).
    On duplicate, backfills sqm_land if the existing row has none."""
    sqm = data.get("sqm_land", 0)
    with get_db() as conn:
        cur = conn.execute(
            """INSERT INTO signals (portal, url, title, address, city, price, sqm_land)
               VALUES (%s, %s, %s, %s, %s, %s, %s) ON CONFLICT (url) DO NOTHING""",
            (data["portal"], data["url"], data["title"],
             data.get("address", ""), data.get("city", "Monterrey"),
             data.get("price", 0), sqm)
        )
        is_new = cur.rowcount > 0
        if not is_new and sqm > 0:
            conn.execute(
                "UPDATE signals SET sqm_land = %s WHERE url = %s AND sqm_land = 0",
                (sqm, data["url"])
            )
        return is_new


def update_signal_sqm(url: str, sqm: float) -> None:
    with get_db() as conn:
        conn.execute(
            "UPDATE signals SET sqm_land = %s WHERE url = %s AND sqm_land = 0",
            (sqm, url)
        )


def get_signals_missing_sqm(portals: list[str]) -> list[dict]:
    """Return signals with sqm_land=0 for the given portals."""
    placeholders = ",".join(["%s"] * len(portals))
    with get_db() as conn:
        rows = conn.execute(
            f"SELECT id, url, portal FROM signals WHERE sqm_land = 0 AND portal IN ({placeholders})",
            portals
        ).fetchall()
    return [{"id": r["id"], "url": r["url"], "portal": r["portal"]} for r in rows]


def dismiss_signal(signal_id: int) -> dict | None:
    with get_db() as conn:
        conn.execute(
            "UPDATE signals SET status = 'dismissed' WHERE id = %s", (signal_id,)
        )
    return _get_signal(signal_id)


def import_signal(signal_id: int) -> tuple[dict | None, dict | None]:
    """Capture a signal as a property, in prospecto. Returns (signal, property),
    or (None, None) if there is no such signal. Only the fields the portal
    actually gave us are filled; the rest keep the capture defaults."""
    from api.properties_db import create_property

    signal = _get_signal(signal_id)
    if signal is None:
        return None, None
    captured = create_property({
        "name": signal["title"],
        "address": signal["address"] or signal["title"],
        "city": signal["city"],
        "url": signal["url"],
        "sqmLand": signal.get("sqmLand") or 0.0,
        "purchasePrice": signal.get("price") or 0.0,
    })
    with get_db() as conn:
        conn.execute(
            "UPDATE signals SET status = 'imported', property_id = %s WHERE id = %s",
            (captured["id"], signal_id),
        )
    return _get_signal(signal_id), captured


def _get_signal(signal_id: int) -> dict | None:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM signals WHERE id = %s", (signal_id,)).fetchone()
    return _row_to_dict(row) if row else None


# ─── Team members ─────────────────────────────────

TEAM_RAW_FIELDS = {"name", "role", "managerId", "email", "notes"}


def get_team_members() -> list[dict]:
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM team_members ORDER BY id").fetchall()
    return [_row_to_dict(r) for r in rows]


def get_team_member(member_id: int) -> dict | None:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM team_members WHERE id = %s", (member_id,)).fetchone()
    return _row_to_dict(row) if row else None


def create_team_member(data: dict) -> dict:
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO team_members (name, role, manager_id, email, notes) VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (data["name"], data["role"], data.get("managerId"), data.get("email", ""), data.get("notes", ""))
        )
        member_id = cur.fetchone()["id"]
    return get_team_member(member_id)


def delete_team_member(member_id: int) -> None:
    with get_db() as conn:
        conn.execute("DELETE FROM team_members WHERE id = %s", (member_id,))


def update_team_member(member_id: int, data: dict) -> dict | None:
    filtered = {k: v for k, v in data.items() if k in TEAM_RAW_FIELDS}
    if not filtered:
        return get_team_member(member_id)
    snake = {_camel_to_snake(k): v for k, v in filtered.items()}
    columns = ", ".join(f"{col} = %s" for col in snake.keys())
    values = list(snake.values()) + [member_id]
    with get_db() as conn:
        conn.execute(f"UPDATE team_members SET {columns} WHERE id = %s", values)
    return get_team_member(member_id)


# ─── Comparables ─────────────────────────────────────

COMPARABLE_RAW_FIELDS = {
    "address", "zoneId", "m2", "price", "listingUrl", "sourcePortal",
    "listedAt", "neighborhood", "city", "lat", "lng",
    "bedrooms", "bathrooms", "parkingSpots",
    "propertyType", "condition", "styleTags",
    "status", "soldAt", "notes",
}


def get_comparables(
    status: str | None = None,
    zone_id: int | None = None,
) -> list[dict]:
    query = "SELECT * FROM comparables"
    conditions, params = [], []
    if status:
        conditions.append("status = %s")
        params.append(status)
    if zone_id:
        conditions.append("zone_id = %s")
        params.append(zone_id)
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY captured_at DESC"
    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()
    return [_parse_comparable(r) for r in rows]


def get_comparable(comparable_id: int) -> dict | None:
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM comparables WHERE id = %s", (comparable_id,)
        ).fetchone()
    return _parse_comparable(row) if row else None


def create_comparable(data: dict) -> dict | None:
    filtered = {k: v for k, v in data.items() if k in COMPARABLE_RAW_FIELDS}
    if not filtered:
        raise ValueError("No valid fields provided for create_comparable")

    snake = {_camel_to_snake(k): v for k, v in filtered.items()}

    # Serialize JSONB fields
    if "style_tags" in snake and not isinstance(snake["style_tags"], str):
        snake["style_tags"] = json.dumps(snake["style_tags"])

    columns = ", ".join(snake.keys())
    placeholders = ", ".join(["%s"] * len(snake))
    values = list(snake.values())
    query = f"INSERT INTO comparables ({columns}) VALUES ({placeholders}) ON CONFLICT (listing_url) DO NOTHING RETURNING id"

    with get_db() as conn:
        cur = conn.execute(query, values)
        row = cur.fetchone()

    if row is None:
        # Duplicate — return existing row
        with get_db() as conn:
            existing = conn.execute(
                "SELECT id FROM comparables WHERE listing_url = %s", (snake.get("listing_url"),)
            ).fetchone()
        return get_comparable(existing["id"]) if existing else None

    return get_comparable(row["id"])


def update_comparable(comparable_id: int, data: dict) -> dict | None:
    filtered = {k: v for k, v in data.items() if k in COMPARABLE_RAW_FIELDS}
    if not filtered:
        return get_comparable(comparable_id)

    snake = {_camel_to_snake(k): v for k, v in filtered.items()}

    # Serialize JSONB fields
    if "style_tags" in snake and not isinstance(snake["style_tags"], str):
        snake["style_tags"] = json.dumps(snake["style_tags"])

    columns = ", ".join(f"{col} = %s" for col in snake.keys())
    values = list(snake.values()) + [comparable_id]
    query = f"UPDATE comparables SET {columns} WHERE id = %s"

    with get_db() as conn:
        conn.execute(query, values)

    return get_comparable(comparable_id)


def delete_comparable(comparable_id: int) -> bool:
    with get_db() as conn:
        cur = conn.execute("DELETE FROM comparables WHERE id = %s", (comparable_id,))
    return cur.rowcount > 0


def _parse_comparable(row) -> dict | None:
    if row is None:
        return None
    d = _row_to_dict(row)
    # Parse JSONB style_tags
    raw_tags = d.get("styleTags")
    if isinstance(raw_tags, str):
        try:
            d["styleTags"] = json.loads(raw_tags)
        except json.JSONDecodeError:
            d["styleTags"] = []
    return d
