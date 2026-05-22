from __future__ import annotations

import json
import unittest

from apps.api.routes.extract import _parse_vision_response


class ExtractRouteTest(unittest.TestCase):
    def test_parse_accepts_selling_points_value_wrapper(self) -> None:
        parsed = _parse_vision_response(
            json.dumps(
                {
                    "name": {
                        "value": "Example Protein Bar",
                        "confidence": 0.9,
                        "reasoning": "Visible on package.",
                    },
                    "brand": {
                        "value": "Example",
                        "confidence": 0.9,
                        "reasoning": "Logo text is visible.",
                    },
                    "category": {
                        "value": "零食",
                        "confidence": 0.8,
                        "reasoning": "Packaged snack product.",
                    },
                    "product_type": {
                        "value": "sports",
                        "confidence": 0.7,
                        "reasoning": "Protein positioning.",
                    },
                    "price": None,
                    "brand_color_hex": {
                        "value": "#3366CC",
                        "confidence": 0.6,
                        "reasoning": "Dominant package color.",
                    },
                    "selling_points": {
                        "value": [
                            {
                                "value": {
                                    "title": "高蛋白",
                                    "priority": "high",
                                    "evidence": "包装标注蛋白质含量。",
                                },
                                "confidence": 0.85,
                                "reasoning": "Based on visible package text.",
                            }
                        ]
                    },
                }
            )
        )

        self.assertEqual(len(parsed.selling_points), 1)
        self.assertEqual(parsed.selling_points[0].value["title"], "高蛋白")

    def test_parse_accepts_plain_selling_point_objects(self) -> None:
        parsed = _parse_vision_response(
            json.dumps(
                {
                    "name": None,
                    "brand": {"value": "未知", "confidence": 0.2, "reasoning": "未见品牌"},
                    "category": {"value": "服装", "confidence": 0.9, "reasoning": "裤装"},
                    "product_type": {"value": "other", "confidence": 0.8, "reasoning": "服饰"},
                    "price": None,
                    "brand_color_hex": {
                        "value": "#1F2A44",
                        "confidence": 0.8,
                        "reasoning": "深蓝主色",
                    },
                    "selling_points": [
                        {
                            "title": "宽松阔腿",
                            "evidence": "裤型较宽松，适合日常穿搭。",
                        }
                    ],
                }
            )
        )

        self.assertEqual(len(parsed.selling_points), 1)
        self.assertEqual(parsed.selling_points[0].value["title"], "宽松阔腿")
        self.assertEqual(parsed.selling_points[0].confidence, 0.75)


if __name__ == "__main__":
    unittest.main()
