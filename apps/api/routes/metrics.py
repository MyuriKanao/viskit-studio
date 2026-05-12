"""GET /api/metrics/weekly — Dashboard KPI strip aggregations.

Aggregates LIVE from ``marketing_kits`` + ``compliance_checks`` + ``cost_events``
tables (no separate ``weekly_metrics`` cache).  Returns the current ISO-week
bucket (Mon-Sun) along with 12-week sparkline arrays for kits/compliance/cost.

``avg_manual_edit_min`` is NULL for v1 — no edit-time tracking surface yet.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from apps.api.lib.db import get_session

router = APIRouter(prefix="/api/metrics", tags=["metrics"])


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class Sparks(BaseModel):
    kits: list[int]
    compliance: list[float]
    cost: list[float]


class WeeklyMetricsResponse(BaseModel):
    kits_this_week: int
    avg_compliance: float | None
    avg_manual_edit_min: float | None
    api_spend_usd_mtd: float
    sparks: Sparks


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _iso_week_start(today: date) -> date:
    """Return Monday of *today*'s ISO week (Mon=0)."""
    return today - timedelta(days=today.weekday())


def _month_start(today: date) -> date:
    return today.replace(day=1)


def _twelve_week_starts(today: date) -> list[date]:
    """Return the Monday of each of the past 12 ISO weeks (oldest first)."""
    this_monday = _iso_week_start(today)
    return [this_monday - timedelta(weeks=11 - i) for i in range(12)]


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------


@router.get("/weekly", response_model=WeeklyMetricsResponse)
def get_weekly_metrics(
    session: Annotated[Session, Depends(get_session)],
) -> WeeklyMetricsResponse:
    """Aggregate live metrics — current-ISO-week kits + 12-week sparklines."""
    today = datetime.now(UTC).date()
    week_start = _iso_week_start(today)
    week_end_exclusive = week_start + timedelta(days=7)
    month_start = _month_start(today)
    starts = _twelve_week_starts(today)
    window_start = starts[0]
    window_end_exclusive = starts[-1] + timedelta(days=7)

    # Current-week kits count
    kits_this_week_row = session.execute(
        text(
            "SELECT COUNT(*) FROM marketing_kits"
            " WHERE created_at >= :start AND created_at < :end"
        ),
        {"start": week_start, "end": week_end_exclusive},
    ).scalar()
    kits_this_week = int(kits_this_week_row or 0)

    # Current-week avg compliance — JOIN copywriting_specs -> compliance_checks
    avg_compliance_row = session.execute(
        text(
            "SELECT AVG(cc.score)::float FROM compliance_checks cc"
            " JOIN copywriting_specs cs ON cs.id = cc.copywriting_spec_id"
            " JOIN marketing_kits mk ON mk.id = cs.marketing_kit_id"
            " WHERE mk.created_at >= :start AND mk.created_at < :end"
        ),
        {"start": week_start, "end": week_end_exclusive},
    ).scalar()
    avg_compliance = (
        float(avg_compliance_row) if avg_compliance_row is not None else None
    )

    # MTD api spend
    spend_row = session.execute(
        text(
            "SELECT COALESCE(SUM(cost_usd), 0)::float FROM cost_events"
            " WHERE ts >= :start AND ts < :end"
        ),
        {"start": month_start, "end": today + timedelta(days=1)},
    ).scalar()
    api_spend_usd_mtd = float(spend_row or 0.0)

    # 12-week sparks — gather per-week aggregates, then index into starts list.
    # Kits per week
    kit_rows = session.execute(
        text(
            "SELECT date_trunc('week', created_at)::date AS wk, COUNT(*) AS n"
            " FROM marketing_kits"
            " WHERE created_at >= :start AND created_at < :end"
            " GROUP BY wk"
        ),
        {"start": window_start, "end": window_end_exclusive},
    ).all()
    kit_map: dict[date, int] = {row.wk: int(row.n) for row in kit_rows}
    sparks_kits = [kit_map.get(s, 0) for s in starts]

    # Compliance per week — average of scored kits per week
    comp_rows = session.execute(
        text(
            "SELECT date_trunc('week', mk.created_at)::date AS wk,"
            " AVG(cc.score)::float AS avg_score"
            " FROM compliance_checks cc"
            " JOIN copywriting_specs cs ON cs.id = cc.copywriting_spec_id"
            " JOIN marketing_kits mk ON mk.id = cs.marketing_kit_id"
            " WHERE mk.created_at >= :start AND mk.created_at < :end"
            " GROUP BY wk"
        ),
        {"start": window_start, "end": window_end_exclusive},
    ).all()
    comp_map: dict[date, float] = {
        row.wk: float(row.avg_score) for row in comp_rows if row.avg_score is not None
    }
    sparks_compliance = [comp_map.get(s, 0.0) for s in starts]

    # Cost per week
    cost_rows = session.execute(
        text(
            "SELECT date_trunc('week', ts)::date AS wk,"
            " COALESCE(SUM(cost_usd), 0)::float AS total"
            " FROM cost_events"
            " WHERE ts >= :start AND ts < :end"
            " GROUP BY wk"
        ),
        {"start": window_start, "end": window_end_exclusive},
    ).all()
    cost_map: dict[date, float] = {row.wk: float(row.total) for row in cost_rows}
    sparks_cost = [cost_map.get(s, 0.0) for s in starts]

    return WeeklyMetricsResponse(
        kits_this_week=kits_this_week,
        avg_compliance=avg_compliance,
        avg_manual_edit_min=None,
        api_spend_usd_mtd=api_spend_usd_mtd,
        sparks=Sparks(
            kits=sparks_kits,
            compliance=sparks_compliance,
            cost=sparks_cost,
        ),
    )
