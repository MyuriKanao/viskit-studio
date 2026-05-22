from __future__ import annotations

import base64
import unittest
from typing import Any
from unittest.mock import patch

from services.providers.image_generation import UniversalImageGenerationAdapter


class ChatGPT2APIImageGenerationTest(unittest.TestCase):
    def test_generation_uses_pixel_size_not_aspect_ratio_for_size_payload(self) -> None:
        captured: dict[str, Any] = {}
        adapter = UniversalImageGenerationAdapter(
            base_url="http://example.test",
            api_key_env="IGNORED",
            api_key="test-key",
            model="gpt-image-2",
            role="image",
            adapter="chatgpt2api",
            max_retry_attempts=1,
        )

        def fake_post_json(
            url: str, payload: dict[str, Any], headers: dict[str, str]
        ) -> dict[str, Any]:
            captured["url"] = url
            captured["payload"] = payload
            captured["headers"] = headers
            return {"data": [{"b64_json": base64.b64encode(b"png").decode("ascii")}]}

        adapter._post_json = fake_post_json  # type: ignore[method-assign]

        with patch("services.providers.image_generation.record_cost") as record_cost:
            response = adapter.generate("prompt", size="1536x864", n=1)

        self.assertEqual(response.images, [b"png"])
        self.assertEqual(captured["payload"]["size"], "1536x864")
        self.assertNotEqual(captured["payload"]["size"], "16:9")
        record_cost.assert_called_once()

    def test_chatgpt2api_rounds_pixel_size_to_multiple_of_16(self) -> None:
        captured: dict[str, Any] = {}
        adapter = UniversalImageGenerationAdapter(
            base_url="http://example.test",
            api_key_env="IGNORED",
            api_key="test-key",
            model="gpt-image-2",
            role="image",
            adapter="chatgpt2api",
            max_retry_attempts=1,
        )

        def fake_post_json(
            url: str, payload: dict[str, Any], headers: dict[str, str]
        ) -> dict[str, Any]:
            captured["payload"] = payload
            return {"data": [{"b64_json": base64.b64encode(b"png").decode("ascii")}]}

        adapter._post_json = fake_post_json  # type: ignore[method-assign]

        with patch("services.providers.image_generation.record_cost"):
            response = adapter.generate("prompt", size="1080x1350", n=1)

        self.assertEqual(response.resolution, "1088x1360")
        self.assertEqual(captured["payload"]["size"], "1088x1360")


if __name__ == "__main__":
    unittest.main()
