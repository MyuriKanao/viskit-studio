from __future__ import annotations

from io import BytesIO
from typing import Any


def composite_to_minio(
    *,
    kit_id: str,
    image_id: str,
    edited_bytes: bytes,
    minio_client: Any,
    bucket: str = "kits",
) -> str:
    """Write edited PNG to MinIO sidecar path; return the object key."""
    key = f"{kit_id}/edited/{image_id}.png"
    stream = BytesIO(edited_bytes)
    minio_client.put_object(
        bucket, key, stream, length=len(edited_bytes), content_type="image/png"
    )
    return key


__all__ = ["composite_to_minio"]
