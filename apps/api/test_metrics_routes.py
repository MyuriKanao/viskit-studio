from __future__ import annotations

import os
import tempfile
import unittest
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from apps.api.lib import db as db_mod
from apps.api.lib.db import get_session
from apps.api.routes.metrics import _iso_week_start
from apps.api.routes.metrics import router as metrics_router


@contextmanager
def session_scope() -> Iterator[Session]:
    generator = get_session()
    session = next(generator)
    try:
        yield session
        try:
            next(generator)
        except StopIteration:
            pass
    finally:
        generator.close()


class MetricsRouteTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        os.environ["DATABASE_URL"] = f"sqlite:///{self.root / 'viskit-test.db'}"
        os.environ["VISKIT_BOOTSTRAP_WORKSPACE"] = "0"
        db_mod._engine = None
        db_mod._SessionLocal = None
        db_mod.ensure_schema()

        app = FastAPI()
        app.include_router(metrics_router)
        self.client = TestClient(app)

    def tearDown(self) -> None:
        self.tmp.cleanup()
        db_mod._engine = None
        db_mod._SessionLocal = None

    def test_weekly_compliance_averages_marketing_kit_scores(self) -> None:
        today = datetime.now(UTC).date()
        week_start = _iso_week_start(today)
        current_week = datetime.combine(week_start, datetime.min.time(), tzinfo=UTC)
        previous_week = current_week - timedelta(weeks=1)

        with session_scope() as session:
            session.execute(
                text(
                    "INSERT INTO users (id, username, password_hash)"
                    " VALUES (1, 'tester', 'hash')"
                )
            )
            session.execute(
                text(
                    "INSERT INTO workbenches (id, name, owner_user_id)"
                    " VALUES (1, 'bench', 1)"
                )
            )
            session.execute(
                text(
                    "INSERT INTO product_catalogs (id, workbench_id, sku, name)"
                    " VALUES (1, 1, 'SKU-1', 'Product')"
                )
            )
            rows = [
                (1, 80, current_week.isoformat()),
                (2, 100, (current_week + timedelta(days=1)).isoformat()),
                (3, None, (current_week + timedelta(days=2)).isoformat()),
                (4, 10, previous_week.isoformat()),
            ]
            for kit_id, score, created_at in rows:
                session.execute(
                    text(
                        "INSERT INTO marketing_kits"
                        " (id, product_catalog_id, status, score, style_prompt, created_at)"
                        " VALUES (:id, 1, 'ready', :score, 'style', :created_at)"
                    ),
                    {"id": kit_id, "score": score, "created_at": created_at},
                )

        response = self.client.get("/api/metrics/weekly")
        self.assertEqual(response.status_code, 200)
        body = response.json()

        self.assertEqual(body["kits_this_week"], 3)
        self.assertEqual(body["avg_compliance"], 90.0)
        self.assertEqual(body["sparks"]["kits"][-1], 3)
        self.assertEqual(body["sparks"]["compliance"][-1], 90.0)


if __name__ == "__main__":
    unittest.main()
