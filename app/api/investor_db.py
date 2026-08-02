from .db import get_db, _snake_to_camel, _camel_to_snake
from api.finance import investor as fin_investor

INVESTOR_RAW_FIELDS = {"name", "apellidos", "email", "phone", "notes", "temperatura", "capacidad", "fuente", "confianza"}
PROPERTY_INVESTOR_RAW_FIELDS = {
    "status", "interestedAmount", "committedAmount", "fundedAmount",
    "interestRateAnnual", "investmentDate", "returnAmount", "returnDate", "notes"
}

# Base-table join replacing the dropped project_investor_metrics view; return
# metrics (holdMonths / interestAmount / expectedReturn / returnPct) computed in Python.
_POSITION_SELECT = """
SELECT pi.*,
       i.name || CASE WHEN COALESCE(i.apellidos, '') != '' THEN ' ' || i.apellidos ELSE '' END AS investor_name,
       p.name AS property_name,
       p.acquisition_date AS acquisition_date_raw,
       COALESCE(p.sale_date, p.first_rent_date) AS conclusion_date_raw
FROM property_investors pi
JOIN properties p ON p.id = pi.property_id
JOIN investors i ON i.id = pi.investor_id
"""


def _parse_position(r) -> dict:
    d = {_snake_to_camel(k): v for k, v in dict(r).items()}
    acq = d.pop("acquisitionDateRaw", None)
    conc = d.pop("conclusionDateRaw", None)
    hm = fin_investor.hold_months(acq, conc)
    funded = d.get("fundedAmount") or 0
    rate = d.get("interestRateAnnual") or 0
    d["holdMonths"] = hm
    d["interestAmount"] = fin_investor.cuota(funded, rate, hm)
    d["expectedReturn"] = fin_investor.expected_return(funded, rate, hm)
    d["returnPct"] = fin_investor.return_pct(rate, hm)
    return d


def _get_position(investment_id: int) -> dict | None:
    with get_db() as conn:
        row = conn.execute(_POSITION_SELECT + " WHERE pi.id = %s", (investment_id,)).fetchone()
    return _parse_position(row) if row else None


def get_investors() -> list[dict]:
    """All investors with aggregated totals across every property."""
    query = """
    SELECT
      i.*,
      COALESCE(SUM(pi.interested_amount), 0) AS total_interested,
      COALESCE(SUM(pi.committed_amount), 0)  AS total_committed,
      COALESCE(SUM(pi.funded_amount), 0)     AS total_funded
    FROM investors i
    LEFT JOIN property_investors pi ON pi.investor_id = i.id
    GROUP BY i.id
    ORDER BY i.name
    """
    with get_db() as conn:
        rows = conn.execute(query).fetchall()
    return [{_snake_to_camel(k): v for k, v in dict(r).items()} for r in rows]


def get_investor(investor_id: int) -> dict | None:
    """Single investor with their positions, each with computed metrics.

    Returns dict with investor fields + 'positions'.
    Returns None if not found.
    """
    with get_db() as conn:
        investor_row = conn.execute(
            "SELECT * FROM investors WHERE id = %s", (investor_id,)
        ).fetchone()
        if investor_row is None:
            return None
        position_rows = conn.execute(
            _POSITION_SELECT + " WHERE pi.investor_id = %s ORDER BY pi.property_id, pi.investment_date",
            (investor_id,),
        ).fetchall()

    investor = {_snake_to_camel(k): v for k, v in dict(investor_row).items()}
    investor["positions"] = [_parse_position(r) for r in position_rows]
    investor.update(fin_investor.totals(investor["positions"]))
    return investor


def create_investor(data: dict) -> dict:
    """Insert investor. data keys are camelCase. Returns new investor row as camelCase dict."""
    filtered = {k: v for k, v in data.items() if k in INVESTOR_RAW_FIELDS}
    if not filtered:
        raise ValueError("No valid fields provided for create_investor")

    snake = {_camel_to_snake(k): v for k, v in filtered.items()}
    columns = ", ".join(snake.keys())
    placeholders = ", ".join(["%s"] * len(snake))
    values = list(snake.values())

    with get_db() as conn:
        cur = conn.execute(
            f"INSERT INTO investors ({columns}) VALUES ({placeholders}) RETURNING id", values
        )
        investor_id = cur.fetchone()["id"]

    with get_db() as conn:
        row = conn.execute("SELECT * FROM investors WHERE id = %s", (investor_id,)).fetchone()
    return {_snake_to_camel(k): v for k, v in dict(row).items()}


