from __future__ import annotations

import os
import tempfile
import unittest
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import quote

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from apps.api.lib import db as db_mod
from apps.api.lib.db import get_session
from apps.api.routes.images import router as images_router


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


class ImagesRoutePersistenceTest(unittest.TestCase):
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

        self.slot_path = self.output_dir / "kits" / "public-kit" / "hero" / "H1.png"
        self.slot_path.parent.mkdir(parents=True, exist_ok=True)
        self.slot_path.write_bytes(b"original png")
        self.edit_path = self.output_dir / "edit-results" / "job-ready.png"
        self.edit_path.parent.mkdir(parents=True, exist_ok=True)
        self.edit_path.write_bytes(b"edited png")

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
                    " VALUES (1, 1, 'SKU-1', 'Product')"
                )
            )
            session.execute(
                text(
                    "INSERT INTO marketing_kits (id, product_catalog_id, style_prompt)"
                    " VALUES (10, 1, 'style')"
                )
            )
            session.execute(
                text(
                    "INSERT INTO hero_images (id, marketing_kit_id, slot_index, png_path)"
                    " VALUES (100, 10, 1, :path)"
                ),
                {"path": str(self.slot_path)},
            )
            session.execute(
                text(
                    "INSERT INTO image_edit_results"
                    " (id, target_image_id, result_path, status, metadata)"
                    " VALUES ('job-ready', 'kit-slot:10:H1', :path, 'ready', '{}')"
                ),
                {"path": str(self.edit_path)},
            )

        app = FastAPI()
        app.include_router(images_router)
        self.client = TestClient(app)

    def tearDown(self) -> None:
        self.tmp.cleanup()
        db_mod._engine = None
        db_mod._SessionLocal = None

    def test_canonical_kit_slot_bytes_resolve_from_db_path(self) -> None:
        image_id = quote("kit-slot:10:H1", safe="")
        response = self.client.get(f"/api/images/{image_id}/bytes")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b"original png")
        self.assertEqual(response.headers["content-type"], "image/png")

    def test_save_replace_requires_explicit_mode_and_updates_current_slot(self) -> None:
        image_id = quote("kit-slot:10:H1", safe="")
        missing_mode = self.client.post(
            f"/api/images/{image_id}/save",
            json={"edit_result_ref": "edit-result:job-ready"},
        )
        self.assertEqual(missing_mode.status_code, 422)

        response = self.client.post(
            f"/api/images/{image_id}/save",
            json={"edit_result_ref": "edit-result:job-ready", "mode": "replace"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["image_id"], "kit-slot:10:H1")
        self.assertTrue(response.json()["replaced"])
        self.assertEqual(self.slot_path.read_bytes(), b"edited png")
        with session_scope() as session:
            count = session.execute(text("SELECT COUNT(*) FROM image_edits")).scalar_one()
        self.assertEqual(count, 1)

    def test_save_copy_creates_standalone_asset_without_overwriting_original(self) -> None:
        image_id = quote("kit-slot:10:H1", safe="")
        response = self.client.post(
            f"/api/images/{image_id}/save",
            json={"edit_result_ref": "edit-result:job-ready", "mode": "copy"},
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["mode"], "copy")
        self.assertFalse(body["replaced"])
        self.assertIsInstance(body["asset_id"], int)
        self.assertTrue(body["image_id"].startswith("asset:"))
        self.assertEqual(self.slot_path.read_bytes(), b"original png")

        asset_response = self.client.get(f"/api/images/{quote(body['image_id'], safe='')}/bytes")
        self.assertEqual(asset_response.status_code, 200)
        self.assertEqual(asset_response.content, b"edited png")


if __name__ == "__main__":
    unittest.main()
