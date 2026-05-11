"""GET /api/queue/active — snapshot of in-process orchestrator state.

Reads ``app.state.kit_event_bus`` (a :class:`KitEventBus`) and surfaces a list
of kits currently being generated.  The bus is a thin in-process surface; we
infer "active" by inspecting which kit_ids have an open queue.  Each entry
carries a 5-stage progression list (preflight → enqueued → in_progress →
color_locked → done) so the Dashboard's QueueRow component can render a
stepper UI.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel

router = APIRouter(prefix="/api/queue", tags=["queue"])


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


StageStatus = Literal["done", "active", "queued"]


class QueueJob(BaseModel):
    kit_id: str
    sku: str | None
    name: str | None
    locale: str | None
    stages: list[StageStatus]
    current_stage: str
    eta_ms: int


class QueueActiveResponse(BaseModel):
    jobs: list[QueueJob]


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------


# Default stage progression — five stages aligned with the orchestrator's
# publish sequence (see services.imagegen.orchestrator).
_STAGE_ORDER: tuple[str, ...] = (
    "preflight",
    "enqueued",
    "in_progress",
    "color_locked",
    "done",
)


def _snapshot_bus(bus: object | None) -> list[QueueJob]:
    """Best-effort snapshot of currently active kit_ids on the event bus.

    The bus keeps an internal ``_queues`` dict keyed by ``kit_id``; we read
    it under the bus's lock when available, otherwise fall back to an empty
    list.  This is deliberately conservative: any future bus change that
    drops ``_queues`` will simply return an empty queue strip rather than
    crash the dashboard.
    """
    if bus is None:
        return []
    queues = getattr(bus, "_queues", None)
    lock = getattr(bus, "_lock", None)
    if queues is None:
        return []
    if lock is not None:
        with lock:
            kit_ids = list(queues.keys())
    else:
        kit_ids = list(queues.keys())

    jobs: list[QueueJob] = []
    for kit_id in kit_ids:
        jobs.append(
            QueueJob(
                kit_id=str(kit_id),
                sku=None,
                name=None,
                locale=None,
                # All stages flagged active by default — the kit is alive on
                # the bus but we don't have per-image state without parsing
                # historic events. Frontend treats this as "in progress".
                stages=["active"] * len(_STAGE_ORDER),
                current_stage="in_progress",
                eta_ms=0,
            )
        )
    return jobs


@router.get("/active", response_model=list[QueueJob])
def get_active_queue(req: Request) -> list[QueueJob]:
    """Return the snapshot of active kits.  Empty list when idle."""
    bus = getattr(req.app.state, "kit_event_bus", None)
    return _snapshot_bus(bus)
