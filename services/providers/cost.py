"""Cost-tracking accumulator for AIShop Studio.

Provides fire-and-forget helpers to record provider call costs into the
``cost_events`` table and to aggregate totals per marketing kit.

Design notes:
- Uses ``apps.api.lib.db._get_engine()`` — never creates its own engine.
- All SQL is parametrised via ``sqlalchemy.text()`` — no f-string SQL.
- No vendor names: provider_name values use protocol-family identifiers
  such as ``openai_compatible@<alias>`` or ``anthropic_compatible@<alias>``.
"""

from __future__ import annotations

from sqlalchemy import text

from apps.api.lib.db import _get_engine


def record(
    kit_id: int | None,
    role: str,
    provider_name: str,
    *,
    tokens_in: int = 0,
    tokens_out: int = 0,
    image_count: int = 0,
    resolution: str | None = None,
    cost_usd: float,
) -> int:
    """Insert one row into cost_events. Returns the new row's id."""
    engine = _get_engine()
    stmt = text(
        """
        INSERT INTO cost_events
            (kit_id, role, provider_name, tokens_in, tokens_out,
             image_count, resolution, cost_usd)
        VALUES
            (:kit_id, :role, :provider_name, :tokens_in, :tokens_out,
             :image_count, :resolution, :cost_usd)
        RETURNING id
        """
    )
    params = {
        "kit_id": kit_id,
        "role": role,
        "provider_name": provider_name,
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
        "image_count": image_count,
        "resolution": resolution,
        "cost_usd": cost_usd,
    }
    with engine.begin() as conn:
        result = conn.execute(stmt, params)
        raw = result.scalar()
    assert raw is not None, "INSERT RETURNING id returned NULL"
    return int(raw)


def total_for_kit(kit_id: int) -> float:
    """Return SUM(cost_usd) over all cost_events for this kit_id.

    Returns 0.0 if no rows exist for the given kit_id.
    """
    engine = _get_engine()
    stmt = text(
        "SELECT COALESCE(SUM(cost_usd), 0) FROM cost_events WHERE kit_id = :kit_id"
    )
    with engine.begin() as conn:
        result = conn.execute(stmt, {"kit_id": kit_id})
        value = result.scalar()
    return float(value) if value is not None else 0.0
