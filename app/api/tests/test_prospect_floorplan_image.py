import io


def _png_bytes():
    # 1x1 transparent PNG
    return bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
        "0000000a49444154789c6360000002000154a24f7f0000000049454e44ae426082"
    )


def test_upload_floorplan_image_returns_key(client, test_prospect):
    r = client.post(
        f"/api/prospects/{test_prospect['id']}/floorplan-image",
        files={"file": ("plan.png", io.BytesIO(_png_bytes()), "image/png")},
    )
    assert r.status_code == 201, r.text
    key = r.json()["imageKey"]
    assert key.startswith(f"prospects/{test_prospect['id']}/floorplan/")
    assert key.endswith(".png")


def test_upload_rejects_non_image(client, test_prospect):
    r = client.post(
        f"/api/prospects/{test_prospect['id']}/floorplan-image",
        files={"file": ("x.txt", io.BytesIO(b"nope"), "text/plain")},
    )
    assert r.status_code == 415


def test_upload_rejects_gif(client, test_prospect):
    # GIF is allowed for the gallery but not for a technical drawing reference,
    # and the floorplan extension map has no ".gif" entry -- reject it up front
    # so validation and the stored key extension can never disagree.
    r = client.post(
        f"/api/prospects/{test_prospect['id']}/floorplan-image",
        files={"file": ("plan.gif", io.BytesIO(b"GIF89a"), "image/gif")},
    )
    assert r.status_code == 415
