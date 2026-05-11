"""Milvus collection schema for AIShop bestsellers retrieval."""

from __future__ import annotations

from typing import Any

from pymilvus import CollectionSchema, DataType, FieldSchema

__all__ = [
    "COLLECTION_NAME",
    "INDEX_PARAMS",
    "build_schema",
]

COLLECTION_NAME: str = "aishop_bestsellers"


def build_schema(embedding_dim: int) -> CollectionSchema:
    """Build the Milvus CollectionSchema for the bestsellers collection.

    Args:
        embedding_dim: Dimensionality of the dense embedding vector.

    Returns:
        A fully-configured CollectionSchema (no live client required).
    """
    fields = [
        FieldSchema(name="id", dtype=DataType.INT64, is_primary=True, auto_id=True),
        FieldSchema(name="image_path", dtype=DataType.VARCHAR, max_length=500),
        FieldSchema(name="image_url", dtype=DataType.VARCHAR, max_length=500),
        FieldSchema(name="category", dtype=DataType.VARCHAR, max_length=50),
        FieldSchema(name="color", dtype=DataType.VARCHAR, max_length=50),
        FieldSchema(name="style", dtype=DataType.VARCHAR, max_length=50),
        FieldSchema(name="season", dtype=DataType.VARCHAR, max_length=50),
        FieldSchema(name="sales_count", dtype=DataType.INT64),
        FieldSchema(name="description", dtype=DataType.VARCHAR, max_length=500),
        FieldSchema(name="price", dtype=DataType.FLOAT),
        FieldSchema(name="locale", dtype=DataType.VARCHAR, max_length=8),
        FieldSchema(name="embedding_provider", dtype=DataType.VARCHAR, max_length=50),
        FieldSchema(name="embedding_dim", dtype=DataType.INT32),
        FieldSchema(name="dense_vector", dtype=DataType.FLOAT_VECTOR, dim=embedding_dim),
        FieldSchema(name="sparse_vector", dtype=DataType.SPARSE_FLOAT_VECTOR),
    ]
    return CollectionSchema(
        fields=fields,
        description="AIShop bestsellers hybrid search collection",
    )


INDEX_PARAMS: list[dict[str, Any]] = [
    {
        "field_name": "dense_vector",
        "index_type": "FLAT",
        "metric_type": "COSINE",
        "params": {},
    },
    {
        "field_name": "sparse_vector",
        "index_type": "SPARSE_INVERTED_INDEX",
        "metric_type": "IP",
        "params": {},
    },
]
