from .db import get_db, _snake_to_camel, _camel_to_snake

INVESTOR_RAW_FIELDS = {"name", "email", "phone", "notes"}
PROJECT_INVESTOR_RAW_FIELDS = {
    "status", "interestedAmount", "committedAmount", "fundedAmount",
    "interestRateAnnual", "notes"
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
    """Single investor with list of project positions.

    Returns dict with investor fields + 'positions': [list of project_investors
    joined with project name]. Returns None if not found.
    """
    with get_db() as conn:
        investor_row = conn.execute(
            "SELECT * FROM investors WHERE id = %s", (investor_id,)
        ).fetchone()
        if investor_row is None:
            return None
        position_rows = conn.execute(
            """
            SELECT pi.*, p.name AS project_name
            FROM project_investors pi
            JOIN projects p ON p.id = pi.project_id
            WHERE pi.investor_id = %s
            ORDER BY pi.created_at DESC
            """,
            (investor_id,),
        ).fetchall()

    investor = {_snake_to_camel(k): v for k, v in dict(investor_row).items()}
    investor["positions"] = [
        {_snake_to_camel(k): v for k, v in dict(r).items()} for r in position_rows
    ]
    return investor


def create_investor(data: dict) -> dict:
    """Insert investor. data keys are camelCase. Returns new investor row as camelCase dict."""
    filtered = {k: v for k, v in data.items() if k in INVESTOR_RAW_FIELDS}
    if not filtered:
        raise ValueError("No valid fields provided for create_investor")

    snake = {_camel_to_snake(k): v for k, v in filtered.items()}
    columns = ", ".join(snake.keys())
    placeholders = ", ".join("%s" * len(snake))
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
    """Update allowed fields (name, email, phone, notes). Returns updated row."""
    filtered = {k: v for k, v in data.items() if k in INVESTOR_RAW_FIELDS}
    if not filtered:
        with get_db() as conn:
            row = conn.execute(
                "SELECT * FROM investors WHERE id = %s", (investor_id,)
            ).fetchone()
        return {_snake_to_camel(k): v for k, v in dict(row).items()}

    snake = {_camel_to_snake(k): v for k, v in filtered.items()}
    columns = ", ".join(f"{col} = %s" for col in snake.keys())
    values = list(snake.values()) + [investor_id]

    with get_db() as conn:
        conn.execute(f"UPDATE investors SET {columns} WHERE id = %s", values)
        row = conn.execute("SELECT * FROM investors WHERE id = %s", (investor_id,)).fetchone()
    return {_snake_to_camel(k): v for k, v in dict(row).items()}


def delete_investor(investor_id: int) -> None:
    """Delete investor (cascades to project_investors)."""
    with get_db() as conn:
        conn.execute("DELETE FROM investors WHERE id = %s", (investor_id,))


def get_project_investors(project_id: int) -> list[dict]:
    """All investor positions for a project, joined with investor name.

    Returns list sorted by status (fondeado first), then name.
    """
    query = """
    SELECT pi.*, i.name AS investor_name
    FROM project_investors pi
    JOIN investors i ON i.id = pi.investor_id
    WHERE pi.project_id = %s
    ORDER BY
      CASE pi.status WHEN 'fondeado' THEN 0 WHEN 'comprometido' THEN 1 ELSE 2 END,
      i.name
    """
    with get_db() as conn:
        rows = conn.execute(query, (project_id,)).fetchall()
    return [{_snake_to_camel(k): v for k, v in dict(r).items()} for r in rows]


def upsert_project_investor(project_id: int, investor_id: int, data: dict) -> dict:
    """INSERT OR REPLACE for a project-investor pair.

    data keys: status, interestedAmount, committedAmount, fundedAmount,
    interestRateAnnual, notes. Returns the upserted row joined with investor name.
    """
    filtered = {k: v for k, v in data.items() if k in PROJECT_INVESTOR_RAW_FIELDS}
    snake = {_camel_to_snake(k): v for k, v in filtered.items()}

    status = snake.get("status", "interesado")
    interested_amount = snake.get("interested_amount", 0)
    committed_amount = snake.get("committed_amount", 0)
    funded_amount = snake.get("funded_amount", 0)
    interest_rate_annual = snake.get("interest_rate_annual", 0.12)
    notes = snake.get("notes", "")

    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO project_investors
              (project_id, investor_id, status, interested_amount, committed_amount,
               funded_amount, interest_rate_annual, notes)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (project_id, investor_id) DO UPDATE SET
              status               = EXCLUDED.status,
              interested_amount    = EXCLUDED.interested_amount,
              committed_amount     = EXCLUDED.committed_amount,
              funded_amount        = EXCLUDED.funded_amount,
              interest_rate_annual = EXCLUDED.interest_rate_annual,
              notes                = EXCLUDED.notes
            """,
            (project_id, investor_id, status, interested_amount, committed_amount,
             funded_amount, interest_rate_annual, notes),
        )

    # Re-fetch joined with investor name
    with get_db() as conn:
        row = conn.execute(
            """
            SELECT pi.*, i.name AS investor_name
            FROM project_investors pi
            JOIN investors i ON i.id = pi.investor_id
            WHERE pi.project_id = %s AND pi.investor_id = %s
            """,
            (project_id, investor_id),
        ).fetchone()
    return {_snake_to_camel(k): v for k, v in dict(row).items()}


def delete_project_investor(project_id: int, investor_id: int) -> None:
    """Delete a project-investor position."""
    with get_db() as conn:
        conn.execute(
            "DELETE FROM project_investors WHERE project_id = %s AND investor_id = %s",
            (project_id, investor_id),
        )
