"""
scripts/seed_dashboard_fixtures.py — idempotent dashboard fixture seeder (EPIC-7 S5)

Seeds:
  - 1 system user (username='__system__') — required because workbenches.owner_user_id
    is NOT NULL.  The onboarding-gate Playwright spec should TRUNCATE users CASCADE
    before its 3-case test so the gate logic (no users → show onboarding) fires.
  - 1 workbench (name='dashboard-fixture-wb')
  - 6 product_catalogs + marketing_kits matching DASHBOARD_KITS in demo/dashboard.jsx
  - 5 hero_images per kit (slot_index 1-5)
  - 9 detail_images per kit (module_id M1-M9)
  - compliance_checks for kits with status in (ready, needs_review)
    via copywriting_specs (compliance_checks FK → copywriting_specs.id)
  - 3-5 cost_events per kit

Idempotency: all inserts use ON CONFLICT DO NOTHING on deterministic UNIQUE keys
(users.username UNIQUE, product_catalogs.sku UNIQUE,
hero_images UNIQUE(marketing_kit_id, slot_index),
detail_images UNIQUE(marketing_kit_id, module_id)).

Usage:
    uv run python scripts/seed_dashboard_fixtures.py
    make seed-dashboard-fixtures
"""
from __future__ import annotations

import os
import sys
from decimal import Decimal
from typing import Any

import psycopg

# ---------------------------------------------------------------------------
# Fixture definitions — match demo/dashboard.jsx DASHBOARD_KITS
# ---------------------------------------------------------------------------

SYSTEM_USERNAME = "__system__"
SYSTEM_PASSWORD_HASH = "$2b$12$SEED_FIXTURE_PLACEHOLDER_HASH_FOR_FIXTURE_ONLY"

WORKBENCH_NAME = "dashboard-fixture-wb"

# (sku, name, category, price, brand, locale, status, score, brand_color_hex, style_prompt)
KITS: list[tuple[Any, ...]] = [
    (
        "NEW001",
        "云感针织开衫",
        "knitwear",
        Decimal("189.00"),
        "云感",
        "CN",
        "ready",
        92,
        "#C4513A",
        "warm-tinted editorial knitwear, golden hour, soft drape, oatmeal palette",
    ),
    (
        "SKU042",
        "波西米亚粉中长裙",
        "dress",
        Decimal("259.00"),
        "波西米亚",
        "EN",
        "generating",
        86,
        "#D4A0C0",
        "bohemian pink midi dress, natural light, flowy fabric",
    ),
    (
        "SKU017",
        "玻尿酸精华水",
        "skincare",
        Decimal("128.00"),
        "透研",
        "CN",
        "needs_review",
        71,
        "#A8D4E6",
        "minimalist skincare, clean white studio, hyaluronic serum close-up",
    ),
    (
        "SKU089",
        "亚麻直筒阔腿裤",
        "bottoms",
        Decimal("219.00"),
        "云感",
        "CN",
        "ready",
        88,
        "#C8B89A",
        "linen wide-leg trousers, neutral tones, casual editorial",
    ),
    (
        "SKU101",
        "复古铜釦皮带",
        "accessories",
        Decimal("98.00"),
        "古风",
        "EN",
        "queued",
        None,
        "#8B6914",
        "vintage brass buckle belt, antique texture, dark background",
    ),
    (
        "SKU064",
        "羊绒奶白围巾",
        "accessories",
        Decimal("349.00"),
        "云感",
        "EN",
        "failed",
        None,
        "#F5F0E8",
        "cashmere ivory scarf, soft morning light, draped on shoulders",
    ),
]

# Roles and costs for cost_events per kit
# provider_name uses protocol-family identifiers per services/providers/cost.py:9
# and the two-protocol abstraction (ADR-005). Vendor names live only in config.yaml.
COST_EVENT_TEMPLATES: list[tuple[str, str, Decimal]] = [
    ("copywriter", "openai_compatible", Decimal("0.0120")),
    ("compliance_screen", "anthropic_compatible", Decimal("0.0080")),
    ("image_gen", "openai_compatible", Decimal("0.0400")),
    ("embedding", "openai_compatible", Decimal("0.0020")),
]

