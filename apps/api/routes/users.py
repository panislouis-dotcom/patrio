from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from api.auth import get_current_user, hash_password
from api.db import get_db

router = APIRouter()


class UserCreate(BaseModel):
    email: str
    password: str


class UserUpdate(BaseModel):
    isActive: Optional[bool] = None
    password: Optional[str] = None


def _to_dict(row) -> dict:
    d = dict(row)
    return {
        "id": d["id"],
        "email": d["email"],
        "isActive": d["is_active"],
        "createdAt": d["created_at"].isoformat() if d["created_at"] else None,
    }


@router.get("/api/users")
def list_users(_: dict = Depends(get_current_user)):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, email, is_active, created_at FROM users ORDER BY created_at"
        ).fetchall()
    return [_to_dict(r) for r in rows]


@router.post("/api/users", status_code=201)
def create_user(body: UserCreate, _: dict = Depends(get_current_user)):
    with get_db() as conn:
        if conn.execute("SELECT id FROM users WHERE email = %s", (body.email,)).fetchone():
            raise HTTPException(status_code=409, detail="Email ya existe")
        cur = conn.execute(
            "INSERT INTO users (email, hashed_password, is_active) VALUES (%s, %s, TRUE)"
            " RETURNING id, email, is_active, created_at",
            (body.email, hash_password(body.password)),
        )
        return _to_dict(cur.fetchone())


@router.patch("/api/users/{user_id}")
def update_user(user_id: int, body: UserUpdate, current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, email, is_active, created_at FROM users WHERE id = %s", (user_id,)
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Usuario no encontrado")
        if body.isActive is False and dict(row)["email"] == current_user["email"]:
            raise HTTPException(status_code=400, detail="No puedes desactivar tu propia cuenta")
        if body.isActive is not None:
            conn.execute("UPDATE users SET is_active = %s WHERE id = %s", (body.isActive, user_id))
        if body.password:
            conn.execute(
                "UPDATE users SET hashed_password = %s WHERE id = %s",
                (hash_password(body.password), user_id),
            )
        row = conn.execute(
            "SELECT id, email, is_active, created_at FROM users WHERE id = %s", (user_id,)
        ).fetchone()
    return _to_dict(row)


@router.delete("/api/users/{user_id}", status_code=204)
def delete_user(user_id: int, current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        row = conn.execute("SELECT email FROM users WHERE id = %s", (user_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Usuario no encontrado")
        if dict(row)["email"] == current_user["email"]:
            raise HTTPException(status_code=400, detail="No puedes eliminar tu propia cuenta")
        conn.execute("DELETE FROM users WHERE id = %s", (user_id,))
