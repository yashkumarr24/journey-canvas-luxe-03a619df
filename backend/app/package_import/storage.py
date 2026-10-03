"""Upload extracted DOCX images to the private 'package-images' bucket.

Service role only (backend). The bucket is private (the workspace blocks
public buckets), so package_images.url stores a 'storage://' reference; the
site must serve these via server-generated signed URLs once package pages
exist. Nothing here logs image bytes or credentials.
"""

from __future__ import annotations

import httpx

from app.core.config import Settings

BUCKET = "package-images"
UPLOADABLE = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
              ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp"}


def object_path(checksum: str, index: int, name: str) -> str:
    return f"{checksum[:16]}/{index:02d}-{name}"


def storage_ref(path: str) -> str:
    return f"storage://{BUCKET}/{path}"


async def upload_image(settings: Settings, path: str, data: bytes, content_type: str) -> None:
    key = settings.supabase_service_role_key
    url = f"{settings.supabase_url.rstrip('/')}/storage/v1/object/{BUCKET}/{path}"
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(url, content=data, headers={
            "apikey": key, "Authorization": f"Bearer {key}",
            "Content-Type": content_type, "x-upsert": "true",
        })
    if resp.status_code >= 300:
        raise RuntimeError(f"storage upload failed (HTTP {resp.status_code})")
