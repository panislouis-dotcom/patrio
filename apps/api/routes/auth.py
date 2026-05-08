from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from api.auth import verify_password, create_access_token, get_current_user
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
