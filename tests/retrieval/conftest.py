"""Shared fixtures for retrieval tests."""
from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest


class FakeMilvusClient:
    """Minimal in-memory client mirroring the pymilvus.MilvusClient surface
    that production retrieval code uses (insert/upsert/query/drop/has_collection
    /create_collection/hybrid_search/get_collection_stats)."""

    def __init__(self) -> None:
        self._collections: dict[str, list[dict[str, Any]]] = {}
        self.calls: list[dict[str, Any]] = []
        # Optional pre-canned hybrid_search responses for tests that want to
        # control retrieval scoring deterministically.
        self.hybrid_responses: list[list[list[dict[str, Any]]]] = []

    def has_collection(self, name: str) -> bool:
        return name in self._collections

    def drop_collection(self, name: str) -> None:
        self._collections.pop(name, None)
        self.calls.append({"op": "drop_collection", "name": name})

    def create_collection(self, name: str, schema: Any = None, index_params: Any = None) -> None:
        self._collections[name] = []
        self.calls.append({"op": "create_collection", "name": name})

    def insert(self, name: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
        self._collections.setdefault(name, []).extend(rows)
        self.calls.append({"op": "insert", "name": name, "count": len(rows)})
        return {"insert_count": len(rows)}

    def upsert(self, name: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
        coll = self._collections.setdefault(name, [])
        for r in rows:
            for i, existing in enumerate(coll):
                if existing.get("image_path") == r.get("image_path"):
                    coll[i] = r
                    break
            else:
                coll.append(r)
        self.calls.append({"op": "upsert", "name": name, "count": len(rows)})
        return {"upsert_count": len(rows)}

    def query(
        self,
        name: str,
        filter: str = "",  # noqa: A002
        output_fields: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        rows = self._collections.get(name, [])
        # Minimal filter support: only `image_path == '<value>'` patterns
        if filter:
            if "image_path == '" in filter:
                tag = filter.split("'", 2)[1]
                rows = [r for r in rows if r.get("image_path") == tag]
        self.calls.append({"op": "query", "name": name, "filter": filter, "count": len(rows)})
        if output_fields:
            rows = [{k: r.get(k) for k in output_fields} for r in rows]
        return rows

    def get_collection_stats(self, name: str) -> dict[str, Any]:
        return {"row_count": len(self._collections.get(name, []))}

    def hybrid_search(
        self,
        collection_name: str,
        reqs: Any,
        ranker: Any,
        limit: int,
        output_fields: list[str],
    ) -> list[list[dict[str, Any]]]:
        self.calls.append({
            "op": "hybrid_search",
            "collection_name": collection_name,
            "limit": limit,
            "output_fields": output_fields,
        })
        if self.hybrid_responses:
            return self.hybrid_responses.pop(0)
        # Default: return all rows up to limit
        rows = self._collections.get(collection_name, [])[:limit]
        hits = [
            {
                "entity": {k: r.get(k) for k in output_fields},
                "distance": float(1.0 / (i + 1)),
            }
            for i, r in enumerate(rows)
        ]
        return [hits]


@pytest.fixture
def fake_milvus_client() -> Iterator[FakeMilvusClient]:
    """Provide a fresh FakeMilvusClient per test."""
    client = FakeMilvusClient()
    yield client