# Statuses that get compliance rows
REVIEWED_STATUSES = {"ready", "needs_review"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _ensure_system_user(cur: psycopg.Cursor) -> int:
    """Insert the system user if absent; return its id."""
    cur.execute(
        """
        INSERT INTO users (username, password_hash)
        VALUES (%s, %s)
        ON CONFLICT (username) DO NOTHING
        """,
        (SYSTEM_USERNAME, SYSTEM_PASSWORD_HASH),
    )
    cur.execute("SELECT id FROM users WHERE username = %s", (SYSTEM_USERNAME,))
    row = cur.fetchone()
    assert row is not None
    return int(row[0])


def _ensure_workbench(cur: psycopg.Cursor, owner_id: int) -> int:
    """Insert the fixture workbench if absent; return its id."""
    cur.execute(
        "SELECT id FROM workbenches WHERE name = %s",
        (WORKBENCH_NAME,),
    )
    row = cur.fetchone()
    if row:
        return int(row[0])
    cur.execute(
        """
        INSERT INTO workbenches (name, owner_user_id)
        VALUES (%s, %s)
        RETURNING id
        """,
        (WORKBENCH_NAME, owner_id),
    )
    row = cur.fetchone()
    assert row is not None
    return int(row[0])


def _ensure_product_catalog(
    cur: psycopg.Cursor,
    workbench_id: int,
    sku: str,
    name: str,
    category: str,
    price: Decimal,
    brand: str,
    locale: str,
) -> int:
    """Insert product catalog row idempotently; return id."""
    cur.execute(
        """
        INSERT INTO product_catalogs (workbench_id, sku, name, category, price, brand, locale)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (sku) DO NOTHING
        """,
        (workbench_id, sku, name, category, price, brand, locale),
    )
    cur.execute("SELECT id FROM product_catalogs WHERE sku = %s", (sku,))
    row = cur.fetchone()
    assert row is not None
    return int(row[0])


def _ensure_marketing_kit(
    cur: psycopg.Cursor,
    product_catalog_id: int,
    status: str,
    score: int | None,
    locale: str,
    brand_color_hex: str,
    style_prompt: str,
) -> int:
    """Insert marketing kit if none exists for this catalog; return id."""
    cur.execute(
        "SELECT id FROM marketing_kits WHERE product_catalog_id = %s",
        (product_catalog_id,),
    )
    row = cur.fetchone()
    if row:
        return int(row[0])
    cur.execute(
        """
        INSERT INTO marketing_kits
            (product_catalog_id, status, score, locale, brand_color_hex, style_prompt)
        VALUES (%s, %s, %s, %s, %s, %s)
        RETURNING id
        """,
        (product_catalog_id, status, score, locale, brand_color_hex, style_prompt),
    )
    row = cur.fetchone()
    assert row is not None
    return int(row[0])


def _ensure_hero_images(
    cur: psycopg.Cursor, kit_id: int, brand_color_hex: str
) -> int:
    """Insert 5 hero_images for the kit; skip any already present. Returns count inserted."""
    inserted = 0
    for slot in range(1, 6):
        png_path = f"kits/{kit_id}/hero/{slot}.png"
        cur.execute(
            """
            INSERT INTO hero_images
                (marketing_kit_id, slot_index, png_path, template_id, prompt, brand_color_hex)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (marketing_kit_id, slot_index) DO NOTHING
            """,
            (
                kit_id,
                slot,
                png_path,
                f"tpl-hero-{slot:02d}",
                f"hero slot {slot} placeholder",
                brand_color_hex,
            ),
        )
        if cur.rowcount and cur.rowcount > 0:
            inserted += 1
    return inserted


def _ensure_detail_images(cur: psycopg.Cursor, kit_id: int, brand_color_hex: str) -> int:
    """Insert 9 detail_images for the kit; skip any already present. Returns count inserted."""
    inserted = 0
    for idx in range(1, 10):
        module_id = f"M{idx}"
        png_path = f"kits/{kit_id}/detail/{module_id}.png"
        cur.execute(
            """
            INSERT INTO detail_images
                (marketing_kit_id, module_id, png_path, prompt, brand_color_hex)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (marketing_kit_id, module_id) DO NOTHING
            """,
            (
                kit_id,
                module_id,
                png_path,
                f"detail module {module_id} placeholder",
                brand_color_hex,
            ),
        )
        if cur.rowcount and cur.rowcount > 0:
            inserted += 1
    return inserted


def _ensure_compliance_check(
    cur: psycopg.Cursor, kit_id: int, score: int
) -> None:
    """Insert a copywriting_spec + compliance_check for a reviewed kit (idempotent)."""
    # Check if copywriting_spec exists for this kit
    cur.execute(
        "SELECT id FROM copywriting_specs WHERE marketing_kit_id = %s",
        (kit_id,),
    )
    row = cur.fetchone()
    if row:
        spec_id = row[0]
    else:
        cur.execute(
            """
            INSERT INTO copywriting_specs (marketing_kit_id, markdown, compliance_passed, version)
            VALUES (%s, %s, %s, 1)
            RETURNING id
            """,
            (kit_id, f"# Fixture spec for kit {kit_id}", score >= 80),
        )
        row = cur.fetchone()
        assert row is not None
        spec_id = row[0]

    # Check if compliance_check already exists
    cur.execute(
        "SELECT id FROM compliance_checks WHERE copywriting_spec_id = %s",
        (spec_id,),
    )
    if cur.fetchone():
        return

    cur.execute(
        """
        INSERT INTO compliance_checks
            (copywriting_spec_id, ruleset_id, score, violations, advisory)
        VALUES (%s, %s, %s, %s, false)
        """,
        (spec_id, "CN-2024-v1" if score >= 80 else "CN-2024-v1-review", score, "[]"),
    )


def _ensure_cost_events(cur: psycopg.Cursor, kit_id: int, sku: str) -> int:
    """Insert cost_events for a kit if none exist yet. Returns count inserted."""
    cur.execute(
        "SELECT COUNT(*) FROM cost_events WHERE kit_id = %s",
        (kit_id,),
    )
    row = cur.fetchone()
    if row and row[0] > 0:
        return 0

    # Deterministic set: 4 events per kit using templates
    inserted = 0
    for role, provider, cost in COST_EVENT_TEMPLATES:
        cur.execute(
            """
            INSERT INTO cost_events
                (kit_id, role, provider_name, tokens_in, tokens_out, image_count, cost_usd)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                kit_id,
                role,
                provider,
                500 if role != "image_gen" else None,
                200 if role == "copywriter" else None,
                14 if role == "image_gen" else None,
                cost,
            ),
        )
        inserted += 1
    return inserted


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("ERROR: DATABASE_URL environment variable is not set", file=sys.stderr)
        sys.exit(1)

    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            # 1. System user
            user_id = _ensure_system_user(cur)

            # 2. Workbench
            wb_id = _ensure_workbench(cur, user_id)

            # 3. Kits
            total_heroes = 0
            total_details = 0
            total_cost_events = 0

            for kit_def in KITS:
                (
                    sku,
                    name,
                    category,
                    price,
                    brand,
                    locale,
                    status,
                    score,
                    brand_color_hex,
                    style_prompt,
                ) = kit_def

                pc_id = _ensure_product_catalog(
                    cur, wb_id, sku, name, category, price, brand, locale
                )
                kit_id = _ensure_marketing_kit(
                    cur, pc_id, status, score, locale, brand_color_hex, style_prompt
                )
                total_heroes += _ensure_hero_images(cur, kit_id, brand_color_hex)
                total_details += _ensure_detail_images(cur, kit_id, brand_color_hex)

                if status in REVIEWED_STATUSES and score is not None:
                    _ensure_compliance_check(cur, kit_id, score)

                total_cost_events += _ensure_cost_events(cur, kit_id, sku)

        conn.commit()

    # Summary
    print(f"seed_dashboard_fixtures: user_id={user_id}, workbench_id={wb_id}")
    print(
        f"  kits={len(KITS)}, heroes_inserted={total_heroes},"
        f" details_inserted={total_details}, cost_events_inserted={total_cost_events}"
    )
    sys.exit(0)


if __name__ == "__main__":
    main()
