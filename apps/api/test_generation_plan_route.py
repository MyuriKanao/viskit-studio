from __future__ import annotations

import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from apps.api.routes.generation_plan import router as generation_plan_router


class GenerationPlanRouteTest(unittest.TestCase):
    def setUp(self) -> None:
        app = FastAPI()
        app.include_router(generation_plan_router)
        self.client = TestClient(app)

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
            [item["output_kind"] for item in body["items"]], ["product_main", "banner"]
        )
        self.assertEqual(body["planner_note"], "backend-default-plan")


if __name__ == "__main__":
    unittest.main()
