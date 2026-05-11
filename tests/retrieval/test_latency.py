"""p95 < 500ms latency test for in-process FakeMilvusClient hybrid search."""
from __future__ import annotations

import time

from services.retrieval.filters import FilterSpec
from services.retrieval.hybrid_search import hybrid_search
from tests.retrieval.conftest import FakeMilvusClient


def test_p95_under_500ms(fake_milvus_client: FakeMilvusClient) -> None:
    # Seed with 1000 deterministic rows
    rows = [
        {
            "image_path": f"/img/{i:04d}.png",
            "image_url": f"https://m/{i:04d}",
            "category": "shoes",
            "color": "red",
            "style": "sporty",
            "season": "spring",
            "sales_count": 1000 + i,
            "description": f"desc {i}",
            "price": 49.99,
            "locale": "zh",
        }
        for i in range(1000)
    ]
    fake_milvus_client.insert("aishop_bestsellers", rows)

    latencies: list[float] = []
    for _ in range(100):
        t0 = time.perf_counter()
        hybrid_search(
            fake_milvus_client,
            query_dense=[0.1, 0.2, 0.3, 0.4],
            query_sparse={0: 1.0, 1: 0.5},
            filter_spec=FilterSpec(category="shoes", locale="zh", min_sales=1000),
            top_k=10,
        )
        latencies.append((time.perf_counter() - t0) * 1000.0)

    latencies.sort()
    p95 = latencies[94]  # 95th percentile of 100 samples
    assert p95 < 500.0, f"p95 latency = {p95:.2f}ms exceeds 500ms budget"
