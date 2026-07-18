"""File storage — local disk (dev) or S3-compatible object storage (prod).

Configure S3 via environment variables (all four required to enable S3):
  S3_ENDPOINT    e.g. https://fsn1.your-objectstorage.com
  S3_BUCKET      e.g. refigan-files
  S3_ACCESS_KEY
  S3_SECRET_KEY

When S3_ENDPOINT is not set, files are stored under var/files/ (relative to this module) on local disk.
Files are always served proxied through the API — no public bucket access needed.
"""
import os
from pathlib import Path

_ROOT = Path(__file__).parent / "var" / "files"

_S3_ENDPOINT = os.getenv("S3_ENDPOINT", "")
_S3_BUCKET = os.getenv("S3_BUCKET", "")
_S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY", "")
_S3_SECRET_KEY = os.getenv("S3_SECRET_KEY", "")

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


def stream(key: str) -> tuple[bytes, str]:
    """Return (content, content_type) for a stored file. Raises FileNotFoundError if missing."""
    if s3_enabled():
        from botocore.exceptions import ClientError
        try:
            obj = _s3().get_object(Bucket=_S3_BUCKET, Key=key)
            return obj["Body"].read(), obj.get("ContentType", "application/octet-stream")
        except ClientError as e:
            if e.response["Error"]["Code"] in ("NoSuchKey", "404"):
                raise FileNotFoundError(key)
            raise
    p = _ROOT / key
    if not p.is_file():
        raise FileNotFoundError(key)
    import mimetypes
    content_type = mimetypes.guess_type(str(p))[0] or "application/octet-stream"
    return p.read_bytes(), content_type
