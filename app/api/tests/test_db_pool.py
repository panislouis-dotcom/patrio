"""Connection-pool concurrency behavior.

Sync route handlers run in FastAPI's anyio threadpool (default 40 threads), so
many requests can reach the pool at once. psycopg2's ThreadedConnectionPool
*raises* PoolError when all connections are checked out — it does not wait — so
without a gate the (maxconn+1)-th concurrent request would 500. get_db() adds a
BoundedSemaphore so over-capacity callers block until a connection frees.
"""
import threading
import time

import pytest
from psycopg2.pool import PoolError, ThreadedConnectionPool

from api import db
from api.config import DATABASE_URL, DB_POOL_MAX


def test_raw_pool_raises_when_exhausted():
    """Documents the failure mode the semaphore prevents: the raw pool does not
    block — it raises once maxconn connections are held."""
    pool = ThreadedConnectionPool(minconn=1, maxconn=2, dsn=DATABASE_URL)
    held = [pool.getconn(), pool.getconn()]
    try:
        with pytest.raises(PoolError):
            pool.getconn()
    finally:
        for c in held:
            pool.putconn(c)
        pool.closeall()


def test_get_db_queues_instead_of_raising_when_saturated():
    """15 concurrent get_db() callers against a 3-connection pool: all complete,
    none raise, and observed concurrency never exceeds the cap (they queue)."""
    slots = 3
    n = 15
    hold = 0.15

    orig_pool = db._pool
    db._pool = ThreadedConnectionPool(minconn=1, maxconn=slots, dsn=DATABASE_URL)
    db._pool_slots = threading.BoundedSemaphore(slots)

    live = 0
    peak = 0
    lock = threading.Lock()
    errors: list[Exception] = []
    done: list[bool] = []

    def worker():
        nonlocal live, peak
        try:
            with db.get_db() as c:
                with lock:
                    live += 1
                    peak = max(peak, live)
                c.execute("SELECT pg_sleep(%s)", (hold,))
                with lock:
                    live -= 1
            done.append(True)
        except Exception as e:  # noqa: BLE001 — capture for assertion
            errors.append(e)

    threads = [threading.Thread(target=worker) for _ in range(n)]
    start = time.monotonic()
    try:
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)
        elapsed = time.monotonic() - start

        assert errors == [], f"get_db raised under saturation: {errors!r}"
        assert len(done) == n, f"only {len(done)}/{n} callers completed"
        assert peak <= slots, f"concurrency {peak} exceeded pool cap {slots}"
        # n tasks through `slots` at a time, each holding `hold`s, must take at
        # least ~ceil(n/slots)*hold — proof they queued rather than all ran/erred.
        assert elapsed >= (n / slots) * hold * 0.7, f"finished too fast: {elapsed:.3f}s"
    finally:
        # Close both the small test pool and the pre-existing one, then reset the
        # global to None so _get_pool() lazily rebuilds a fresh, full-size pool
        # for later tests. (Restoring the original object is unsafe — it may hold
        # stale/closed connections.)
        db._pool.closeall()
        if orig_pool is not None:
            orig_pool.closeall()
        db._pool = None
        db._pool_slots = threading.BoundedSemaphore(DB_POOL_MAX)