def update_investor(investor_id: int, data: dict) -> dict:
    """Update allowed fields. Returns updated row with aggregated totals."""
    filtered = {k: v for k, v in data.items() if k in INVESTOR_RAW_FIELDS}
    if filtered:
        snake = {_camel_to_snake(k): v for k, v in filtered.items()}
        columns = ", ".join(f"{col} = %s" for col in snake.keys())
        values = list(snake.values()) + [investor_id]
        with get_db() as conn:
            conn.execute(f"UPDATE investors SET {columns} WHERE id = %s", values)

    query = """
    SELECT
      i.*,
      COALESCE(SUM(pi.interested_amount), 0) AS total_interested,
      COALESCE(SUM(pi.committed_amount), 0)  AS total_committed,
      COALESCE(SUM(pi.funded_amount), 0)     AS total_funded
    FROM investors i
    LEFT JOIN property_investors pi ON pi.investor_id = i.id
    WHERE i.id = %s
    GROUP BY i.id
    """
    with get_db() as conn:
        row = conn.execute(query, (investor_id,)).fetchone()
    if row is None:
        raise ValueError(f"Investor {investor_id} not found")
    return {_snake_to_camel(k): v for k, v in dict(row).items()}


def delete_investor(investor_id: int) -> None:
    """Delete investor (cascades to property_investors)."""
    with get_db() as conn:
        conn.execute("DELETE FROM investors WHERE id = %s", (investor_id,))


def get_property_investors(property_id: int) -> list[dict]:
    """All investor positions for a property with computed return metrics.

    Returns list sorted by status (fondeado first), then name.
    """
    query = _POSITION_SELECT + """
    WHERE pi.property_id = %s
    ORDER BY
      CASE pi.status WHEN 'fondeado' THEN 0 WHEN 'comprometido' THEN 1 ELSE 2 END,
      investor_name
    """
    with get_db() as conn:
        rows = conn.execute(query, (property_id,)).fetchall()
    return [_parse_position(r) for r in rows]


def add_property_investor(property_id: int, investor_id: int, data: dict) -> dict:
    """Insert a new investment row for a property-investor pair.

    Multiple rows per (property_id, investor_id) are allowed.
    data keys (camelCase): status, interestedAmount, committedAmount, fundedAmount,
    interestRateAnnual, investmentDate, notes.
    Returns the new row joined with investor name.
    """
    filtered = {k: v for k, v in data.items() if k in PROPERTY_INVESTOR_RAW_FIELDS}
    snake = {_camel_to_snake(k): v for k, v in filtered.items()}

    status = snake.get("status", "interesado")
    interested_amount = snake.get("interested_amount", 0)
    committed_amount = snake.get("committed_amount", 0)
    funded_amount = snake.get("funded_amount", 0)
    interest_rate_annual = snake.get("interest_rate_annual", 0.12)
    investment_date = snake.get("investment_date")
    notes = snake.get("notes", "")

    with get_db() as conn:
        cur = conn.execute(
            """
            INSERT INTO property_investors
              (property_id, investor_id, status, interested_amount, committed_amount,
               funded_amount, interest_rate_annual, investment_date, notes)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (property_id, investor_id, status, interested_amount, committed_amount,
             funded_amount, interest_rate_annual, investment_date, notes),
        )
        row_id = cur.fetchone()["id"]

    return _get_position(row_id)


def update_property_investment(investment_id: int, data: dict) -> dict:
    """Update a single investment row by its id."""
    filtered = {k: v for k, v in data.items() if k in PROPERTY_INVESTOR_RAW_FIELDS}
    if filtered:
        snake = {_camel_to_snake(k): v for k, v in filtered.items()}
        columns = ", ".join(f"{col} = %s" for col in snake.keys())
        values = list(snake.values()) + [investment_id]
        with get_db() as conn:
            conn.execute(f"UPDATE property_investors SET {columns} WHERE id = %s", values)

    row = _get_position(investment_id)
    if row is None:
        raise ValueError(f"Investment {investment_id} not found")
    return row


def delete_property_investment(investment_id: int) -> None:
    """Delete a single investment row by its id."""
    with get_db() as conn:
        conn.execute("DELETE FROM property_investors WHERE id = %s", (investment_id,))
