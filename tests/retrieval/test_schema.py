"""Tests for services/retrieval/schema.py — collection schema and index params."""

from __future__ import annotations

from pymilvus import CollectionSchema

import services.retrieval.schema as schema_mod


def test_collection_name() -> None:
    assert schema_mod.COLLECTION_NAME == "aishop_bestsellers"


def test_build_schema_returns_collection_schema() -> None:
    result = schema_mod.build_schema(768)
    assert isinstance(result, CollectionSchema)


def test_build_schema_field_count() -> None:
    result = schema_mod.build_schema(768)
    assert len(result.fields) == 15


def test_build_schema_field_names() -> None:
    result = schema_mod.build_schema(768)
    names = [f.name for f in result.fields]
    expected = [
        "id",
        "image_path",
        "image_url",
        "category",
        "color",
        "style",
        "season",
        "sales_count",
        "description",
        "price",
        "locale",
        "embedding_provider",
        "embedding_dim",
        "dense_vector",
        "sparse_vector",
    ]
    assert names == expected


def test_dense_vector_dim() -> None:
    result = schema_mod.build_schema(768)
    dense = next(f for f in result.fields if f.name == "dense_vector")
    assert dense.params["dim"] == 768


def test_image_path_max_length() -> None:
    result = schema_mod.build_schema(768)
    image_path = next(f for f in result.fields if f.name == "image_path")
    assert image_path.params["max_length"] == 500


def test_locale_max_length() -> None:
    result = schema_mod.build_schema(768)
    locale = next(f for f in result.fields if f.name == "locale")
    assert locale.params["max_length"] == 8


def test_index_params_count() -> None:
    assert len(schema_mod.INDEX_PARAMS) == 2


def test_index_params_field_names() -> None:
    field_names = {entry["field_name"] for entry in schema_mod.INDEX_PARAMS}
    assert field_names == {"dense_vector", "sparse_vector"}


def test_dense_vector_index_metric_cosine() -> None:
    dense_entry = next(e for e in schema_mod.INDEX_PARAMS if e["field_name"] == "dense_vector")
    assert dense_entry["metric_type"] == "COSINE"


def test_sparse_vector_index_metric_ip() -> None:
    sparse_entry = next(e for e in schema_mod.INDEX_PARAMS if e["field_name"] == "sparse_vector")
    assert sparse_entry["metric_type"] == "IP"
