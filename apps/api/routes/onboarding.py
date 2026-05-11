"""GET /api/onboarding/needed — Critic OD-5 predicate.

Returns ``{needs_onboarding: bool}`` derived from the v2 predicate::

    EXISTS (SELECT 1 FROM users
            WHERE password_hash IS NOT NULL AND length(password_hash) > 0)

When the predicate is TRUE (a real-hash user exists), onboarding is NOT
needed.  When FALSE (no users OR every users.password_hash row is NULL/empty),
onboarding is needed.

Partial-row edge case: the ``users.password_hash`` column carries a
``CHECK (length(password_hash) > 0)`` constraint plus ``NOT NULL``, so the
"row exists with NULL hash" branch is DB-impossible in production.  The SQL
predicate is still defensive against both NULL and empty-string values for
forensic robustness (and for tests that bypass the application layer to
insert rows via direct connection).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from apps.api.lib.db import get_session

router = APIRouter(prefix="/api/onboarding", tags=["onboarding"])


class OnboardingNeededResponse(BaseModel):
    needs_onboarding: bool


@router.get("/needed", response_model=OnboardingNeededResponse)
def get_onboarding_needed(
    session: Session = Depends(get_session),
) -> OnboardingNeededResponse:
    """Return whether onboarding is needed for this workspace."""
    row = session.execute(
        text(
            "SELECT EXISTS (SELECT 1 FROM users"
            " WHERE password_hash IS NOT NULL AND length(password_hash) > 0)"
        )
    ).scalar()
    has_user = bool(row)
    return OnboardingNeededResponse(needs_onboarding=not has_user)
