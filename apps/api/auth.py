import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

from api.config import JWT_SECRET as _SECRET

_ALGORITHM = "HS256"
_EXPIRE_HOURS = 8

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
_oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def hash_password(plain: str) -> str:
    return _pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return _pwd_context.verify(plain, hashed)


def create_access_token(email: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=_EXPIRE_HOURS)
    return jwt.encode({"sub": email, "exp": expire}, _SECRET, algorithm=_ALGORITHM)


def generate_api_key() -> str:
    return "rfg_live_" + secrets.token_hex(32)


def _auth_api_key(token: str, exc: HTTPException) -> dict:
    from api.db import get_db
    key_hash = hashlib.sha256(token.encode()).hexdigest()
    with get_db() as conn:
        row = conn.execute(
            """SELECT ak.id, u.email FROM api_keys ak
               JOIN users u ON u.id = ak.user_id
               WHERE ak.key_hash = %s AND ak.revoked = FALSE""",
            (key_hash,),
        ).fetchone()
    if not row:
        raise exc
    row = dict(row)
    try:
        from api.db import get_db as _gdb
        with _gdb() as conn:
            conn.execute(
                "UPDATE api_keys SET last_used_at = NOW() WHERE id = %s",
                (row["id"],),
            )
    except Exception:
        pass
    return {"email": row["email"]}


def get_current_user(token: str = Depends(_oauth2_scheme)) -> dict:
    exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if token.startswith("rfg_live_"):
        return _auth_api_key(token, exc)
    try:
        payload = jwt.decode(token, _SECRET, algorithms=[_ALGORITHM])
        email: str | None = payload.get("sub")
        if not email:
            raise exc
    except JWTError:
        raise exc
    return {"email": email}
