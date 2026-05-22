from __future__ import annotations

import asyncio
import os
import tempfile
import threading
import time
import unittest
from collections.abc import AsyncIterator, Iterator
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from apps.api.lib import db as db_mod
from apps.api.lib.db import get_session
from apps.api.routes.generation_jobs import (
    GenerationEventBus,
    _run_generation_job,
)
from apps.api.routes.generation_jobs import (
    router as generation_jobs_router,
)
from services.imagegen.orchestrator import KitEventBus


async def next_event(stream: AsyncIterator[dict[str, Any]]) -> dict[str, Any]:
    return await anext(stream)


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


class GenerationJobsRouteTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.output_dir = self.root / "imagegen"
        os.environ["DATABASE_URL"] = f"sqlite:///{self.root / 'viskit-test.db'}"
        os.environ["IMAGEGEN_OUTPUT_DIR"] = str(self.output_dir)
        os.environ["VISKIT_BOOTSTRAP_WORKSPACE"] = "0"
        db_mod._engine = None
        db_mod._SessionLocal = None
        db_mod.ensure_schema()

        self.result_path = self.output_dir / "jobs" / "job_done" / "product_main.png"
        self.result_path.parent.mkdir(parents=True, exist_ok=True)
        self.result_path.write_bytes(b"generated png")

        with session_scope() as session:
            session.execute(
                text(
                    "INSERT INTO source_images"
                    " (id, storage_path, mime_type, size_bytes)"
                    " VALUES ('src_test', :source_path, 'image/png', 12)"
                ),
                {"source_path": str(self.output_dir / "source.png")},
            )
            session.execute(
                text(
                    "INSERT INTO generation_jobs"
                    " (id, status, source_image_ref, user_prompt, locale,"
                    "  planner_payload, created_at)"
                    " VALUES"
                    " ('job_running', 'running', 'src_test', 'running prompt', 'zh', '{}',"
                    "  '2026-05-21T10:00:00'),"
                    " ('job_done', 'succeeded', 'src_test', 'done prompt', 'zh', '{}',"
                    "  '2026-05-21T11:00:00')"
                )
            )
            session.execute(
                text(
                    "INSERT INTO generation_outputs"
                    " (id, job_id, output_key, output_kind, template_ref, width, height,"
                    "  prompt, status, destination_type, png_path, sort_order)"
                    " VALUES"
                    " ('out_done', 'job_done', 'product_main', 'product_main',"
                    "  'builtin:zh:hero-image', 1024, 1024, 'prompt', 'succeeded',"
                    "  'asset', :png_path, 0),"
                    " ('out_running', 'job_running', 'product_main', 'product_main',"
                    "  'builtin:zh:hero-image', 1024, 1024, 'prompt', 'running',"
                    "  'asset', NULL, 0)"
                ),
                {"png_path": str(self.result_path)},
            )

        app = FastAPI()
        app.include_router(generation_jobs_router)
        self.client = TestClient(app)

    def tearDown(self) -> None:
        self.tmp.cleanup()
        db_mod._engine = None
        db_mod._SessionLocal = None

    def test_list_generation_jobs_returns_recent_records_with_outputs(self) -> None:
        response = self.client.get("/api/generation/jobs")
        self.assertEqual(response.status_code, 200)
        body = response.json()

        self.assertEqual(body["total"], 2)
        self.assertEqual(body["limit"], 50)
        self.assertEqual(body["offset"], 0)
        self.assertEqual([job["id"] for job in body["jobs"]], ["job_done", "job_running"])
        done = body["jobs"][0]
        self.assertEqual(done["status"], "succeeded")
        self.assertEqual(done["user_prompt"], "done prompt")
        self.assertEqual(done["outputs"][0]["status"], "succeeded")
        self.assertEqual(
            done["outputs"][0]["image_url"], "/api/generation/jobs/job_done/outputs/out_done/image"
        )

    def test_list_generation_jobs_can_filter_by_status(self) -> None:
        response = self.client.get("/api/generation/jobs?status=running")
        self.assertEqual(response.status_code, 200)
        body = response.json()

        self.assertEqual(body["total"], 1)
        self.assertEqual(body["jobs"][0]["id"], "job_running")

    def test_list_generation_jobs_paginates_records(self) -> None:
        response = self.client.get("/api/generation/jobs?limit=1&offset=1")
        self.assertEqual(response.status_code, 200)
        body = response.json()

        self.assertEqual(body["total"], 2)
        self.assertEqual(body["limit"], 1)
        self.assertEqual(body["offset"], 1)
        self.assertEqual([job["id"] for job in body["jobs"]], ["job_running"])

    def test_run_generation_job_processes_outputs_concurrently(self) -> None:
        with session_scope() as session:
            session.execute(
                text(
                    "INSERT INTO generation_jobs"
                    " (id, status, source_image_ref, user_prompt, locale, planner_payload)"
                    " VALUES ('job_parallel', 'queued', 'src_test', 'parallel prompt', 'zh', '{}')"
                )
            )
            for idx in range(4):
                session.execute(
                    text(
                        "INSERT INTO generation_outputs"
                        " (id, job_id, output_key, output_kind, template_ref, width, height,"
                        "  prompt, status, destination_type, sort_order)"
                        " VALUES (:id, 'job_parallel', :key, 'product_main',"
                        "  'builtin:zh:hero-image', 1024, 1024, :prompt, 'queued', 'asset', :idx)"
                    ),
                    {
                        "id": f"out_parallel_{idx}",
                        "key": f"out_{idx}",
                        "prompt": f"prompt {idx}",
                        "idx": idx,
                    },
                )

        class FakeImageAdapter:
            def __init__(self) -> None:
                self.active = 0
                self.max_active = 0
                self.lock = threading.Lock()

            def generate(self, *_args: object, **kwargs: Any) -> SimpleNamespace:
                with self.lock:
                    self.active += 1
                    self.max_active = max(self.max_active, self.active)
                time.sleep(0.05)
                with self.lock:
                    self.active -= 1
                image_id = str(kwargs["image_id"])
                return SimpleNamespace(images=[image_id.encode("utf-8")])

        class FakeRegistry:
            def __init__(self, adapter: FakeImageAdapter) -> None:
                self.adapter = adapter

            def get(self, role: str) -> FakeImageAdapter:
                if role != "image":
                    raise KeyError(role)
                return self.adapter

        adapter = FakeImageAdapter()
        old_concurrency = os.environ.get("VISKIT_GENERATION_JOB_CONCURRENCY")
        os.environ["VISKIT_GENERATION_JOB_CONCURRENCY"] = "3"
        try:
            app = SimpleNamespace(state=SimpleNamespace(registry=FakeRegistry(adapter)))
            asyncio.run(_run_generation_job(app, "job_parallel"))
        finally:
            if old_concurrency is None:
                os.environ.pop("VISKIT_GENERATION_JOB_CONCURRENCY", None)
            else:
                os.environ["VISKIT_GENERATION_JOB_CONCURRENCY"] = old_concurrency

        self.assertGreaterEqual(adapter.max_active, 2)
        with session_scope() as session:
            status = session.execute(
                text("SELECT status FROM generation_jobs WHERE id = 'job_parallel'")
            ).scalar_one()
            output_statuses = (
                session.execute(
                    text(
                        "SELECT status FROM generation_outputs"
                        " WHERE job_id = 'job_parallel' ORDER BY sort_order"
                    )
                )
                .scalars()
                .all()
            )
            asset_count = session.execute(
                text("SELECT COUNT(*) FROM generated_assets WHERE source_job_id = 'job_parallel'")
            ).scalar_one()

        self.assertEqual(status, "succeeded")
        self.assertEqual(output_statuses, ["succeeded", "succeeded", "succeeded", "succeeded"])
        self.assertEqual(asset_count, 4)

    def test_generation_event_bus_fans_out_and_releases_closed_topics(self) -> None:
        async def run() -> None:
            bus = GenerationEventBus()
            first = bus.subscribe("job_stream")
            second = bus.subscribe("job_stream")
            first_event: asyncio.Task[dict[str, Any]] = asyncio.create_task(next_event(first))
            second_event: asyncio.Task[dict[str, Any]] = asyncio.create_task(next_event(second))
            await asyncio.sleep(0)

            await bus.publish("job_stream", {"status": "running"})

            self.assertEqual(await first_event, {"status": "running"})
            self.assertEqual(await second_event, {"status": "running"})

            first_close: asyncio.Task[dict[str, Any]] = asyncio.create_task(next_event(first))
            second_close: asyncio.Task[dict[str, Any]] = asyncio.create_task(next_event(second))
            await asyncio.sleep(0)
            bus.close("job_stream")

            with self.assertRaises(StopAsyncIteration):
                await first_close
            with self.assertRaises(StopAsyncIteration):
                await second_close
            self.assertNotIn("job_stream", bus._subscribers)
            self.assertNotIn("job_stream", bus._known)

        asyncio.run(run())

    def test_kit_event_bus_fans_out_and_releases_closed_topics(self) -> None:
        async def run() -> None:
            bus = KitEventBus()
            first = bus.subscribe("kit_stream")
            second = bus.subscribe("kit_stream")
            first_event: asyncio.Task[dict[str, Any]] = asyncio.create_task(next_event(first))
            second_event: asyncio.Task[dict[str, Any]] = asyncio.create_task(next_event(second))
            await asyncio.sleep(0)

            await bus.publish("kit_stream", {"image_id": "H1", "status": "running"})

            self.assertTrue(bus.has_kit("kit_stream"))
            self.assertEqual(await first_event, {"image_id": "H1", "status": "running"})
            self.assertEqual(await second_event, {"image_id": "H1", "status": "running"})

            first_close: asyncio.Task[dict[str, Any]] = asyncio.create_task(next_event(first))
            second_close: asyncio.Task[dict[str, Any]] = asyncio.create_task(next_event(second))
            await asyncio.sleep(0)
            bus.close("kit_stream")

            with self.assertRaises(StopAsyncIteration):
                await first_close
            with self.assertRaises(StopAsyncIteration):
                await second_close
            self.assertFalse(bus.has_kit("kit_stream"))
            self.assertNotIn("kit_stream", bus._subscribers)
            self.assertNotIn("kit_stream", bus._known)

        asyncio.run(run())

    def test_terminal_generation_job_events_stream_ends_after_snapshot(self) -> None:
        response = self.client.get("/api/generation/jobs/job_done/events")

        self.assertEqual(response.status_code, 200)
        self.assertIn("event: snapshot", response.text)
        self.assertIn('"status": "succeeded"', response.text)
        self.assertNotIn("event: update", response.text)


if __name__ == "__main__":
    unittest.main()
