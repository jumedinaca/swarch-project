import io
import uuid

import pytest
from PIL import Image

from tests.conftest import auth_headers, image_bytes

PREFIX = "http://gateway.test/api/profiles/avatars/"


async def upload(client, user_id, data, filename="avatar.png", content_type="image/png"):
    return await client.post(
        "/profiles/me/avatar",
        headers=auth_headers(user_id),
        files={"file": (filename, data, content_type)},
    )


def key_from(url: str) -> str:
    assert url.startswith(PREFIX)
    return url[len(PREFIX):]


async def test_upload_processes_and_serves_avatar(client, storage, publisher):
    user_id = uuid.uuid4()

    response = await upload(client, user_id, image_bytes("PNG", (300, 200)))

    assert response.status_code == 200
    avatar_url = response.json()["avatarUrl"]
    key = key_from(avatar_url)
    assert key.startswith(f"avatars/{user_id}/") and key.endswith(".webp")

    stored, content_type = storage.objects[key]
    assert content_type == "image/webp"
    with Image.open(io.BytesIO(stored)) as img:
        assert img.format == "WEBP"
        assert img.size == (512, 512)
        assert "exif" not in img.info

    me = await client.get("/profiles/me", headers=auth_headers(user_id))
    assert me.json()["avatarUrl"] == avatar_url
    assert publisher.events[-1].payload.changed_fields == ["avatarUrl"]

    # Pública: sin token
    served = await client.get(f"/profiles/avatars/{key}")
    assert served.status_code == 200
    assert served.headers["content-type"] == "image/webp"
    assert served.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert served.content == stored


@pytest.mark.parametrize(
    "data",
    [
        image_bytes("JPEG", (800, 600)),
        image_bytes("WEBP", (64, 64)),
        image_bytes("PNG", (100, 400), alpha=True),
    ],
)
async def test_accepts_jpeg_png_and_webp(client, data):
    response = await upload(client, uuid.uuid4(), data)
    assert response.status_code == 200


async def test_content_type_from_client_is_not_trusted(client):
    # Un JPEG real enviado como "application/octet-stream" se acepta...
    ok = await upload(client, uuid.uuid4(), image_bytes("JPEG"), "a.bin", "application/octet-stream")
    assert ok.status_code == 200
    # ...y un texto enviado como "image/png" se rechaza.
    bad = await upload(client, uuid.uuid4(), b"no soy una imagen" * 10, "a.png", "image/png")
    assert bad.status_code == 422
    assert bad.json()["error"] == "invalid_image"


async def test_exif_orientation_is_applied(client, storage):
    # 128x64: mitad izquierda roja y derecha azul. Orientación 6 = rotar 90°
    # a la derecha al mostrar, así que el rojo debe quedar arriba.
    img = Image.new("RGB", (128, 64), (255, 0, 0))
    img.paste((0, 0, 255), (64, 0, 128, 64))
    exif = Image.Exif()
    exif[0x0112] = 6
    buffer = io.BytesIO()
    img.save(buffer, format="JPEG", exif=exif.tobytes(), quality=95)

    response = await upload(client, uuid.uuid4(), buffer.getvalue(), "a.jpg", "image/jpeg")

    stored, _ = storage.objects[key_from(response.json()["avatarUrl"])]
    with Image.open(io.BytesIO(stored)) as result:
        result = result.convert("RGB")
        top, bottom = result.getpixel((256, 60)), result.getpixel((256, 450))
        assert "exif" not in result.info
    assert top[0] > 200 and top[2] < 60
    assert bottom[2] > 200 and bottom[0] < 60


async def test_replacing_avatar_deletes_previous(client, storage):
    user_id = uuid.uuid4()
    first = key_from((await upload(client, user_id, image_bytes())).json()["avatarUrl"])

    second = key_from((await upload(client, user_id, image_bytes("JPEG"))).json()["avatarUrl"])

    assert first != second
    assert list(storage.objects) == [second]
    assert (await client.get(f"/profiles/avatars/{first}")).status_code == 404


