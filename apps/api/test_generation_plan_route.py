from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from apps.api.lib import db as db_mod
from apps.api.routes.generation_plan import router as generation_plan_router


class GenerationPlanRouteTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.previous_database_url = os.environ.get("DATABASE_URL")
        self.previous_bootstrap_workspace = os.environ.get("VISKIT_BOOTSTRAP_WORKSPACE")
        os.environ["DATABASE_URL"] = f"sqlite:///{Path(self.tmp.name) / 'viskit-test.db'}"
        os.environ["VISKIT_BOOTSTRAP_WORKSPACE"] = "0"
        db_mod._engine = None
        db_mod._SessionLocal = None
        db_mod.ensure_schema()
        app = FastAPI()
        app.include_router(generation_plan_router)
        self.client = TestClient(app)

    def tearDown(self) -> None:
        self.tmp.cleanup()
        if self.previous_database_url is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = self.previous_database_url
        if self.previous_bootstrap_workspace is None:
            os.environ.pop("VISKIT_BOOTSTRAP_WORKSPACE", None)
        else:
            os.environ["VISKIT_BOOTSTRAP_WORKSPACE"] = self.previous_bootstrap_workspace
        db_mod._engine = None
        db_mod._SessionLocal = None

    def test_create_generation_plan_returns_backend_owned_default_plan(self) -> None:
        response = self.client.post(
            "/api/generation/plan",
            json={
                "kit_client_id": "kit-client",
                "source_image_ref": "src_test",
                "user_prompt": "需要促销 banner",
                "locale": "zh",
                "product": {
                    "brand": "Viskit",
                    "category": "营养品",
                    "product_type": "general_food",
                    "brand_color_hex": "#ff9966",
                    "selling_points": ["高蛋白"],
                },
            },
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["source_image_ref"], "src_test")
        self.assertEqual(body["plan_source"], "recommended")
        self.assertTrue(body["requires_confirmation"])
        self.assertEqual(
            [item["template_ref"] for item in body["items"]],
            ["builtin:zh:poster-banner"],
        )
        self.assertEqual(body["planner_note"], "template-library-plan")

    def test_create_generation_plan_uses_magazine_cover_template_from_prompt(self) -> None:
        response = self.client.post(
            "/api/generation/plan",
            json={
                "kit_client_id": "kit-client",
                "source_image_ref": "src_test",
                "user_prompt": "生成杂志大片封面宣传图",
                "locale": "zh",
                "product": {
                    "brand": "Viskit",
                    "category": "香水",
                    "product_type": "beauty",
                    "brand_color_hex": "#ff9966",
                    "selling_points": ["高级感"],
                },
            },
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["items"][0]["template_ref"], "builtin:zh:magazine-editorial")
        self.assertEqual(body["items"][0]["template_name"], "杂志大片/封面")
        self.assertEqual(body["items"][0]["aspect_ratio"], "4:5")

    def test_create_generation_plan_generates_user_demand_plan_when_no_template_matches(
        self,
    ) -> None:
        prompt = "生成一个漂浮在月球矿坑里的未来主义限定视觉"
        response = self.client.post(
            "/api/generation/plan",
            json={
                "kit_client_id": "kit-client",
                "source_image_ref": "src_test",
                "user_prompt": prompt,
                "locale": "zh",
                "product": {
                    "brand": "Viskit",
                    "category": "香水",
                    "product_type": "beauty",
                    "brand_color_hex": "#ff9966",
                    "selling_points": [],
                },
            },
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["planner_note"], "user-demand-generated-plan")
        self.assertEqual(body["items"][0]["template_ref"], "builtin:zh:creative-concept")
        self.assertEqual(body["items"][0]["title"], prompt)

    def test_create_generation_plan_normalizes_locale_price_and_selling_points(self) -> None:
        response = self.client.post(
            "/api/generation/plan",
            json={
                "kit_client_id": "kit-client",
                "source_image_ref": "src_test",
                "user_prompt": "生成杂志大片封面宣传图",
                "locale": "zh-CN",
                "product": {
                    "brand": "Viskit",
                    "category": "服装",
                    "product_type": "other",
                    "price": "无法判断",
                    "brand_color_hex": "#1F2A44",
                    "selling_points": [{"title": "宽松阔腿", "evidence": "裤型宽松"}],
                },
            },
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["items"][0]["template_ref"], "builtin:zh:magazine-editorial")
        self.assertIsNone(body["planner_payload"]["product"]["price"])
        self.assertEqual(
            body["planner_payload"]["product"]["selling_points"], ["宽松阔腿：裤型宽松"]
        )

    def test_create_generation_plan_accepts_wrapped_model_fields(self) -> None:
        response = self.client.post(
            "/api/generation/plan",
            json={
                "kit_client_id": {"value": "kit-client"},
                "source_image_ref": {"value": "src_test"},
                "user_prompt": {"value": "生成杂志大片封面宣传图"},
                "locale": {"value": "zh-CN"},
                "explicit_template_refs": [{"value": ""}],
                "product": {
                    "name": {"value": "深蓝阔腿裤"},
                    "brand": {"value": "未知"},
                    "category": {"value": "服装"},
                    "product_type": None,
                    "price": {"value": "无法判断"},
                    "brand_color_hex": {"value": "#1F2A44"},
                    "selling_points": [
                        {
                            "value": {
                                "title": "宽松阔腿",
                                "evidence": "裤型宽松，适合日常穿搭。",
                            }
                        }
                    ],
                },
            },
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["source_image_ref"], "src_test")
        self.assertEqual(body["items"][0]["template_ref"], "builtin:zh:magazine-editorial")
        self.assertEqual(body["planner_payload"]["kit_client_id"], "kit-client")
        self.assertEqual(body["planner_payload"]["product"]["name"], "深蓝阔腿裤")
        self.assertEqual(
            body["planner_payload"]["product"]["selling_points"],
            ["宽松阔腿：裤型宽松，适合日常穿搭。"],
        )


if __name__ == "__main__":
    unittest.main()
