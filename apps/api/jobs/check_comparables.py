"""
Biweekly job: verify that active comparable listings are still live.

For each comparable with status='active':
  1. GET the listing_url
  2. 404 or redirect to portal home → mark as 'sold'
  3. 200 + page contains 'vendido'/'sold'/'no disponible' → mark as 'sold'
  4. 200 + listing still active → update last_checked_at and last_seen_active
  5. 3 consecutive failures (timeout/error) → mark as 'withdrawn'

Every check is logged in comparable_check_log for debugging.

Run: PYTHONPATH=.:apps python -m api.jobs.check_comparables
Cron: 0 6 1,15 * *   (1st and 15th of each month at 6 AM)
"""

import sys
import time
from datetime import datetime, timezone
from urllib.parse import urlparse

import httpx

from api.db import get_db

SOLD_KEYWORDS = [
    "vendido", "vendida", "sold", "no disponible", "ya no está disponible",
    "propiedad no encontrada", "anuncio finalizado", "listing removed",
]

REQUEST_TIMEOUT = 15  # seconds
DELAY_BETWEEN_REQUESTS = 2  # seconds, be polite to portals


def _is_redirect_to_home(response: httpx.Response) -> bool:
    """Check if we got redirected to the portal's home page."""
    if not response.history:
        return False
    final_path = urlparse(str(response.url)).path
    return final_path in ("", "/", "/inicio", "/home")


def _page_indicates_sold(html: str) -> bool:
    lower = html.lower()
    return any(kw in lower for kw in SOLD_KEYWORDS)


def _log_check(conn, comparable_id: int, http_status: int | None, result: str, detail: str = ""):
    conn.execute(
        """INSERT INTO comparable_check_log
           (comparable_id, http_status, result, detail)
           VALUES (%s, %s, %s, %s)""",
        (comparable_id, http_status, result, detail),
    )


def check_all():
    now = datetime.now(timezone.utc)
    checked, sold, withdrawn, errors = 0, 0, 0, 0

    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, listing_url, check_failure_count FROM comparables WHERE status = 'active'"
        ).fetchall()

    print(f"[check_comparables] {len(rows)} active comparables to verify")

    for row in rows:
        cid = row["id"]
        url = row["listing_url"]
        failures = row["check_failure_count"]
        checked += 1

        try:
            with httpx.Client(follow_redirects=True, timeout=REQUEST_TIMEOUT) as client:
                resp = client.get(url, headers={"User-Agent": "Patrio/1.0 listing-checker"})

            if resp.status_code == 404 or _is_redirect_to_home(resp):
                # Listing removed → likely sold
                with get_db() as conn:
                    conn.execute(
                        """UPDATE comparables
                           SET status = 'sold', sold_at = %s,
                               last_checked_at = %s, check_failure_count = 0
                           WHERE id = %s""",
                        (now, now, cid),
                    )
                    _log_check(conn, cid, resp.status_code, "sold", "404 or redirect to home")
                sold += 1

            elif resp.status_code == 200 and _page_indicates_sold(resp.text):
                with get_db() as conn:
                    conn.execute(
                        """UPDATE comparables
                           SET status = 'sold', sold_at = %s,
                               last_checked_at = %s, check_failure_count = 0
                           WHERE id = %s""",
                        (now, now, cid),
                    )
                    _log_check(conn, cid, 200, "sold", "page contains sold keyword")
                sold += 1

            elif resp.status_code == 200:
                # Still active
                with get_db() as conn:
                    conn.execute(
                        """UPDATE comparables
                           SET last_checked_at = %s, last_seen_active = %s,
                               check_failure_count = 0
                           WHERE id = %s""",
                        (now, now, cid),
                    )
                    _log_check(conn, cid, 200, "active")

            else:
                # Unexpected status code — treat as error
                new_failures = failures + 1
                with get_db() as conn:
                    if new_failures >= 3:
                        conn.execute(
                            """UPDATE comparables
                               SET status = 'withdrawn', last_checked_at = %s,
                                   check_failure_count = %s
                               WHERE id = %s""",
                            (now, new_failures, cid),
                        )
                        _log_check(conn, cid, resp.status_code, "error",
                                   f"status {resp.status_code}, {new_failures} consecutive failures → withdrawn")
                        withdrawn += 1
                    else:
                        conn.execute(
                            """UPDATE comparables
                               SET last_checked_at = %s, check_failure_count = %s
                               WHERE id = %s""",
                            (now, new_failures, cid),
                        )
                        _log_check(conn, cid, resp.status_code, "error",
                                   f"status {resp.status_code}, failure {new_failures}/3")
                    errors += 1

        except (httpx.TimeoutException, httpx.ConnectError, httpx.RequestError) as exc:
            new_failures = failures + 1
            result = "timeout" if isinstance(exc, httpx.TimeoutException) else "error"
            with get_db() as conn:
                if new_failures >= 3:
                    conn.execute(
                        """UPDATE comparables
                           SET status = 'withdrawn', last_checked_at = %s,
                               check_failure_count = %s
                           WHERE id = %s""",
                        (now, new_failures, cid),
                    )
                    _log_check(conn, cid, None, result,
                               f"{type(exc).__name__}: {exc}, {new_failures} failures → withdrawn")
                    withdrawn += 1
                else:
                    conn.execute(
                        """UPDATE comparables
                           SET last_checked_at = %s, check_failure_count = %s
                           WHERE id = %s""",
                        (now, new_failures, cid),
                    )
                    _log_check(conn, cid, None, result,
                               f"{type(exc).__name__}: {exc}, failure {new_failures}/3")
                errors += 1

        time.sleep(DELAY_BETWEEN_REQUESTS)

    print(f"[check_comparables] Done: {checked} checked, {sold} sold, "
          f"{withdrawn} withdrawn, {errors} errors")


def expire_stale():
    """Mark comparables as expired if not seen active for 11 months."""
    with get_db() as conn:
        cur = conn.execute(
            """UPDATE comparables
               SET status = 'expired'
               WHERE status = 'active'
                 AND last_seen_active < NOW() - INTERVAL '11 months'
               RETURNING id"""
        )
        expired = cur.fetchall()

    if expired:
        print(f"[expire_stale] Expired {len(expired)} comparables: {[r['id'] for r in expired]}")
    else:
        print("[expire_stale] No comparables to expire")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "expire":
        expire_stale()
    else:
        check_all()
        expire_stale()
