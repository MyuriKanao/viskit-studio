"""US-4B.5 — SSE channel /api/kits/{kit_id}/events."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from services.imagegen.orchestrator import KitEventBus, orchestrate_kit
from tests.imagegen.conftest import (
    FakeImageGen,
    make_imagegen_registry,
    make_kit_inputs,
)


def _run(coro):  # type: ignore[no-untyped-def]
    return asyncio.run(coro)


def _populate_bus_via_orchestrator(
    tmp_path: Path,
    bus: KitEventBus,
    kit_id: str,
) -> None:
    image_gen = FakeImageGen()
    registry = make_imagegen_registry(image_gen=image_gen)
    inputs = make_kit_inputs(output_dir=tmp_path, kit_id=kit_id)
    _run(orchestrate_kit(inputs, registry=registry, event_bus=bus))


@pytest.fixture
def client_with_bus(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Iterator[TestClient]:
    monkeypatch.setenv("IMAGEGEN_OUTPUT_DIR", str(tmp_path))
    with TestClient(app) as c:
        c.app.state.registry = make_imagegen_registry()
        c.app.state.kit_event_bus = KitEventBus()
        yield c


def _read_sse_events(text: str) -> list[dict[str, object]]:
    events: list[dict[str, object]] = []
    # SSE format: each event is `data: <json>\n\n`
    for chunk in text.split("\n\n"):
        chunk = chunk.strip()
        if not chunk.startswith("data: "):
            continue
        body = chunk[len("data: "):]
        events.append(json.loads(body))
    return events


def test_sse_endpoint_streams_events_from_orchestrator(
    client_with_bus: TestClient, tmp_path: Path
) -> None:
    bus = client_with_bus.app.state.kit_event_bus
    _populate_bus_via_orchestrator(tmp_path, bus, "kit-sse-happy")

    with client_with_bus.stream(
        "GET", "/api/kits/kit-sse-happy/events"
    ) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        body = "".join(chunk for chunk in response.iter_text())
    events = _read_sse_events(body)

    # 14 enqueued + 14 in_progress + 14 terminal + 1 done = 43 minimum
    statuses = [e["status"] for e in events]
    assert statuses.count("enqueued") == 14
    assert statuses.count("in_progress") == 14
    # Final event is the kit-level "done"
    assert events[-1]["status"] == "done"
    assert events[-1]["progress"] == 14
    assert events[-1]["image_id"] == "*"


def test_sse_endpoint_emits_terminal_status_for_each_image(
    client_with_bus: TestClient, tmp_path: Path
) -> None:
    bus = client_with_bus.app.state.kit_event_bus
    _populate_bus_via_orchestrator(tmp_path, bus, "kit-sse-terminal")
    with client_with_bus.stream(
        "GET", "/api/kits/kit-sse-terminal/events"
    ) as response:
        body = "".join(chunk for chunk in response.iter_text())
    events = _read_sse_events(body)
    # Collect terminal statuses (color_locked / needs_review) per image_id
    terminal_image_ids = [
        e["image_id"]
        for e in events
        if e["status"] in {"color_locked", "needs_review"}
    ]
    expected = ["H1", "H2", "H3", "H4", "H5"] + [f"M{i}" for i in range(1, 10)]
    assert sorted(terminal_image_ids) == sorted(expected)


def test_sse_endpoint_404_on_unknown_kit_id(
    client_with_bus: TestClient,
) -> None:
    response = client_with_bus.get("/api/kits/never-published/events")
    assert response.status_code == 404


def test_sse_event_lines_parse_as_data_json_format(
    client_with_bus: TestClient, tmp_path: Path
) -> None:
    bus = client_with_bus.app.state.kit_event_bus
    _populate_bus_via_orchestrator(tmp_path, bus, "kit-sse-format")
    with client_with_bus.stream(
        "GET", "/api/kits/kit-sse-format/events"
    ) as response:
        body = "".join(chunk for chunk in response.iter_text())
    # Every non-empty `data: ...` line must parse as JSON with the
    # expected shape.
    for chunk in body.split("\n\n"):
        chunk = chunk.strip()
        if not chunk:
            continue
        assert chunk.startswith("data: "), f"non-SSE chunk: {chunk!r}"
        payload = json.loads(chunk[len("data: "):])
        for key in ("image_id", "status", "progress", "brand_color_locked"):
            assert key in payload, f"missing {key} in {payload!r}"


def test_existing_generate_route_tests_still_pass(
    client_with_bus: TestClient,
) -> None:
    """Cross-check: the SSE wiring did not break the POST route."""
    from tests.imagegen.test_generate_route import _spec_payload

    response = client_with_bus.post(
        "/api/kits/kit-sse-coexist/generate", json=_spec_payload()
    )
    assert response.status_code == 200
    assert response.json()["kit_id"] == "kit-sse-coexist"
