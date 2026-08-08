"""Unit tests for normalize_orientation — no DB, no client, straight function
calls on synthetic images built with Pillow."""
import io

import pytest
from PIL import Image, ImageOps

from api.lib.images import normalize_orientation

_ORIENTATION = 0x0112

# Orientation values that imply a real transform, and whether that transform
# swaps the axes (5-8 rotate/transpose, 2-4 only flip).
_SWAPS_AXES = {5: True, 6: True, 7: True, 8: True, 2: False, 3: False, 4: False}


def _quadrants(size=(40, 20)):
    """An image whose four quadrants are distinct solid colors — asymmetric on
    both axes, so any of the eight EXIF transforms yields a different result."""
    w, h = size
    img = Image.new("RGB", size)
    colors = [(220, 30, 30), (30, 220, 30), (30, 30, 220), (220, 220, 30)]
    for color, origin in zip(colors, [(0, 0), (w // 2, 0), (0, h // 2), (w // 2, h // 2)]):
        img.paste(Image.new("RGB", (w // 2, h // 2), color), origin)
    return img


def _quadrant_colors(img):
    w, h = img.size
    return [img.getpixel(p) for p in
            [(w // 4, h // 4), (3 * w // 4, h // 4), (w // 4, 3 * h // 4), (3 * w // 4, 3 * h // 4)]]


def _assert_same_pixels(actual, expected, tol=12):
    """Quadrant centers must match within JPEG/WEBP recompression noise."""
    assert actual.size == expected.size
    for got, want in zip(_quadrant_colors(actual), _quadrant_colors(expected)):
        assert all(abs(g - w) <= tol for g, w in zip(got, want)), f"{got} != {want}"


def _encode(img, fmt, orientation=None, **extra):
    buf = io.BytesIO()
    if orientation is not None:
        exif = Image.Exif()
        exif[_ORIENTATION] = orientation
        extra["exif"] = exif
    img.save(buf, format=fmt, **extra)
    return buf.getvalue()


def _animated(fmt, orientation=None):
    frames = [Image.new("RGB", (20, 10), c) for c in [(255, 0, 0), (0, 255, 0), (0, 0, 255)]]
    if fmt == "GIF":
        frames = [f.convert("P") for f in frames]
    extra = {}
    if orientation is not None:
        exif = Image.Exif()
        exif[_ORIENTATION] = orientation
        extra["exif"] = exif
    buf = io.BytesIO()
    frames[0].save(buf, format=fmt, save_all=True, append_images=frames[1:], duration=100, **extra)
    return buf.getvalue()


def _reopen(content):
    return Image.open(io.BytesIO(content))


# ── The fix: a rotated photo gets its rotation baked into the pixels ──────────

def test_orientation_6_bakes_rotation_into_pixels():
    content = _encode(_quadrants(), "JPEG", orientation=6, quality=95)
    assert _reopen(content).size == (40, 20)

    result = _reopen(normalize_orientation(content))

    assert result.size == (20, 40), "axes should be swapped by the 90° rotation"
    _assert_same_pixels(result, ImageOps.exif_transpose(_reopen(content)))


def test_orientation_tag_is_not_left_behind():
    """A stale tag would make viewers that *do* honor EXIF rotate a second time."""
    content = _encode(_quadrants(), "JPEG", orientation=6, quality=95)

    assert _reopen(normalize_orientation(content)).getexif().get(_ORIENTATION, 1) == 1


@pytest.mark.parametrize("orientation,swaps_axes", sorted(_SWAPS_AXES.items()))
def test_every_non_trivial_orientation_matches_pillow(orientation, swaps_axes):
    content = _encode(_quadrants(), "JPEG", orientation=orientation, quality=95)

    result = _reopen(normalize_orientation(content))

    assert result.size == ((20, 40) if swaps_axes else (40, 20))
    assert result.getexif().get(_ORIENTATION, 1) == 1
    _assert_same_pixels(result, ImageOps.exif_transpose(_reopen(content)))


def test_is_idempotent():
    """A second pass must be a no-op, or re-running the backfill would stack
    a lossy re-encode on every already-corrected image."""
    once = normalize_orientation(_encode(_quadrants(), "JPEG", orientation=6, quality=95))

    assert normalize_orientation(once) == once


def test_remaining_exif_metadata_survives():
    """We are forced into one re-encode; it should not also cost the camera tags."""
    exif = Image.Exif()
    exif[_ORIENTATION] = 6
    exif[0x010F] = "TestCam"  # Make
    buf = io.BytesIO()
    _quadrants().save(buf, format="JPEG", quality=95, exif=exif)

    result = _reopen(normalize_orientation(buf.getvalue()))

    assert result.getexif().get(0x010F) == "TestCam"
    assert result.getexif().get(_ORIENTATION, 1) == 1


# ── Nothing to fix: the bytes must come back untouched, not re-encoded ────────

def test_jpeg_without_exif_is_returned_byte_for_byte():
    content = _encode(_quadrants(), "JPEG", quality=95)

    assert normalize_orientation(content) == content


def test_orientation_1_is_returned_byte_for_byte():
    content = _encode(_quadrants(), "JPEG", orientation=1, quality=95)

    assert normalize_orientation(content) == content


def test_png_without_orientation_is_returned_byte_for_byte():
    content = _encode(_quadrants(), "PNG")

    assert normalize_orientation(content) == content


def test_animated_image_with_orientation_is_returned_byte_for_byte():
    """The one case where we decline a fix we could make: a single-frame
    exif_transpose + save would flatten every frame but the first. Animated WEBP
    is the only allowed upload type that carries both frames and orientation."""
    content = _animated("WEBP", orientation=6)
    source = _reopen(content)
    assert source.n_frames > 1 and source.getexif().get(_ORIENTATION) == 6

    assert normalize_orientation(content) == content


def test_animated_gif_is_returned_byte_for_byte():
    content = _animated("GIF")
    assert _reopen(content).n_frames > 1

    assert normalize_orientation(content) == content


def test_undecodable_bytes_are_returned_byte_for_byte():
    """Content type is client-declared, so junk reaches this helper. It normalizes
    orientation; deciding what is a valid upload belongs to the routes."""
    content = b"this is not an image"

    assert normalize_orientation(content) == content


# ── Format is preserved, so the stored file still matches its content type ───

def test_png_keeps_its_format():
    content = _encode(_quadrants(), "PNG", orientation=6)

    result = _reopen(normalize_orientation(content))

    assert result.format == "PNG"
    assert result.size == (20, 40)
    _assert_same_pixels(result, ImageOps.exif_transpose(_reopen(content)), tol=0)


def test_webp_keeps_its_format():
    content = _encode(_quadrants(), "WEBP", orientation=6, lossless=True)

    result = _reopen(normalize_orientation(content))

    assert result.format == "WEBP"
    assert result.size == (20, 40)
    _assert_same_pixels(result, ImageOps.exif_transpose(_reopen(content)))
