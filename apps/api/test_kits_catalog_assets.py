from __future__ import annotations

import os
import tempfile
import unittest
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from apps.api.lib import db as db_mod
from apps.api.lib.db import get_session
from apps.api.routes.kits import KitListItem, _catalog_sort_value
from apps.api.routes.kits import router as kits_router


@contextmanager
def session_scope() -> Iterator[Session]:
    generator = get_session()
    session = next(generator)
    try:
        yield session
        try:
            next(generator)
        except StopIteration:
            pass
    finally:
        generator.close()


class KitsCatalogAssetsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.output_dir = self.root / "imagegen"
        os.environ["DATABASE_URL"] = f"sqlite:///{self.root / 'viskit-test.db'}"
        os.environ["IMAGEGEN_OUTPUT_DIR"] = str(self.output_dir)
        os.environ["VISKIT_BOOTSTRAP_WORKSPACE"] = "0"
        db_mod._engine = None
        db_mod._SessionLocal = None
        db_mod.ensure_schema()

        self.asset_path = self.output_dir / "assets" / "asset_42.png"
        self.asset_path.parent.mkdir(parents=True, exist_ok=True)
        self.asset_path.write_bytes(b"asset png")

        with session_scope() as session:
            session.execute(
                text(
                    "INSERT INTO users (id, username, password_hash)"
                    " VALUES (1, 'tester', 'hash')"
                )
            )
            session.execute(
                text(
                    "INSERT INTO workbenches (id, name, owner_user_id)"
                    " VALUES (1, 'bench', 1)"
                )
            )
            session.execute(
                text(
                    "INSERT INTO product_catalogs (id, workbench_id, sku, name)"
                    " VALUES (1, 1, 'SKU-1', 'Catalog Kit')"
                )
            )
            session.execute(
                text(
                    "INSERT INTO marketing_kits"
                    " (id, product_catalog_id, status, style_prompt, created_at, updated_at)"
                    " VALUES (10, 1, 'ready', 'style',"
                    " '2026-05-21T09:00:00', '2026-05-21T09:00:00')"
                )
            )
            session.execute(
                text(
                    "INSERT INTO source_images"
                    " (id, storage_path, mime_type, size_bytes)"
                    " VALUES ('src_asset', :source_path, 'image/png', 9)"
                ),
                {"source_path": str(self.output_dir / "source.png")},
            )
            session.execute(
                text(
                    "INSERT INTO generation_jobs"
                    " (id, status, source_image_ref, user_prompt, locale, planner_payload)"
                    " VALUES ('job_asset', 'succeeded', 'src_asset', 'asset prompt', 'zh',"
                    " '{\"product\":{\"category\":\"PlannerCat\"}}')"
                )
            )
            session.execute(
                text(
                    "INSERT INTO generated_assets"
                    " (id, name, output_kind, png_path, source_job_id, metadata,"
                    "  created_at, updated_at)"
                    " VALUES (42, 'Standalone Main', 'product_main', :png_path,"
                    "  'job_asset', '{\"job_id\":\"job_asset\"}',"
                    "  '2026-05-21T10:00:00', '2026-05-21T10:00:00')"
                ),
                {"png_path": str(self.asset_path)},
            )

        app = FastAPI()
        app.include_router(kits_router)
        self.client = TestClient(app)

    def tearDown(self) -> None:
        self.tmp.cleanup()
        db_mod._engine = None
        db_mod._SessionLocal = None

    def test_catalog_includes_standalone_generated_assets(self) -> None:
        response = self.client.get("/api/kits?limit=20")
        self.assertEqual(response.status_code, 200)
        body = response.json()

        self.assertEqual(body["total"], 2)
        asset = next(item for item in body["items"] if item["source_type"] == "asset")
        self.assertEqual(asset["asset_id"], "42")
        self.assertEqual(asset["sku"], "ASSET-42")
        self.assertEqual(asset["image_ids"][0], "asset:42")
        self.assertTrue(asset["thumbs"][0].startswith("/api/assets/42/image?v="))

    def test_catalog_filters_exclude_assets_when_not_applicable(self) -> None:
        response = self.client.get("/api/kits?min_score=80")
        self.assertEqual(response.status_code, 200)
        body = response.json()

        self.assertEqual(body["total"], 0)
        self.assertEqual(body["items"], [])

    def test_recent_catalog_keeps_dashboard_kit_only_contract(self) -> None:
        response = self.client.get("/api/kits?recent=true&limit=20")
        self.assertEqual(response.status_code, 200)
        body = response.json()

        self.assertEqual(body["total"], 1)
        self.assertEqual(body["items"][0]["source_type"], "kit")
        self.assertEqual(body["items"][0]["id"], 10)

    def test_recent_catalog_uses_kit_only_pagination_contract(self) -> None:
        with session_scope() as session:
            session.execute(
                text(
                    "INSERT INTO product_catalogs (id, workbench_id, sku, name)"
                    " VALUES (2, 1, 'SKU-2', 'Second Kit'),"
                    " (3, 1, 'SKU-3', 'Third Kit')"
                )
            )
            session.execute(
                text(
                    "INSERT INTO marketing_kits"
                    " (id, product_catalog_id, status, style_prompt, created_at, updated_at)"
                    " VALUES"
                    " (11, 2, 'ready', 'style',"
                    "  '2026-05-21T11:00:00', '2026-05-21T11:00:00'),"
                    " (12, 3, 'ready', 'style',"
                    "  '2026-05-21T08:00:00', '2026-05-21T08:00:00')"
                )
            )

        response = self.client.get("/api/kits?recent=true&limit=2&offset=1")
        self.assertEqual(response.status_code, 200)
        body = response.json()

        self.assertEqual(body["total"], 3)
        self.assertEqual([item["id"] for item in body["items"]], [10, 12])
        self.assertTrue(all(item["source_type"] == "kit" for item in body["items"]))

    def test_category_filter_can_return_assets_from_generation_planner_payload(self) -> None:
        response = self.client.get("/api/kits?category=PlannerCat")
        self.assertEqual(response.status_code, 200)
        body = response.json()

        self.assertEqual(body["total"], 1)
        self.assertEqual(body["items"][0]["source_type"], "asset")
        self.assertEqual(body["items"][0]["category"], "PlannerCat")

    def test_catalog_sort_value_normalizes_datetime_and_string_timestamps(self) -> None:
        kit_row = SimpleNamespace(
            id=10,
            score=None,
            created_at=datetime(2026, 5, 21, 9, 0, tzinfo=UTC),
            updated_at=datetime(2026, 5, 21, 9, 0, tzinfo=UTC),
        )
        asset_item = KitListItem(
            id=-42,
            sku="ASSET-42",
            name="Standalone Main",
            name_en=None,
            source_type="asset",
            asset_id="42",
            image_ids=["asset:42"] + [None] * 13,
            status="ready",
            score=None,
            locale="zh",
            category="PlannerCat",
            created_at="2026-05-21T10:00:00+00:00",
            updated_at="2026-05-21T10:00:00+00:00",
            thumbs=["/api/assets/42/image?v=1"] + [None] * 13,
        )

        rows: list[Any] = [kit_row, asset_item]
        sorted_rows = sorted(
            rows,
            key=lambda item: (_catalog_sort_value(item, "created_at"), abs(int(item.id))),
            reverse=True,
        )

        self.assertEqual(sorted_rows[0], asset_item)


if __name__ == "__main__":
    unittest.main()
