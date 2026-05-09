import os
import pytest

# Set required env vars before any app code is imported
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost/test_refigan")
os.environ.setdefault("JWT_SECRET", "test-secret-key-for-unit-tests-minimum-32-chars")
