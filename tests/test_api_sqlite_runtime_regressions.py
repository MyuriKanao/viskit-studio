from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from apps.api.lib.db import json_param
from apps.api.routes.kits import _iso_or_none, list_kits
from apps.api.routes.metrics import _iso_week_start, get_weekly_metrics


class ApiSQLiteRuntimeRegressionTest(unittest.TestCase):
    def _session(self) -> Session:
        engine = create_engine("sqlite:///:memory:")
        session = Session(bind=engine)
        session.execute(
            text(
                "CREATE TABLE product_catalogs ("
                " id INTEGER PRIMARY KEY AUTOINCREMENT,"
                " sku TEXT NOT NULL,"
                " name TEXT NOT NULL,"
                " category TEXT"
                ")"
            )
        )
        session.execute(
            text(
                "CREATE TABLE marketing_kits ("
                " id INTEGER PRIMARY KEY AUTOINCREMENT,"
                " product_catalog_id INTEGER NOT NULL,"
                " status TEXT NOT NULL,"
                " score INTEGER,"
                " locale TEXT,"
                " created_at TEXT NOT NULL,"
                " updated_at TEXT NOT NULL"
                ")"
            )
        )
        session.execute(
            text(
                "CREATE TABLE hero_images ("
                " marketing_kit_id INTEGER NOT NULL,"
                " slot_index INTEGER NOT NULL,"
                " png_path TEXT"
                ")"
            )
        )
        session.execute(
            text(
                "CREATE TABLE detail_images ("
                " marketing_kit_id INTEGER NOT NULL,"
                " module_id TEXT NOT NULL,"
                " png_path TEXT"
                ")"
            )
        )
        session.execute(
            text(
                "CREATE TABLE generation_jobs ("
                " id TEXT PRIMARY KEY,"
                " locale TEXT,"
                " planner_payload TEXT"
                ")"
            )
        )
        session.execute(
            text(
                "CREATE TABLE generated_assets ("
                " id TEXT PRIMARY KEY,"
                " source_job_id TEXT,"
                " name TEXT NOT NULL,"
                " output_kind TEXT,"
                " png_path TEXT,"
                " metadata TEXT,"
                " created_at TEXT NOT NULL,"
                " updated_at TEXT NOT NULL"
                ")"
            )
        )
        session.execute(
            text(
                "CREATE TABLE cost_events ("
                " id INTEGER PRIMARY KEY AUTOINCREMENT,"
                " kit_id INTEGER,"
                " cost_usd NUMERIC,"
                " ts TEXT NOT NULL"
                ")"
            )
        )
        session.commit()
        return session

    def test_kits_list_accepts_sqlite_text_timestamps(self) -> None:
        session = self._session()
        try:
            session.execute(
                text(
                    "INSERT INTO product_catalogs (sku, name, category)"
                    " VALUES ('SKU-1', 'Kit', 'Beauty')"
                )
            )
            session.execute(
                text(
                    "INSERT INTO marketing_kits"
                    " (product_catalog_id, status, score, locale, created_at, updated_at)"
                    " VALUES (1, 'ready', 88, 'zh', '2026-05-21T01:02:03+00:00',"
                    " '2026-05-21 13:49:06')"
                )
            )
            session.commit()

            response = list_kits(
                session=session,
                recent=False,
                limit=24,
                offset=0,
                status=None,
                locale=None,
                min_score=None,
                category=None,
                sku=None,
                sort="created_at",
                order="desc",
            )

            self.assertEqual(response.total, 1)
            self.assertEqual(response.items[0].updated_at, "2026-05-21 13:49:06")
            self.assertEqual(len(response.items[0].thumbs), 14)
        finally:
            session.close()

    def test_kits_timestamp_serializer_accepts_native_and_text_values(self) -> None:
        value = datetime(2026, 5, 21, 13, 49, 6, tzinfo=UTC)

        self.assertEqual(_iso_or_none(value), "2026-05-21T13:49:06+00:00")
        self.assertEqual(_iso_or_none("2026-05-21 13:49:06"), "2026-05-21 13:49:06")
        self.assertEqual(_iso_or_none(None), None)

    def test_json_param_uses_plain_bind_for_sqlite(self) -> None:
        session = self._session()
        try:
            self.assertEqual(json_param(session, "snapshot"), ":snapshot")
        finally:
            session.close()

    def test_weekly_metrics_uses_sqlite_portable_sql(self) -> None:
        session = self._session()
        try:
            today = datetime.now(UTC).date()
            week_start = _iso_week_start(today)
            created_at = (week_start + timedelta(days=1)).isoformat()
            session.execute(
                text(
                    "INSERT INTO product_catalogs (sku, name, category)"
                    " VALUES ('SKU-1', 'Kit', 'Beauty')"
                )
            )
            session.execute(
                text(
                    "INSERT INTO marketing_kits"
                    " (product_catalog_id, status, score, locale, created_at, updated_at)"
                    " VALUES (1, 'ready', 90, 'zh', :created_at, :created_at)"
                ),
                {"created_at": created_at},
            )
            session.execute(
                text("INSERT INTO cost_events (kit_id, cost_usd, ts) VALUES (1, 1.25, :ts)"),
                {"ts": created_at},
            )
            session.commit()

            response = get_weekly_metrics(session=session)

            self.assertEqual(response.kits_this_week, 1)
            self.assertEqual(response.avg_compliance, 90.0)
            self.assertEqual(response.api_spend_usd_mtd, 1.25)
            self.assertEqual(response.sparks.kits[-1], 1)
            self.assertEqual(response.sparks.compliance[-1], 90.0)
            self.assertEqual(response.sparks.cost[-1], 1.25)
        finally:
            session.close()


if __name__ == "__main__":
    unittest.main()
