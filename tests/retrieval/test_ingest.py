"""Tests for services/retrieval/ingest.py — CSV bulk-ingest pipeline."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import pytest

from services.retrieval.ingest import IngestError, ingest
from services.retrieval.schema import COLLECTION_NAME

# ---------------------------------------------------------------------------
# FakeMilvusClient — in-memory store used by every test.
# ---------------------------------------------------------------------------


class FakeMilvusClient:
    """Minimal in-memory Milvus stand-in.

    Only the surface used by ``ingest`` is implemented.  ``query`` honours
    a tiny subset of Milvus expressions:
      * empty string ``""`` → return every row
      * ``image_path == 'X'`` → return rows where ``image_path`` matches.
    """

    def __init__(self, preseeded: list[dict[str, Any]] | None = None) -> None:
        self.rows: list[dict[str, Any]] = list(preseeded or [])
        self.insert_calls: list[list[dict[str, Any]]] = []
        self.upsert_calls: list[list[dict[str, Any]]] = []
        self.dropped: list[str] = []
        self.created: list[str] = []

    def has_collection(self, name: str) -> bool:
        return name == COLLECTION_NAME

    def drop_collection(self, name: str) -> None:
        self.dropped.append(name)
        self.rows = []

    def create_collection(
        self,
        name: str,
        schema: Any = None,
        index_params: Any = None,
    ) -> None:
        del schema, index_params
        self.created.append(name)

    def insert(self, name: str, rows: list[dict[str, Any]]) -> dict[str, int]:
        del name
        self.rows.extend(rows)
        self.insert_calls.append(list(rows))
        return {"insert_count": len(rows)}

    def upsert(self, name: str, rows: list[dict[str, Any]]) -> dict[str, int]:
        del name
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
        name: str,
        filter: str,  # noqa: A002 — match real Milvus client signature
        output_fields: list[str],
    ) -> list[dict[str, Any]]:
        del name
        if filter == "":
            matched = list(self.rows)
        elif filter.startswith("image_path == '") and filter.endswith("'"):
            target = filter[len("image_path == '"): -1]
            matched = [r for r in self.rows if r.get("image_path") == target]
        else:
            matched = []
        return [
            {field: row.get(field) for field in output_fields} for row in matched
        ]

    def get_collection_stats(self, name: str) -> dict[str, Any]:
        del name
        return {"row_count": len(self.rows)}


# ---------------------------------------------------------------------------
# Fake embedding adapter + registry.
# ---------------------------------------------------------------------------


class _FakeEmbedAdapter:
    def __init__(self, *, provider: str = "openai_compatible@fake", dim: int = 8) -> None:
        self._provider = provider
        self._dim = dim

    def _provider_name(self) -> str:
        return self._provider

    def embed(
        self,
        inputs: list[str | bytes],
        *,
        model: str | None = None,  # noqa: ARG002
    ) -> list[list[float]]:
        vectors: list[list[float]] = []
        for raw in inputs:
            text = raw.decode() if isinstance(raw, bytes) else raw
            digest = hashlib.sha256(text.encode("utf-8")).digest()
            vec = [b / 255.0 for b in digest[: self._dim]]
            vectors.append(vec)
        return vectors


class _FakeRegistry:
    def __init__(self, adapter: _FakeEmbedAdapter) -> None:
        self._adapter = adapter

    def get(self, role: str) -> object:
        if role != "embedding":
            raise KeyError(role)
        return self._adapter


# ---------------------------------------------------------------------------
# CSV helpers
# ---------------------------------------------------------------------------


_HEADER = (
    "image_path,category,color,style,season,sales_count,description,price,locale"
)


def _write_csv(path: Path, rows: list[str]) -> Path:
    path.write_text("\n".join([_HEADER, *rows]) + "\n", encoding="utf-8")
    return path


def _sample_csv(tmp_path: Path) -> Path:
    rows = [
        "img/1.jpg,dress,red,casual,spring,100,red dress for spring,49.0,zh",
        "img/2.jpg,dress,blue,casual,spring,120,blue dress short sleeve,59.0,zh",
        "img/3.jpg,shoes,white,sport,summer,80,white running shoes,79.0,en",
        "img/4.jpg,bag,black,formal,autumn,40,leather handbag classic,99.0,en",
        "img/5.jpg,coat,green,formal,winter,30,wool overcoat warm,199.0,fr",
    ]
    return _write_csv(tmp_path / "rows.csv", rows)


def _factory(client: FakeMilvusClient) -> Any:
    def _make() -> FakeMilvusClient:
        return client

    return _make


# ---------------------------------------------------------------------------
# 1. append mode
# ---------------------------------------------------------------------------


def test_append_mode_inserts_all(tmp_path: Path) -> None:
    csv_path = _sample_csv(tmp_path)
    client = FakeMilvusClient()
    registry = _FakeRegistry(_FakeEmbedAdapter())

    report = ingest(
        csv_path,
        mode="append",
        registry=registry,
        milvus_client_factory=_factory(client),
        output_report_path=tmp_path / "report.json",
    )

    assert report.inserted == 5
    assert report.total_rows == 5
    assert len(client.insert_calls) == 1
    assert len(client.insert_calls[0]) == 5


# ---------------------------------------------------------------------------
# 2. replace mode
# ---------------------------------------------------------------------------


def test_replace_mode_drops_then_inserts(tmp_path: Path) -> None:
    csv_path = _sample_csv(tmp_path)
    seeded = [
        {
            "image_path": f"img/old{i}.jpg",
            "embedding_provider": "openai_compatible@old",
            "embedding_dim": 8,
        }
        for i in range(3)
    ]
    client = FakeMilvusClient(preseeded=seeded)
    registry = _FakeRegistry(_FakeEmbedAdapter())

    report = ingest(
        csv_path,
        mode="replace",
        registry=registry,
        milvus_client_factory=_factory(client),
        output_report_path=tmp_path / "report.json",
    )

    assert client.dropped == [COLLECTION_NAME]
    assert client.created == [COLLECTION_NAME]
    assert report.replaced == 5
    # rows now contains only the freshly inserted 5
    assert len(client.rows) == 5


# ---------------------------------------------------------------------------
# 3. upsert mode — same provider → skip
# ---------------------------------------------------------------------------


def test_upsert_mode_deduplicates_unchanged_rows(tmp_path: Path) -> None:
    csv_path = _write_csv(
        tmp_path / "rows.csv",
        [
            "img/1.jpg,dress,red,casual,spring,100,red dress,49.0,zh",
            "img/2.jpg,dress,blue,casual,spring,110,blue dress,59.0,zh",
        ],
    )
    seeded = [
        {
            "image_path": "img/1.jpg",
            "embedding_provider": "openai_compatible@fake",
            "embedding_dim": 8,
        },
        {
            "image_path": "img/2.jpg",
            "embedding_provider": "openai_compatible@fake",
            "embedding_dim": 8,
        },
    ]
    client = FakeMilvusClient(preseeded=seeded)
    registry = _FakeRegistry(_FakeEmbedAdapter(provider="openai_compatible@fake"))

    report = ingest(
        csv_path,
        mode="upsert",
        registry=registry,
        milvus_client_factory=_factory(client),
        output_report_path=tmp_path / "report.json",
    )

    assert report.deduplicated == 2
    assert report.recomputed_embeddings == 0
    assert client.insert_calls == []
    assert client.upsert_calls == []


# ---------------------------------------------------------------------------
# 4. upsert mode — different provider → re-embed
# ---------------------------------------------------------------------------


def test_upsert_mode_re_embeds_on_provider_change(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    csv_path = _write_csv(
        tmp_path / "rows.csv",
        ["X,dress,red,casual,spring,100,red dress,49.0,zh"],
    )
    seeded = [
        {
            "image_path": "X",
            "embedding_provider": "old",
            "embedding_dim": 8,
        }
    ]
    client = FakeMilvusClient(preseeded=seeded)
    registry = _FakeRegistry(_FakeEmbedAdapter(provider="new"))

    report = ingest(
        csv_path,
        mode="upsert",
        registry=registry,
        milvus_client_factory=_factory(client),
        output_report_path=tmp_path / "report.json",
    )

    assert report.recomputed_embeddings == 1
    assert report.upserted == 1
    assert len(client.upsert_calls) == 1
    captured = capsys.readouterr()
    assert (
        "RECOMPUTE_EMBEDDING image_path=X old_provider=old new_provider=new"
        in captured.out
    )


# ---------------------------------------------------------------------------
# 5. dim mismatch raises
# ---------------------------------------------------------------------------


def test_embedding_dim_mismatch_raises(tmp_path: Path) -> None:
    csv_path = _write_csv(
        tmp_path / "rows.csv",
        ["img/a.jpg,dress,red,casual,spring,100,red dress,49.0,zh"],
    )
    seeded = [
        {
            "image_path": "img/old.jpg",
            "embedding_provider": "openai_compatible@old",
            "embedding_dim": 512,
        }
    ]
    client = FakeMilvusClient(preseeded=seeded)
    # FakeEmbedAdapter default dim = 8 ≠ 512 → mismatch
    registry = _FakeRegistry(_FakeEmbedAdapter(dim=8))

    with pytest.raises(IngestError, match="embedding_dim mismatch"):
        ingest(
            csv_path,
            mode="append",
            registry=registry,
            milvus_client_factory=_factory(client),
            output_report_path=tmp_path / "report.json",
        )


# ---------------------------------------------------------------------------
# 6. locale report content
# ---------------------------------------------------------------------------


def test_locale_report_written(tmp_path: Path) -> None:
    rows = [
        "img/z1.jpg,dress,red,casual,spring,100,zh row,49.0,zh",
        "img/z2.jpg,dress,blue,casual,spring,100,zh row,49.0,zh",
        "img/z3.jpg,dress,green,casual,spring,100,zh row,49.0,zh",
        "img/e1.jpg,shoes,white,sport,summer,80,en row,79.0,en",
        "img/e2.jpg,shoes,black,sport,summer,80,en row,79.0,en",
        "img/f1.jpg,coat,grey,formal,winter,30,fr row,199.0,fr",
    ]
    csv_path = _write_csv(tmp_path / "rows.csv", rows)
    client = FakeMilvusClient()
    registry = _FakeRegistry(_FakeEmbedAdapter())
    report_path = tmp_path / "report.json"

    report = ingest(
        csv_path,
        mode="append",
        registry=registry,
        milvus_client_factory=_factory(client),
        output_report_path=report_path,
    )

    payload = json.loads(report_path.read_text())
    assert payload == {"zh": 3, "en": 2, "other": 1, "total": 6}
    assert report.locale_counts == {"zh": 3, "en": 2, "other": 1}


# ---------------------------------------------------------------------------
# 7. CSV missing locale column → defaults to "other"
# ---------------------------------------------------------------------------


def test_csv_parsing_handles_missing_columns(tmp_path: Path) -> None:
    """Missing ``locale`` column → default every row to ``other``.

    Documented in ``services.retrieval.ingest`` module docstring.
    """
    csv_no_locale = tmp_path / "no_locale.csv"
    csv_no_locale.write_text(
        "image_path,category,color,style,season,sales_count,description,price\n"
        "img/1.jpg,dress,red,casual,spring,100,red dress,49.0\n"
        "img/2.jpg,shoes,white,sport,summer,80,white shoes,79.0\n",
        encoding="utf-8",
    )
    client = FakeMilvusClient()
    registry = _FakeRegistry(_FakeEmbedAdapter())

    report = ingest(
        csv_no_locale,
        mode="append",
        registry=registry,
        milvus_client_factory=_factory(client),
        output_report_path=tmp_path / "report.json",
    )

    assert report.total_rows == 2
    assert report.locale_counts == {"zh": 0, "en": 0, "other": 2}


# ---------------------------------------------------------------------------
# 8. append + provider mismatch → reject (silent mixed-provider corpus)
# ---------------------------------------------------------------------------


def test_append_mode_rejects_provider_mismatch(tmp_path: Path) -> None:
    """Append silently mixes providers — reject up-front."""
    csv_path = _write_csv(
        tmp_path / "rows.csv",
        ["img/a.jpg,dress,red,casual,spring,100,red dress,49.0,zh"],
    )
    seeded = [
        {
            "image_path": "img/old.jpg",
            "embedding_provider": "openai_compatible@old",
            "embedding_dim": 8,
        }
    ]
    client = FakeMilvusClient(preseeded=seeded)
    registry = _FakeRegistry(_FakeEmbedAdapter(provider="openai_compatible@new", dim=8))

    with pytest.raises(IngestError, match="embedding_provider mismatch"):
        ingest(
            csv_path,
            mode="append",
            registry=registry,
            milvus_client_factory=_factory(client),
            output_report_path=tmp_path / "report.json",
        )


def test_upsert_mode_allows_provider_mismatch(tmp_path: Path) -> None:
    """Upsert reconciles per row (RECOMPUTE_EMBEDDING) — must NOT trip the guard."""
    csv_path = _write_csv(
        tmp_path / "rows.csv",
        ["img/x.jpg,dress,red,casual,spring,100,red dress,49.0,zh"],
    )
    seeded = [
        {
            "image_path": "img/old.jpg",
            "embedding_provider": "openai_compatible@old",
            "embedding_dim": 8,
        }
    ]
    client = FakeMilvusClient(preseeded=seeded)
    registry = _FakeRegistry(_FakeEmbedAdapter(provider="openai_compatible@new", dim=8))

    report = ingest(
        csv_path,
        mode="upsert",
        registry=registry,
        milvus_client_factory=_factory(client),
        output_report_path=tmp_path / "report.json",
    )

    # New image_path → straight insert; existing seeded row left untouched.
    assert report.inserted == 1
