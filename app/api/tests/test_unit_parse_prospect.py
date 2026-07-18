"""Unit tests for the SSRF guard in api.parse_prospect — no DB, no real HTTP."""
from unittest.mock import patch

from api.parse_prospect import _fetch_url_text, _is_safe_url


def _addrinfo(ip: str):
    """Fake socket.getaddrinfo result yielding a single resolved IP."""
    return [(2, 1, 6, "", (ip, 80))]


# ── _is_safe_url ─────────────────────────────────────────────────────────────

def test_rejects_non_http_scheme():
    assert _is_safe_url("file:///etc/passwd") is False
    assert _is_safe_url("ftp://example.com/x") is False
    assert _is_safe_url("gopher://example.com") is False


def test_rejects_missing_host():
    assert _is_safe_url("http://") is False


def test_rejects_loopback():
    with patch("api.parse_prospect.socket.getaddrinfo", return_value=_addrinfo("127.0.0.1")):
        assert _is_safe_url("http://localhost/") is False


def test_rejects_private_rfc1918():
    for ip in ("10.0.0.1", "172.16.5.4", "192.168.1.10"):
        with patch("api.parse_prospect.socket.getaddrinfo", return_value=_addrinfo(ip)):
            assert _is_safe_url(f"http://internal.example/{ip}") is False


def test_rejects_cloud_metadata_ip():
    # 169.254.169.254 is link-local — the AWS/GCP/Azure metadata endpoint.
    with patch("api.parse_prospect.socket.getaddrinfo", return_value=_addrinfo("169.254.169.254")):
        assert _is_safe_url("http://metadata.internal/") is False


def test_rejects_ipv6_loopback():
    with patch("api.parse_prospect.socket.getaddrinfo", return_value=_addrinfo("::1")):
        assert _is_safe_url("http://[::1]/") is False


def test_rejects_unresolvable_host():
    with patch("api.parse_prospect.socket.getaddrinfo", side_effect=OSError("no such host")):
        assert _is_safe_url("http://does-not-exist.invalid/") is False


def test_allows_public_ip():
    with patch("api.parse_prospect.socket.getaddrinfo", return_value=_addrinfo("93.184.216.34")):
        assert _is_safe_url("https://example.com/listing/123") is True


# ── _fetch_url_text integration with the guard ───────────────────────────────

def test_fetch_blocks_private_url_returns_empty():
    with patch("api.parse_prospect.socket.getaddrinfo", return_value=_addrinfo("127.0.0.1")):
        assert _fetch_url_text("http://localhost:8000/admin") == ""


def test_fetch_blocks_redirect_to_internal():
    """A safe public URL that 302-redirects to an internal address is blocked
    at the second hop and never fetched."""

    class _Resp:
        def __init__(self, is_redirect, location=None, text=""):
            self.is_redirect = is_redirect
            self.headers = {"location": location} if location else {}
            self.text = text
            self.url = _FakeURL()

        def raise_for_status(self):
            pass

    class _FakeURL:
        def join(self, loc):
            return loc

    hops = iter([
        _Resp(True, location="http://169.254.169.254/latest/meta-data/"),
    ])

    class _Client:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def get(self, url):
            return next(hops)

    def fake_safe(url):
        # public host safe, metadata IP host unsafe
        return "169.254" not in url

    with patch("api.parse_prospect.httpx.Client", _Client), \
         patch("api.parse_prospect._is_safe_url", side_effect=fake_safe):
        assert _fetch_url_text("https://listing.example.com/x") == ""


def test_fetch_public_url_returns_text():
    """A public URL with no redirect yields cleaned page text."""

    class _Resp:
        is_redirect = False
        text = "<html><body><script>x</script>Casa en venta 350 m2</body></html>"
        url = None

        def raise_for_status(self):
            pass

    class _Client:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def get(self, url):
            return _Resp()

    with patch("api.parse_prospect.httpx.Client", _Client), \
         patch("api.parse_prospect._is_safe_url", return_value=True):
        out = _fetch_url_text("https://listing.example.com/x")
    assert "Casa en venta 350 m2" in out
    assert "script" not in out
