"""Fake registry and Milvus client factory for CLI end-to-end tests.

Used by scripts/ingest_corpus.py when INGEST_FAKE_CLIENT=1.
"""
from __future__ import annotations

from collections.abc import Callable
from typing import Any

from services.retrieval.schema import COLLECTION_NAME  # noqa: E402

# ---------------------------------------------------------------------------
# Fake embedding adapter
# ---------------------------------------------------------------------------


class _FakeEmbedAdapter:
    """Returns a deterministic length-4 dense vector for every input."""

    def _provider_name(self) -> str:
        return "fake@test"

    def embed(
        self,
        inputs: list[str | bytes],
        *,
        model: str | None = None,  # noqa: ARG002
    ) -> list[list[float]]:
        return [[0.1, 0.2, 0.3, 0.4] for _ in inputs]


# ---------------------------------------------------------------------------
# Fake registry
# ---------------------------------------------------------------------------


class _FakeRegistry:
    def __init__(self) -> None:
        self._adapter = _FakeEmbedAdapter()

    def get(self, role: str) -> object:
        if role != "embedding":
            raise KeyError(role)
        return self._adapter


# ---------------------------------------------------------------------------
# Fake Milvus client (records inserts/upserts in memory)
# ---------------------------------------------------------------------------


class _FakeMilvusClient:
    def __init__(self) -> None:
        self.rows: list[dict[str, Any]] = []
        self.insert_calls: list[list[dict[str, Any]]] = []
        self.upsert_calls: list[list[dict[str, Any]]] = []

    def has_collection(self, name: str) -> bool:
        return name == COLLECTION_NAME

    def drop_collection(self, name: str) -> None:  # noqa: ARG002
        self.rows = []

    def create_collection(
        self,
        name: str,  # noqa: ARG002
        schema: Any = None,  # noqa: ARG002
        index_params: Any = None,  # noqa: ARG002
    ) -> None:
        pass

    def insert(self, name: str, rows: list[dict[str, Any]]) -> dict[str, int]:  # noqa: ARG002
        self.rows.extend(rows)
        self.insert_calls.append(list(rows))
        return {"insert_count": len(rows)}

    def upsert(self, name: str, rows: list[dict[str, Any]]) -> dict[str, int]:  # noqa: ARG002
        self.upsert_calls.append(list(rows))
        for r in rows:
            for i, existing in enumerate(self.rows):
                if existing.get("image_path") == r.get("image_path"):
                    self.rows[i] = r
                    break
            else:
                self.rows.append(r)
        return {"upsert_count": len(rows)}

    def query(
        self,
        name: str,  # noqa: ARG002
        filter: str,  # noqa: A002
        output_fields: list[str],
    ) -> list[dict[str, Any]]:
        if filter == "":
            matched = list(self.rows)
        elif filter.startswith("image_path == '") and filter.endswith("'"):
            target = filter[len("image_path == '") : -1]
            matched = [r for r in self.rows if r.get("image_path") == target]
        else:
            matched = []
        return [{field: row.get(field) for field in output_fields} for row in matched]


# ---------------------------------------------------------------------------
# Public factories
# ---------------------------------------------------------------------------


def build_fake_registry() -> _FakeRegistry:
    """Return a fake registry whose get("embedding") yields a 4-dim adapter."""
    return _FakeRegistry()


def build_fake_milvus_factory() -> Callable[[], _FakeMilvusClient]:
    """Return a factory callable that produces a fresh in-memory Milvus client."""
    client = _FakeMilvusClient()

    def _factory() -> _FakeMilvusClient:
        return client

    return _factory
