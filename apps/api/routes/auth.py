import hashlib

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from api.auth import verify_password, hash_password, create_access_token, get_current_user, generate_api_key
from api.db import get_db

router = APIRouter()


class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/api/auth/login")
def login(body: LoginRequest):
    with get_db() as conn:
        row = conn.execute(
            "SELECT hashed_password FROM users WHERE email = %s AND is_active = TRUE",
            (body.email,),
        ).fetchone()

    if row is None or not verify_password(body.password, dict(row)["hashed_password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales inválidas",
        )

    return {"access_token": create_access_token(body.email), "token_type": "bearer"}


@router.get("/api/auth/me")
def me(current_user: dict = Depends(get_current_user)):
    return current_user


class ChangePasswordRequest(BaseModel):
    currentPassword: str
    newPassword: str = Field(min_length=8)


@router.post("/api/auth/change-password")
def change_password(body: ChangePasswordRequest, current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        row = conn.execute(
            "SELECT hashed_password FROM users WHERE email = %s",
            (current_user["email"],),
        ).fetchone()
    if row is None or not verify_password(body.currentPassword, dict(row)["hashed_password"]):
        raise HTTPException(status_code=400, detail="Contraseña actual incorrecta")
    with get_db() as conn:
        conn.execute(
            "UPDATE users SET hashed_password = %s WHERE email = %s",
            (hash_password(body.newPassword), current_user["email"]),
        )
    return {"ok": True}


# ─── API Keys ────────────────────────────────────────────────────────────────

class CreateApiKeyRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)


@router.post("/api/auth/api-keys", status_code=201)
def create_api_key(body: CreateApiKeyRequest, current_user: dict = Depends(get_current_user)):
    token = generate_api_key()
    key_hash = hashlib.sha256(token.encode()).hexdigest()
    key_prefix = token[:10]
    with get_db() as conn:
        user_row = conn.execute(
            "SELECT id FROM users WHERE email = %s",
            (current_user["email"],),
        ).fetchone()
        if not user_row:
            raise HTTPException(status_code=404, detail="User not found")
        row = conn.execute(
            """INSERT INTO api_keys (user_id, name, key_hash, key_prefix)
               VALUES (%s, %s, %s, %s)
               RETURNING id, name, key_prefix, created_at""",
            (dict(user_row)["id"], body.name, key_hash, key_prefix),
        ).fetchone()
    r = dict(row)
    return {**r, "token": token, "created_at": r["created_at"].isoformat()}


@router.get("/api/auth/api-keys")
def list_api_keys(current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        rows = conn.execute(
            """SELECT ak.id, ak.name, ak.key_prefix, ak.created_at, ak.last_used_at
               FROM api_keys ak
               JOIN users u ON u.id = ak.user_id
               WHERE u.email = %s AND ak.revoked = FALSE
               ORDER BY ak.created_at DESC""",
            (current_user["email"],),
        ).fetchall()
    return [
        {
            "id": r["id"],
            "name": r["name"],
            "key_prefix": r["key_prefix"],
            "created_at": r["created_at"].isoformat(),
            "last_used_at": r["last_used_at"].isoformat() if r["last_used_at"] else None,
        }
        for r in rows
    ]


@router.delete("/api/auth/api-keys/{key_id}", status_code=204)
def revoke_api_key(key_id: int, current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        cur = conn.execute(
            """UPDATE api_keys SET revoked = TRUE
               WHERE id = %s AND user_id = (SELECT id FROM users WHERE email = %s)""",
            (key_id, current_user["email"]),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="API key not found")
