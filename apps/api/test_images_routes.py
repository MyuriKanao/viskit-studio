from __future__ import annotations

import os
import tempfile
import unittest
from base64 import b64encode
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any, cast
from unittest.mock import patch
from urllib.parse import quote

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from apps.api.lib import db as db_mod
from apps.api.lib.db import get_session
from apps.api.routes import images as images_mod
from apps.api.routes.assets import router as assets_router
from apps.api.routes.images import router as images_router
from apps.api.routes.source_images import router as source_images_router


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
        images_mod._OCR_CACHE.clear()
        db_mod.ensure_schema()

        self.slot_path = self.output_dir / "kits" / "public-kit" / "hero" / "H1.png"
        self.slot_path.parent.mkdir(parents=True, exist_ok=True)
        self.slot_path.write_bytes(b"original png")
        self.edit_path = self.output_dir / "edit-results" / "job-ready.png"
        self.edit_path.parent.mkdir(parents=True, exist_ok=True)
        self.edit_path.write_bytes(b"edited png")
        self.source_path = self.output_dir / "sources" / "src-original.png"
        self.source_path.parent.mkdir(parents=True, exist_ok=True)
        self.source_path.write_bytes(b"original png")

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
            session.execute(
                text(
                    "INSERT INTO source_images"
                    " (id, storage_path, mime_type, size_bytes)"
                    " VALUES ('src-original', :path, 'image/png', 12)"
                ),
                {"path": str(self.source_path)},
            )

        app = FastAPI()
        app.include_router(images_router)
        app.include_router(source_images_router)
        app.include_router(assets_router)
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

    def test_ocr_missing_optional_runtime_degrades_to_empty_boxes(self) -> None:
        from services.editor import ocr as ocr_mod
        from services.editor.ocr import OcrUnavailableError
        from services.editor.types import TextBox

        original_detect = ocr_mod.detect_text_boxes
        ocr_mod_any = cast(Any, ocr_mod)

        def unavailable(_: bytes) -> list[Any]:
            raise OcrUnavailableError("paddleocr is not installed")

        ocr_mod_any.detect_text_boxes = unavailable
        try:
            image_id = quote("kit-slot:10:H1", safe="")
            response = self.client.post(f"/api/images/{image_id}/ocr", json={})
            ocr_mod_any.detect_text_boxes = lambda _: [
                TextBox(x=1, y=2, w=3, h=4, text="ok", confidence=0.9)
            ]
            recovered_response = self.client.post(f"/api/images/{image_id}/ocr", json={})
        finally:
            ocr_mod_any.detect_text_boxes = original_detect

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "boxes": [],
                "engine": "none",
                "version": "paddleocr-not-installed",
                "available": False,
                "unavailable_reason": "paddleocr is not installed",
            },
        )
        self.assertEqual(recovered_response.status_code, 200)
        self.assertEqual(recovered_response.json()["engine"], "paddleocr")
        self.assertTrue(recovered_response.json()["available"])
        self.assertEqual(recovered_response.json()["boxes"][0]["text"], "ok")

    def test_ocr_engine_import_error_is_normalized_to_unavailable(self) -> None:
        import builtins

        from services.editor import ocr as ocr_mod
        from services.editor.ocr import OcrUnavailableError

        original_import = builtins.__import__

        def fake_import(
            name: str,
            globals: dict[str, Any] | None = None,
            locals: dict[str, Any] | None = None,
            fromlist: tuple[str, ...] = (),
            level: int = 0,
        ) -> Any:
            if name == "paddleocr":
                exc = ModuleNotFoundError("No module named 'paddleocr'")
                exc.name = "paddleocr"
                raise exc
            return original_import(name, globals, locals, fromlist, level)

        ocr_mod._engine = None
        with patch("builtins.__import__", fake_import):
            with self.assertRaises(OcrUnavailableError):
                ocr_mod.detect_text_boxes(b"not-an-image")
        ocr_mod._engine = None

    def test_existing_image_can_be_imported_as_source_image(self) -> None:
        response = self.client.post(
            "/api/source-images/from-image",
            json={"image_id": "kit-slot:10:H1"},
        )
        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertTrue(body["source_image_ref"].startswith("src_"))
        self.assertEqual(body["mime_type"], "image/png")
        self.assertEqual(body["data_url"], "data:image/png;base64,b3JpZ2luYWwgcG5n")

        image_response = self.client.get(body["preview_url"])
        self.assertEqual(image_response.status_code, 200)
        self.assertEqual(image_response.content, b"original png")

    def test_data_url_source_image_upload_persists_preview_file(self) -> None:
        response = self.client.post(
            "/api/source-images",
            json={"data_url": "data:image/webp;base64,bG9jYWwgd2VicA=="},
        )
        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertTrue(body["source_image_ref"].startswith("src_"))
        self.assertEqual(body["mime_type"], "image/webp")
        self.assertEqual(body["size_bytes"], len(b"local webp"))
        self.assertRegex(body["sha256"], r"^[0-9a-f]{64}$")

        preview = self.client.get(body["preview_url"])
        self.assertEqual(preview.status_code, 200)
        self.assertEqual(preview.headers["content-type"], "image/webp")
        self.assertEqual(preview.content, b"local webp")

    def test_source_image_upload_preserves_supported_file_format_equivalents(self) -> None:
        cases = (
            ("image/bmp", b"BMfake-bmp"),
            ("image/tiff", b"II*\x00fake-tiff"),
            ("image/gif", b"GIF89a animated-equivalent"),
        )
        for mime_type, image_bytes in cases:
            with self.subTest(mime_type=mime_type):
                response = self.client.post(
                    "/api/source-images",
                    json={
                        "data_url": (
                            f"data:{mime_type};base64,"
                            f"{b64encode(image_bytes).decode('ascii')}"
                        )
                    },
                )
                self.assertEqual(response.status_code, 201)
                body = response.json()
                self.assertEqual(body["mime_type"], mime_type)
                self.assertEqual(body["size_bytes"], len(image_bytes))

                preview = self.client.get(body["preview_url"])
                self.assertEqual(preview.status_code, 200)
                self.assertEqual(preview.headers["content-type"], mime_type)
                self.assertEqual(preview.content, image_bytes)

    def test_source_image_upload_rejects_unsupported_image_format(self) -> None:
        response = self.client.post(
            "/api/source-images",
            json={"data_url": "data:image/svg+xml;base64,PHN2Zy8+"},
        )
        self.assertEqual(response.status_code, 415)
        self.assertEqual(response.json()["detail"], "unsupported source image MIME type")

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
        self.assertIsInstance(body["asset_id"], str)
        self.assertTrue(body["asset_id"].startswith("asset_"))
        self.assertEqual(body["image_id"], f"asset:{body['asset_id']}")
        self.assertEqual(self.slot_path.read_bytes(), b"original png")

        asset_response = self.client.get(f"/api/images/{quote(body['image_id'], safe='')}/bytes")
        self.assertEqual(asset_response.status_code, 200)
        self.assertEqual(asset_response.content, b"edited png")

    def test_saved_copy_is_available_through_asset_file_workflow(self) -> None:
        image_id = quote("kit-slot:10:H1", safe="")
        save_response = self.client.post(
            f"/api/images/{image_id}/save",
            json={"edit_result_ref": "edit-result:job-ready", "mode": "copy"},
        )
        self.assertEqual(save_response.status_code, 200)
        asset_id = save_response.json()["asset_id"]
        self.assertIsInstance(asset_id, str)

        list_response = self.client.get("/api/assets")
        self.assertEqual(list_response.status_code, 200)
        assets = list_response.json()["items"]
        asset = next(item for item in assets if item["id"] == asset_id)
        self.assertEqual(asset["image_id"], f"asset:{asset_id}")
        self.assertEqual(asset["image_url"], f"/api/assets/{asset_id}/image")
        self.assertEqual(asset["download_url"], f"/api/assets/{asset_id}/download")
        self.assertEqual(asset["metadata"]["mode"], "copy")
        self.assertEqual(asset["metadata"]["source_image_id"], "kit-slot:10:H1")

        image_response = self.client.get(asset["image_url"])
        self.assertEqual(image_response.status_code, 200)
        self.assertEqual(image_response.content, b"edited png")
        self.assertEqual(image_response.headers["content-type"], "image/png")

        download_response = self.client.get(asset["download_url"])
        self.assertEqual(download_response.status_code, 200)
        self.assertEqual(download_response.content, b"edited png")
        self.assertIn("attachment", download_response.headers["content-disposition"])

        edit_context = self.client.post(f"/api/assets/{asset_id}/edit")
        self.assertEqual(edit_context.status_code, 200)
        self.assertEqual(edit_context.json()["target"], {"kind": "asset", "asset_id": asset_id})

        delete_response = self.client.delete(f"/api/assets/{asset_id}")
        self.assertEqual(delete_response.status_code, 200)
        self.assertEqual(delete_response.json(), {
            "asset_id": asset_id,
            "deleted": True,
            "file_deleted": True,
        })
        self.assertEqual(self.client.get(asset["image_url"]).status_code, 404)

    def test_editor_project_json_round_trips_with_revision_and_export(self) -> None:
        image_id = quote("kit-slot:10:H1", safe="")
        document: dict[str, Any] = {
            "schema_version": 1,
            "canvas": {"width": 1024, "height": 1536},
            "source": {"image_id": "kit-slot:10:H1"},
            "layers": [
                {
                    "id": "layer-base",
                    "type": "raster",
                    "name": "Base image",
                    "visible": True,
                    "opacity": 1,
                }
            ],
        }

        response = self.client.put(
            f"/api/images/{image_id}/project",
            json={"document": document, "source_image_ref": "src-original"},
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["image_id"], "kit-slot:10:H1")
        self.assertEqual(body["document"], document)
        self.assertEqual(body["document_schema_version"], 1)
        self.assertEqual(body["revision"], 1)
        self.assertEqual(body["source_image_ref"], "src-original")
        self.assertRegex(body["checksum"], r"^[0-9a-f]{64}$")

        get_response = self.client.get(f"/api/images/{image_id}/project")
        self.assertEqual(get_response.status_code, 200)
        self.assertEqual(get_response.json()["document"], document)

        updated = {**document, "layers": [*document["layers"], {"id": "note", "type": "text"}]}
        update_response = self.client.put(
            f"/api/images/{image_id}/project",
            json={"document": updated, "expected_revision": 1},
        )
        self.assertEqual(update_response.status_code, 200)
        self.assertEqual(update_response.json()["revision"], 2)
        self.assertEqual(update_response.json()["document"], updated)

        stale_response = self.client.put(
            f"/api/images/{image_id}/project",
            json={"document": updated, "expected_revision": 1},
        )
        self.assertEqual(stale_response.status_code, 409)

        export_response = self.client.get(f"/api/images/{image_id}/project/export")
        self.assertEqual(export_response.status_code, 200)
        self.assertEqual(export_response.headers["content-type"], "application/json")
        self.assertIn("attachment", export_response.headers["content-disposition"])
        self.assertEqual(export_response.headers["x-viskit-project-revision"], "2")
        self.assertEqual(export_response.json(), updated)

    def test_editor_project_import_uses_same_persistence_contract(self) -> None:
        image_id = quote("kit-slot:10:H1", safe="")
        imported: dict[str, Any] = {
            "schema_version": 1,
            "canvas": {"width": 640, "height": 480},
            "source": {"image_id": "kit-slot:10:H1"},
            "layers": [{"id": "base", "type": "raster"}],
        }

        import_response = self.client.post(
            f"/api/images/{image_id}/project/import",
            json={"document": imported, "source_image_ref": "src-original"},
        )
        self.assertEqual(import_response.status_code, 200)
        self.assertEqual(import_response.json()["document"], imported)
        self.assertEqual(import_response.json()["revision"], 1)

        loaded = self.client.get(f"/api/images/{image_id}/project")
        self.assertEqual(loaded.status_code, 200)
        self.assertEqual(loaded.json()["document"], imported)
        self.assertEqual(loaded.json()["source_image_ref"], "src-original")

    def test_editor_project_import_accepts_frontend_wrapped_json_and_exports_document(self) -> None:
        image_id = quote("kit-slot:10:H1", safe="")
        document: dict[str, Any] = {
            "schema_version": 1,
            "canvas": {"width": 512, "height": 512},
            "source": {"image_id": "kit-slot:10:H1"},
            "layers": [{"id": "base", "type": "raster"}],
        }
        wrapped_project = {
            "schema": "viskit-editor-project",
            "version": 1,
            "document": document,
        }

        import_response = self.client.post(
            f"/api/images/{image_id}/project/import",
            json={"document": wrapped_project, "source_image_ref": "src-original"},
        )
        self.assertEqual(import_response.status_code, 200)
        self.assertEqual(import_response.json()["document"], document)
        self.assertEqual(import_response.json()["document_schema_version"], 1)

        export_response = self.client.get(f"/api/images/{image_id}/project/export")
        self.assertEqual(export_response.status_code, 200)
        self.assertEqual(export_response.json(), document)

    def test_editor_project_rejects_unsupported_schema_and_unknown_source(self) -> None:
        image_id = quote("kit-slot:10:H1", safe="")
        unsupported = self.client.put(
            f"/api/images/{image_id}/project",
            json={"document": {"schema_version": 99, "layers": []}},
        )
        self.assertEqual(unsupported.status_code, 422)

        unsupported_wrapper = self.client.put(
            f"/api/images/{image_id}/project",
            json={
                "document": {
                    "schema": "viskit-editor-project",
                    "version": 99,
                    "document": {"schema_version": 1, "layers": []},
                }
            },
        )
        self.assertEqual(unsupported_wrapper.status_code, 422)

        missing_source = self.client.put(
            f"/api/images/{image_id}/project",
            json={
                "document": {"schema_version": 1, "layers": []},
                "source_image_ref": "src-missing",
            },
        )
        self.assertEqual(missing_source.status_code, 422)

        unknown_target = self.client.put(
            f"/api/images/{quote('kit-slot:404:H1', safe='')}/project",
            json={"document": {"schema_version": 1, "layers": []}},
        )
        self.assertEqual(unknown_target.status_code, 404)


if __name__ == "__main__":
    unittest.main()
