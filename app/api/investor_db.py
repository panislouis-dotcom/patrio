from .db import get_db, _snake_to_camel, _camel_to_snake

INVESTOR_RAW_FIELDS = {"name", "apellidos", "email", "phone", "notes", "temperatura", "capacidad", "fuente", "confianza"}
PROJECT_INVESTOR_RAW_FIELDS = {
    "status", "interestedAmount", "committedAmount", "fundedAmount",
    "interestRateAnnual", "investmentDate", "returnAmount", "returnDate", "notes"
}


def get_investors() -> list[dict]:
    """All investors with aggregated totals across all projects."""
    query = """
    SELECT
      i.*,
      COALESCE(SUM(pi.interested_amount), 0) AS total_interested,
      COALESCE(SUM(pi.committed_amount), 0)  AS total_committed,
      COALESCE(SUM(pi.funded_amount), 0)     AS total_funded
    FROM investors i
    LEFT JOIN project_investors pi ON pi.investor_id = i.id
    GROUP BY i.id
    ORDER BY i.name
    """
    with get_db() as conn:
        rows = conn.execute(query).fetchall()
    return [{_snake_to_camel(k): v for k, v in dict(r).items()} for r in rows]


def get_investor(investor_id: int) -> dict | None:
    """Single investor with list of project positions including computed metrics.

    Returns dict with investor fields + 'positions': list of project_investor_metrics rows.
    Returns None if not found.
    """
    with get_db() as conn:
        investor_row = conn.execute(
            "SELECT * FROM investors WHERE id = %s", (investor_id,)
        ).fetchone()
        if investor_row is None:
            return None
        position_rows = conn.execute(
            """
            SELECT * FROM project_investor_metrics
            WHERE investor_id = %s
            ORDER BY project_id, investment_date
            """,
            (investor_id,),
        ).fetchall()

    investor = {_snake_to_camel(k): v for k, v in dict(investor_row).items()}
    investor["positions"] = [
        {_snake_to_camel(k): v for k, v in dict(r).items()} for r in position_rows
    ]
    investor["totalInterested"] = sum(p.get("interestedAmount") or 0 for p in investor["positions"])
    investor["totalCommitted"] = sum(p.get("committedAmount") or 0 for p in investor["positions"])
    investor["totalFunded"] = sum(p.get("fundedAmount") or 0 for p in investor["positions"])
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
    LEFT JOIN project_investors pi ON pi.investor_id = i.id
    WHERE i.id = %s
    GROUP BY i.id
    """
    with get_db() as conn:
        row = conn.execute(query, (investor_id,)).fetchone()
    if row is None:
        raise ValueError(f"Investor {investor_id} not found")
    return {_snake_to_camel(k): v for k, v in dict(row).items()}


def delete_investor(investor_id: int) -> None:
    """Delete investor (cascades to project_investors)."""
    with get_db() as conn:
        conn.execute("DELETE FROM investors WHERE id = %s", (investor_id,))


def get_project_investors(project_id: int) -> list[dict]:
    """All investor positions for a project with computed return metrics.

    Returns list sorted by status (fondeado first), then name.
    """
    query = """
    SELECT * FROM project_investor_metrics
    WHERE project_id = %s
    ORDER BY
      CASE status WHEN 'fondeado' THEN 0 WHEN 'comprometido' THEN 1 ELSE 2 END,
      investor_name
    """
    with get_db() as conn:
        rows = conn.execute(query, (project_id,)).fetchall()
    return [{_snake_to_camel(k): v for k, v in dict(r).items()} for r in rows]


def add_project_investor(project_id: int, investor_id: int, data: dict) -> dict:
    """Insert a new investment row for a project-investor pair.

    Multiple rows per (project_id, investor_id) are allowed.
    data keys (camelCase): status, interestedAmount, committedAmount, fundedAmount,
    interestRateAnnual, investmentDate, notes.
    Returns the new row joined with investor name.
    """
    filtered = {k: v for k, v in data.items() if k in PROJECT_INVESTOR_RAW_FIELDS}
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
            INSERT INTO project_investors
              (project_id, investor_id, status, interested_amount, committed_amount,
               funded_amount, interest_rate_annual, investment_date, notes)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (project_id, investor_id, status, interested_amount, committed_amount,
             funded_amount, interest_rate_annual, investment_date, notes),
        )
        row_id = cur.fetchone()["id"]

    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM project_investor_metrics WHERE id = %s",
            (row_id,),
        ).fetchone()
    return {_snake_to_camel(k): v for k, v in dict(row).items()}


def update_project_investment(investment_id: int, data: dict) -> dict:
    """Update a single investment row by its id."""
    filtered = {k: v for k, v in data.items() if k in PROJECT_INVESTOR_RAW_FIELDS}
    if filtered:
        snake = {_camel_to_snake(k): v for k, v in filtered.items()}
        columns = ", ".join(f"{col} = %s" for col in snake.keys())
        values = list(snake.values()) + [investment_id]
        with get_db() as conn:
            conn.execute(f"UPDATE project_investors SET {columns} WHERE id = %s", values)

    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM project_investor_metrics WHERE id = %s",
            (investment_id,),
        ).fetchone()
    if row is None:
        raise ValueError(f"Investment {investment_id} not found")
    return {_snake_to_camel(k): v for k, v in dict(row).items()}


def delete_project_investment(investment_id: int) -> None:
    """Delete a single investment row by its id."""
    with get_db() as conn:
        conn.execute("DELETE FROM project_investors WHERE id = %s", (investment_id,))
