"""File storage — local disk (dev) or S3-compatible object storage (prod).

Configure S3 via environment variables (all four required to enable S3):
  S3_ENDPOINT    e.g. https://fsn1.your-objectstorage.com
  S3_BUCKET      e.g. refigan-files
  S3_ACCESS_KEY
  S3_SECRET_KEY
  S3_PUBLIC_URL  e.g. https://refigan-files.fsn1.your-objectstorage.com  (for redirect-based serving)

When S3_ENDPOINT is not set, files are stored under data/files/ on local disk.
"""
import os
from pathlib import Path

_ROOT = Path(__file__).parent.parent.parent / "data" / "files"

_S3_ENDPOINT = os.getenv("S3_ENDPOINT", "")
_S3_BUCKET = os.getenv("S3_BUCKET", "")
_S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY", "")
_S3_SECRET_KEY = os.getenv("S3_SECRET_KEY", "")
_S3_PUBLIC_URL = os.getenv("S3_PUBLIC_URL", "").rstrip("/")

_client = None


def s3_enabled() -> bool:
    return bool(_S3_ENDPOINT and _S3_BUCKET and _S3_ACCESS_KEY and _S3_SECRET_KEY)


def _s3():
    global _client
    if _client is None:
        import boto3
        from botocore.client import Config
        _client = boto3.client(
            "s3",
            endpoint_url=_S3_ENDPOINT,
            aws_access_key_id=_S3_ACCESS_KEY,
            aws_secret_access_key=_S3_SECRET_KEY,
            config=Config(signature_version="s3v4"),
        )
    return _client


def upload(key: str, content: bytes, content_type: str = "application/octet-stream") -> None:
    """Write bytes to storage under the given relative key."""
    if s3_enabled():
        _s3().put_object(Bucket=_S3_BUCKET, Key=key, Body=content, ContentType=content_type)
    else:
        p = _ROOT / key
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(content)


def delete(key: str) -> None:
    """Remove a file. No-ops if not found."""
    if s3_enabled():
        _s3().delete_object(Bucket=_S3_BUCKET, Key=key)
    else:
        p = _ROOT / key
        if p.exists():
            p.unlink()


def serve_url(key: str) -> str | None:
    """Return a direct S3 public URL for the key, or None when using local disk."""
    if s3_enabled() and _S3_PUBLIC_URL:
        return f"{_S3_PUBLIC_URL}/{key}"
    return None
