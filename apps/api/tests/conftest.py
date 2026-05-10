import os
from pathlib import Path

# Load DATABASE_URL from .env if not set in environment
_env_file = Path(__file__).parent.parent.parent.parent / ".env"
if _env_file.exists() and "DATABASE_URL" not in os.environ:
    for _line in _env_file.read_text().splitlines():
        if _line.startswith("DATABASE_URL="):
            os.environ["DATABASE_URL"] = _line.split("=", 1)[1].strip()
            break

os.environ.setdefault("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/refigan")
os.environ.setdefault("JWT_SECRET", "test-secret-key-for-unit-tests-minimum-32-chars")
