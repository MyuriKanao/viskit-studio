"""
scripts/seed_sample_kit.py — idempotent sample-kit fixture (US-0.8)

Usage:
    uv run python scripts/seed_sample_kit.py
    make seed-sample-kit
"""
from __future__ import annotations

import io
import os
import struct
import sys
import zlib

import psycopg
from minio import Minio
from minio.error import S3Error

KIT_ID = "sample-yungan-knit-cardigan"
BUCKET = "aishop-kits"
PREFIX = f"{KIT_ID}/"

BRAND_COLOR_HEX = "#C4513A"
STATUS = "ready"
SCORE = 92
LOCALE = "zh"
STYLE_PROMPT = (
    "warm-tinted editorial knitwear, golden hour, soft drape, oatmeal palette"
)

# Brand-palette colors from DASHBOARD_KITS[0].thumbs (warm earth tones)
HERO_COLORS = [
    (0x3A, 0x28, 0x20),  # H1
    (0x52, 0x38, 0x2C),  # H2
    (0x70, 0x48, 0x36),  # H3
    (0xA0, 0x5A, 0x3E),  # H4
    (0xC9, 0x77, 0x55),  # H5
]

DETAIL_COLORS = [
    (0xD9, 0x8A, 0x68),  # D1
    (0xE5, 0xA8, 0x88),  # D2
    (0x8E, 0x56, 0x40),  # D3
    (0x6B, 0x46, 0x32),  # D4
    (0x3E, 0x2A, 0x20),  # D5
    (0x2A, 0x1C, 0x14),  # D6
    (0x5A, 0x3A, 0x2A),  # D7
    (0x8A, 0x54, 0x40),  # D8
    (0xA0, 0x6A, 0x4E),  # D9
]

HERO_NAMES = ["H1-Hero", "H2-Hero", "H3-Hero", "H4-Hold", "H5-Hold"]
DETAIL_NAMES = [
    "D1-MaterialMacro",
    "D2-Detail",
    "D3-Detail",
    "D4-Detail",
    "D5-Detail",
    "D6-Detail",
    "D7-Detail",
    "D8-Detail",
    "D9-CallToAction",
]


# ---------------------------------------------------------------------------
# Minimal valid PNG encoder (no PIL dependency)
# ---------------------------------------------------------------------------

def _png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    c = chunk_type + data
    return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)


def make_solid_png(width: int, height: int, r: int, g: int, b: int) -> bytes:
    """Return minimal valid PNG bytes for a solid-color image."""
    # IHDR
    ihdr_data = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    # Raw image data: filter byte 0x00 per scanline + RGB triplets
    raw_row = b"\x00" + bytes([r, g, b]) * width
    raw = raw_row * height
    idat_data = zlib.compress(raw)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", ihdr_data)
        + _png_chunk(b"IDAT", idat_data)
        + _png_chunk(b"IEND", b"")
    )


def _minio_client() -> Minio:
    endpoint = os.environ.get("MINIO_ENDPOINT", "localhost:9000")
    access_key = os.environ.get("MINIO_ACCESS_KEY", "minioadmin")
    secret_key = os.environ.get("MINIO_SECRET_KEY", "minioadmin")
    secure = os.environ.get("MINIO_SECURE", "false").lower() == "true"
    return Minio(endpoint, access_key=access_key, secret_key=secret_key, secure=secure)


def ensure_bucket(client: Minio, bucket: str) -> None:
    if not client.bucket_exists(bucket):
        client.make_bucket(bucket)


def upload_png(
    client: Minio, bucket: str, object_name: str, png_bytes: bytes
) -> None:
    client.put_object(
        bucket,
        object_name,
        io.BytesIO(png_bytes),
        length=len(png_bytes),
        content_type="image/png",
    )


def main() -> None:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("ERROR: DATABASE_URL environment variable is not set", file=sys.stderr)
        sys.exit(1)

    with psycopg.connect(database_url) as conn:
        # Idempotency check
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM marketing_kits WHERE id = %s",
                (KIT_ID,),
            )
            if cur.fetchone():
                print("sample kit already seeded; nothing to do")
                sys.exit(0)

        # --- MinIO uploads ---
        minio = _minio_client()
        try:
            ensure_bucket(minio, BUCKET)
        except S3Error as exc:
            print(f"ERROR: MinIO bucket setup failed: {exc}", file=sys.stderr)
            sys.exit(1)

        hero_paths: list[str] = []
        detail_paths: list[str] = []

        # Upload hero images (32x32 placeholders)
        for name, color in zip(HERO_NAMES, HERO_COLORS, strict=True):
            png = make_solid_png(32, 32, *color)
            obj = f"{PREFIX}{name}.png"
            upload_png(minio, BUCKET, obj, png)
            hero_paths.append(obj)
            print(f"  uploaded {obj}")

        # Upload detail images (32x48 placeholders)
        for name, color in zip(DETAIL_NAMES, DETAIL_COLORS, strict=True):
            png = make_solid_png(32, 48, *color)
            obj = f"{PREFIX}{name}.png"
            upload_png(minio, BUCKET, obj, png)
            detail_paths.append(obj)
            print(f"  uploaded {obj}")

        # --- DB inserts ---
        with conn.cursor() as cur:
            # 1. marketing_kits row
            cur.execute(
                """
                INSERT INTO marketing_kits
                    (id, status, score, locale, brand_color_hex, style_prompt)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (KIT_ID, STATUS, SCORE, LOCALE, BRAND_COLOR_HEX, STYLE_PROMPT),
            )

            # 2. hero_images rows
            for path in hero_paths:
                cur.execute(
                    """
                    INSERT INTO hero_images (kit_id, storage_path)
                    VALUES (%s, %s)
                    RETURNING id
                    """,
                    (KIT_ID, path),
                )
                hero_id = cur.fetchone()[0]  # type: ignore[index]
                # 3. empty image_edits row per hero image
                cur.execute(
                    "INSERT INTO image_edits (image_id, image_type) VALUES (%s, 'hero')",
                    (hero_id,),
                )

            # 4. detail_images rows
            for path in detail_paths:
                cur.execute(
                    """
                    INSERT INTO detail_images (kit_id, storage_path)
                    VALUES (%s, %s)
                    RETURNING id
                    """,
                    (KIT_ID, path),
                )
                detail_id = cur.fetchone()[0]  # type: ignore[index]
                # 5. empty image_edits row per detail image
                cur.execute(
                    "INSERT INTO image_edits (image_id, image_type) VALUES (%s, 'detail')",
                    (detail_id,),
                )

        conn.commit()

    print(
        f"✓ seeded sample kit '{KIT_ID}'"
        f" ({len(hero_paths)} heroes, {len(detail_paths)} details)"
    )
    sys.exit(0)


if __name__ == "__main__":
    main()
