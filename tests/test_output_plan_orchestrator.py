from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from services.copywriter.sop import (
    DetailSection,
    HeroSection,
    SellingPoint,
    SkuMeta,
    Spec,
    ThreePiece,
)
from services.imagegen.color_lock import ColorLockResult
from services.imagegen.orchestrator import (
    PlannedGenerationInputs,
    ProviderBinding,
    RoutingSnapshot,
    orchestrate_output_plan,
)
from services.imagegen.output_plan import (
    RecommendationCandidate,
    build_full_kit_output_plan,
    build_output_plan,
    resolve_plan_templates,
)
from services.imagegen.template_library import TemplateLibraryError
from services.providers.base import ImageGenResponse, VisionResponse


class _FakeCompliance:
    def analyze(self, image: bytes, prompt: str, *, tool_use: bool = False) -> VisionResponse:
        return VisionResponse(
            text=None,
            structured={"violations": []},
            tokens_in=1,
            tokens_out=1,
            model="fake-compliance",
            raw={"cost_usd": 0.0},
        )


class _FakeRegistry:
    def get(self, role: str) -> object:
        if role == "compliance_screen":
            return _FakeCompliance()
        raise AssertionError(f"unexpected registry role {role!r}")


class _FakeImageAdapter:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def generate(
        self,
        prompt: str,
        *,
        size: str,
        n: int,
        image_id: str,
        kit_id: str,
        on_partial_image: object | None = None,
    ) -> ImageGenResponse:
        self.calls.append(image_id)
        return ImageGenResponse(
            images=[b"fake-png-bytes"],
            resolution=size,
            model="fake-image",
            raw={"cost_usd": 0.01},
        )


def _snapshot() -> RoutingSnapshot:
    return RoutingSnapshot(
        providers={
            "image": ProviderBinding(
                protocol="image_generation",
                base_url="http://fake.invalid",
                api_key_env_var="VISKIT_FAKE_IMAGE_KEY",
                model="fake-image",
                cap=1,
            )
        }
    )


def _sku() -> SkuMeta:
    return SkuMeta(
        sku="SKU-1",
        name="Test Product",
        brand="Viskit",
        category="Beauty",
        product_type="other",
        price=19.99,
    )


class OutputPlanTests(unittest.TestCase):
    def test_explicit_white_background_is_not_overridden(self) -> None:
        plan = build_output_plan(prompt="请生成白底产品主图", locale="zh")

        self.assertEqual(plan.plan_source, "explicit")
        self.assertEqual(plan.recommendation_source, "none")
        self.assertTrue(plan.requires_confirmation)
        self.assertEqual(len(plan.items), 1)
        self.assertEqual(plan.items[0].template_ref, "builtin:zh:hero-image")
        self.assertEqual(plan.items[0].output_kind, "white_bg")

    def test_invalid_recommendation_template_ref_is_rejected(self) -> None:
        with self.assertRaises(TemplateLibraryError):
            build_output_plan(
                prompt="Recommend something",
                locale="en",
                recommendation_candidates=[
                    RecommendationCandidate(template_ref="builtin:en:not-a-template")
                ],
            )

    def test_full_kit_plan_preserves_legacy_slot_order(self) -> None:
        spec = Spec(
            locale="en",
            sku_meta=_sku(),
            selling_points=(SellingPoint(title="Fast", priority="high", evidence="Lab"),),
            hero_sections=tuple(
                HeroSection(
                    id=f"H{i}",  # type: ignore[arg-type]
                    three_piece=ThreePiece("visual", "copy", "design"),
                )
                for i in range(1, 6)
            ),
            detail_sections=tuple(
                DetailSection(
                    id=f"M{i}",  # type: ignore[arg-type]
                    three_piece=ThreePiece("visual", "copy", "design"),
                )
                for i in range(1, 10)
            ),
        )

        plan = build_full_kit_output_plan(spec)

        expected_ids = [f"H{i}" for i in range(1, 6)] + [f"M{i}" for i in range(1, 10)]
        self.assertEqual([item.output_id for item in plan.items], expected_ids)
        self.assertTrue(all(item.destination_type == "kit_slot" for item in plan.items))


class PlannedOrchestratorTests(unittest.IsolatedAsyncioTestCase):
    async def test_stop_prevents_unscheduled_outputs(self) -> None:
        os.environ["VISKIT_FAKE_IMAGE_KEY"] = "test-key"
        image_adapter = _FakeImageAdapter()
        plan = build_output_plan(
            prompt="Recommend launch assets",
            locale="en",
            recommendation_candidates=[
                RecommendationCandidate(
                    template_ref="builtin:en:hero-image",
                    output_kind="product_main",
                ),
                RecommendationCandidate(
                    template_ref="builtin:en:poster-banner",
                    output_kind="banner",
                ),
            ],
        )
        templates = resolve_plan_templates(plan, locale="en")

        with tempfile.TemporaryDirectory() as tmpdir:
            inputs = PlannedGenerationInputs(
                job_id="job-stop",
                output_items=plan.items,
                sku_meta=_sku(),
                brand_color_hex="#FF0000",
                style_prompt="clean studio lighting",
                output_dir=Path(tmpdir),
                locale="en",
                template_by_output_id=templates,
            )

            with patch(
                "services.imagegen.orchestrator.verify",
                return_value=ColorLockResult(
                    locked=True,
                    delta_e=0.0,
                    target_hex="#FF0000",
                    dominant_hex="#FF0000",
                    status="ok",
                    error_message=None,
                ),
            ):
                result = await orchestrate_output_plan(
                    inputs,
                    registry=_FakeRegistry(),
                    snapshot=_snapshot(),
                    adapter_factory=lambda binding, role: image_adapter,
                    cap=1,
                    stop_checker=lambda: len(image_adapter.calls) >= 1,
                )

        self.assertEqual(image_adapter.calls, ["O1"])
        self.assertEqual(result.skipped_output_ids, ("O2",))
        self.assertIsNotNone(result.image_paths_by_id["O1"])
        self.assertIsNone(result.image_paths_by_id["O2"])
        self.assertEqual(result.color_lock_summary["ok"], 1)
        self.assertEqual(result.color_lock_summary["skipped"], 1)
        self.assertEqual(result.abort_reason, "stopped")


if __name__ == "__main__":
    unittest.main()
