import io


def _png_bytes():
    # 1x1 transparent PNG
    return bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
        "0000000a49444154789c6360000002000154a24f7f0000000049454e44ae426082"
    )


def _upload(client, property_id, name, content, mime):
    return client.post(f"/api/properties/{property_id}/floorplan-image",
                       files={"file": (name, io.BytesIO(content), mime)})


def test_upload_returns_key_under_the_property(client, test_property):
    r = _upload(client, test_property["id"], "plan.png", _png_bytes(), "image/png")
    assert r.status_code == 201, r.text
    key = r.json()["imageKey"]
    assert key.startswith(f"properties/{test_property['id']}/floorplan/")
    assert key.endswith(".png")


def test_upload_rejects_non_image(client, test_property):
    assert _upload(client, test_property["id"], "x.txt", b"nope", "text/plain").status_code == 415


def test_upload_rejects_gif(client, test_property):
    # GIF is allowed for the gallery but not for a technical drawing reference,
    # and the floorplan extension map has no ".gif" entry -- reject it up front
    # so validation and the stored key extension can never disagree.
    assert _upload(client, test_property["id"], "p.gif", b"GIF89a", "image/gif").status_code == 415


def test_upload_on_a_missing_property_is_404(client):
    assert _upload(client, 999_999_999, "plan.png", _png_bytes(), "image/png").status_code == 404