async def test_delete_avatar(client, storage, publisher):
    user_id = uuid.uuid4()
    await upload(client, user_id, image_bytes())

    response = await client.delete("/profiles/me/avatar", headers=auth_headers(user_id))

    assert response.status_code == 204
    assert storage.objects == {}
    me = await client.get("/profiles/me", headers=auth_headers(user_id))
    assert me.json()["avatarUrl"] is None
    assert publisher.events[-1].payload.avatar_url is None


async def test_delete_without_avatar_is_noop(client):
    response = await client.delete("/profiles/me/avatar", headers=auth_headers())
    assert response.status_code == 204


async def test_rejects_large_files(client, settings):
    settings.avatar_max_bytes = 1024
    response = await upload(client, uuid.uuid4(), image_bytes("PNG", (64, 64)) + b"\0" * 2048)
    assert response.status_code == 413
    assert response.json()["error"] == "avatar_too_large"


def animated(fmt: str) -> bytes:
    frames = [Image.new("RGB", (64, 64), c) for c in ((255, 0, 0), (0, 0, 255))]
    buffer = io.BytesIO()
    frames[0].save(buffer, format=fmt, save_all=True, append_images=frames[1:], duration=100)
    return buffer.getvalue()


SVG = b'<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"></svg>'


@pytest.mark.parametrize(
    "data",
    [
        image_bytes("GIF", (64, 64)),
        animated("GIF"),
        animated("WEBP"),
        animated("PNG"),
        image_bytes("BMP", (64, 64)),
        SVG,
    ],
    ids=["gif", "animated-gif", "animated-webp", "apng", "bmp", "svg"],
)
async def test_rejects_unsupported_formats(client, data):
    response = await upload(client, uuid.uuid4(), data)
    assert response.status_code == 415
    assert response.json()["error"] == "unsupported_media_type"


@pytest.mark.parametrize("size", [(63, 200), (4097, 64), (64, 5000)])
async def test_rejects_out_of_range_dimensions(client, size):
    response = await upload(client, uuid.uuid4(), image_bytes("PNG", size))
    assert response.status_code == 422
    assert response.json()["error"] == "invalid_image"


async def test_rejects_truncated_image(client):
    data = image_bytes("JPEG", (512, 512))
    response = await upload(client, uuid.uuid4(), data[: len(data) // 2])
    assert response.status_code == 422


async def test_requires_file_field(client):
    response = await client.post(
        "/profiles/me/avatar", headers=auth_headers(), files={"other": ("a.png", image_bytes(), "image/png")}
    )
    assert response.status_code == 422


async def test_upload_requires_token(client):
    response = await client.post("/profiles/me/avatar", files={"file": ("a.png", image_bytes(), "image/png")})
    assert response.status_code == 401


async def test_upload_rate_limit(app, client):
    app.state.upload_limiter.limit = 2
    user_id = uuid.uuid4()
    for _ in range(2):
        assert (await upload(client, user_id, image_bytes())).status_code == 200

    response = await upload(client, user_id, image_bytes())

    assert response.status_code == 429
    assert response.json()["error"] == "rate_limited"
    assert int(response.headers["retry-after"]) > 0
    # El límite es por usuario
    assert (await upload(client, uuid.uuid4(), image_bytes())).status_code == 200


async def test_storage_disabled_returns_503(app, client):
    app.state.avatar_storage = None
    response = await upload(client, uuid.uuid4(), image_bytes())
    assert response.status_code == 503
    assert response.json()["error"] == "storage_unavailable"


async def test_storage_failure_keeps_profile_unchanged(client, storage):
    user_id = uuid.uuid4()
    storage.fail = True

    response = await upload(client, user_id, image_bytes())

    assert response.status_code == 503
    me = await client.get("/profiles/me", headers=auth_headers(user_id))
    assert me.json()["avatarUrl"] is None


@pytest.mark.parametrize(
    "key",
    [
        f"avatars/{uuid.uuid4()}/{uuid.uuid4().hex}.webp",
        "../../etc/passwd",
        "otro-bucket/archivo.webp",
    ],
)
async def test_unknown_or_foreign_avatar_keys_return_404(client, key):
    response = await client.get(f"/profiles/avatars/{key}")
    assert response.status_code == 404
