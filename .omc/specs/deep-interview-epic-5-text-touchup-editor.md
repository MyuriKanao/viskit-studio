# Deep Interview Spec: EPIC-5 — Text-touchup Editor

## Metadata
- Interview Date: 2026-05-11 → 2026-05-12 (Rounds 1–6 on 05-11, Rounds 7–8 on 05-12)
- Rounds: 8
- Final Ambiguity Score: ~3.2% (8 of 8 ambiguity points resolved)
- Type: brownfield
- Threshold: 20%
- Status: PASSED
- Plan reference: `.omc/plans/aishop-studio-v1-plan.md` lines 338-357
- Sibling specs:
  - `.omc/specs/deep-interview-aishop-img-studio.md` (project-level; EPIC-5 was covered at high level)
  - `.omc/specs/deep-interview-epic-6-web-shell.md` (shell + atoms + tokens — foundation EPIC-5 plugs into)
  - `.omc/specs/deep-interview-epic-7-hero-pages.md` (Dashboard / Kit Detail / Providers / Onboarding; EPIC-5 must NOT break the visual baselines)
- Design-brief screen: `.omc/specs/design-brief.md` screen 5 (Image Editor), lines 185-194 (TextLayerOverlay component clause)
- Resumed from: `.omc/state/deep-interview-state-epic-5-paused.json` (Round 6 / 8.8% — paused for EPIC-6 visual drift investigation; EPIC-6 + EPIC-7 shipped in the interim)

## Clarity Breakdown
| Dimension          | Score | Weight | Weighted |
|--------------------|-------|--------|----------|
| Goal Clarity       | 0.98  | 35%    | 0.343    |
| Constraint Clarity | 0.97  | 25%    | 0.243    |
| Success Criteria   | 0.96  | 25%    | 0.240    |
| Context Clarity    | 0.96  | 15%    | 0.144    |
| **Total Clarity**  |       |        | **0.970**|
| **Ambiguity**      |       |        | **0.030 (~3.0%)** |

## Goal

Ship the **Image Editor** screen (`/[locale]/editor/[image_id]`) so a human operator can repair Chinese-text glitches in a single 1024×1536 generated image in **≤2 min/SKU** (ADR-007). The editor is a full-screen modal route per design-brief.md screen 5, composed of four primary regions:

1. **CanvasStage** — fabric.js@6 canvas, dynamically imported with `ssr: false`. Hosts the base image + N text layers + optional inpaint preview overlay. StrictMode-safe lifecycle via `useEffect` dispose + mount-guard ref. Imperative-only inside fabric event handlers (no `setState` during `object:moving` / `object:scaling`); commit on `mouse:up`.
2. **TextLayerOverlay** — translucent boxes drawn over OCR-detected text regions; clicking a box selects the corresponding fabric.Text layer; hovering shows the original detected string.
3. **ToolRail** — 6-button vertical rail on the left: **Select / Text-edit / Move / Inpaint / Undo / Redo**. Per-button states: `idle | active | disabled | loading`. Keyboard shortcuts: `V / T / M / I / Ctrl+Z / Ctrl+Shift+Z`. Tooltips via shadcn `Tooltip`.
4. **HistoryTimeline** — horizontal strip at the bottom showing the Command stack (`edit_text`, `move_layer`, `inpaint`, `revert`) with timestamps + thumb of canvas snapshot per op; click-to-jump.

The editor backs onto:
- `POST /api/images/{id}/ocr` → PaddleOCR server-side, returns text boxes for TextLayerOverlay seeding.
- `POST /api/images/{id}/edit` + `GET /api/images/{id}/edit/events` (SSE) → AI inpaint via the new `image_edit` provider role.
- Postgres `image_edits` (extended) → durable per-inpaint-op row.
- MinIO `kits/{kit_id}/edited/{image_id}.png` → sidecar PNG overwritten per inpaint op; original stays immutable at `kits/{kit_id}/{hero|detail}/{image_id}.png`.

This closes the original 13-epic v1 plan; with EPIC-5 shipped, the full v1 user journey (new-kit → generate → fix-zh-text → publish) is end-to-end testable. Remaining EPICs (8–13) are catalog/vault/templates and operational polish.

## Constraints (Locked Decisions)

### R1. UI scope — full screen-5 (locked)
**Full design-brief screen 5**: CanvasStage + TextLayerOverlay + ToolRail + HistoryTimeline. NOT minimum (no "1 inpaint button + history undo only" shortcut). Rationale: the design-brief committed to text-layer overlay UX and the 4-region layout is the AC#5 history-test surface.

### R2. History model — Command pattern + fabric JSON snapshot per op (locked)
- **Pattern.** Command stack (`undoStack: Command[]`, `redoStack: Command[]`) where each `Command = { op_type, payload, snapshot_json, ts }`.
- **Snapshot.** `fabric.toJSON(['customProps'])` captured per op; `loadFromJSON()` on undo/redo.
- **Bounded stack cap 50.** Older ops dropped from the bottom (FIFO eviction) once stack length exceeds 50. AC#5's "10+ edits" easily fits.
- **Persistence boundary.**
  - Canvas-only ops (`edit_text`, `move_layer`) are **in-memory only** — never hit Postgres. Satisfies AC#3 (<300ms write-time).
  - Inpaint ops are **persisted to Postgres** via `image_edits` extended row (one row per inpaint commit; canvas-only edits are NOT persisted).
- **No CRDT, no immer.** Single-tenant single-tab; concurrent-edit handling is out of scope.

### R3. OCR engine — PaddleOCR server-side (locked)
- **Engine.** PaddleOCR (Chinese-first; ZH+EN bilingual model).
- **Wiring.** New FastAPI route `POST /api/images/{id}/ocr` returns `{boxes: [{x, y, w, h, text, confidence}], engine: "paddleocr", version: "x.y"}`. Cached per `image_id`.
- **Provider role.** OCR is **NOT** a provider-role abstraction (not in `services/providers/base.py`); it lives as a server-side service `services/editor/ocr.py` because PaddleOCR is purely local-Python (no API key, no `protocol/role` semantics, no env-var resolution).
- **Test fake.** `tests/editor/conftest.py:FakeOCR` returns deterministic fixture boxes for the 10 zh fixtures.
- **AC#2 formula.** `ratio = sum(detected_boxes_with_iou_ge_0.5_to_ground_truth) / sum(ground_truth_boxes); assert ratio >= 0.90` on the 10-image fixture set.

### R4. Inpaint provider — `image_edit` is the 5th protocol role (locked)
- **Protocol addition.** `services/providers/base.py` gains `class ImageEdit(Protocol)` with `edit(*, image: bytes, mask: bytes, prompt: str, size: str, **kwargs) -> ImageEditResponse`. The corresponding `ImageEditResponse` dataclass mirrors `ImageGenResponse` shape (`{image: bytes, model, raw, task_id}`).
- **Registry.** `image_edit` becomes the **5th mandatory** role at startup alongside `chat`/`vision`/`image_gen`/`embedding`/`compliance_screen`. Startup loud-fail if any provider is unbound.
- **Adapter.** `services/providers/apimart/image_edit.py` calls `POST {base_url}/v1/images/edits` (GPT-Image-2 endpoint shape) with multipart `image` + `mask` + `prompt` fields.
- **Test fake.** `tests/editor/conftest.py:FakeImageEdit` Pillow-composites a deterministic solid overlay onto the `mask` region of the input PNG and returns the bytes. Mirrors the `FakeImageGen` shape from `tests/imagegen/conftest.py`. `FAKE_IMAGE_EDIT_KEY` is already auto-set in `tests/imagegen/conftest.py:_set_fake_provider_env_vars` (just needs to be referenced by `tests/editor/conftest.py` too).

### R5. MinIO strategy — sidecar (locked)
- **Layout.**
  - `kits/{kit_id}/{hero|detail}/{image_id}.png` — original, **immutable** post-generate.
  - `kits/{kit_id}/edited/{image_id}.png` — sidecar, overwritten per inpaint commit.
- **Read path.** EPIC-7 kit-detail rendering (and any future viewer) prefers sidecar; falls back to original if sidecar absent (HEAD-check or 404-on-GET, whichever is cheaper).
- **Revert semantics.** `op_type='revert'`: DELETE the sidecar object + INSERT a new `image_edits` row with `op_type='revert'` referencing the prior inpaint op id. After a revert, kit-detail falls back to the original. **Note:** revert is OUT of scope for EPIC-5 AC list (R6 doesn't require it); the data model supports it for EPIC-10 polish.

### R6. AC#1 scripted ops — `edit_text → move_layer → inpaint + 1 undo + 1 redo` (locked)
- **Sequence (in order).**
  1. `edit_text` (canvas-only) — replace OCR-detected box #2's text with the corrected zh string. Budget: ~3s in scripted mode.
  2. `move_layer` (canvas-only) — reposition the edited text layer by (+24, -12) px. Budget: ~2s.
  3. `inpaint` (AI round-trip) — mask the OCR-error region, prompt-rewrite via `image_edit`. Budget: ~20s p95 (per AC#4).
  4. `undo` — revert inpaint via `loadFromJSON` from the prior snapshot. Budget: <300ms (canvas-only).
  5. `redo` — re-apply inpaint snapshot (no new API call). Budget: <300ms.
- **Wall-clock budget.** ~30s (3 + 2 + 20 + 0.3 + 0.3 + ~4s of scripted-step setup overhead) vs the 90s AC#1 ceiling — **~3× headroom**.
- **Determinism.** All providers swapped to `FakeImageEdit`+`FakeOCR` in the test registry; `time.sleep` calls budgeted into the fake to simulate the SSE stream cadence.

### R7. Fabric.js + Next.js 14 SSR lifecycle (NEW — locked 2026-05-12)
- **Dynamic import + `ssr: false`.** `CanvasStage` is imported via `next/dynamic` with `ssr: false` and a skeleton fallback. Required because fabric.js touches `document` / `HTMLCanvasElement` at module-init time.
- **StrictMode handling — `useEffect` dispose + mount-guard ref.**
  ```ts
  const initRef = useRef(false);
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    const fab = new fabric.Canvas(canvasElRef.current!, {...});
    fabricRef.current = fab;
    return () => {
      fab.dispose();
      initRef.current = false;
      fabricRef.current = null;
    };
  }, []);
  ```
  StrictMode stays ON globally. The mount-guard skips the second StrictMode mount; the dispose cleanup runs cleanly. HMR triggers a clean dispose+recreate (canvas state lost across save — acceptable for dev only).
- **No sessionStorage HMR persistence.** Rejected: edge cases (>5MB sessionStorage cap on large PNGs) outweigh the dev-loop convenience.
- **React 18 transitions inside fabric handlers — imperative ref + commit on `mouse:up`.**
  - During `object:moving` / `object:scaling`: pure imperative mutation, **NO `setState`**, **NO `startTransition`**. Fabric handles its own render loop at 60fps.
  - On `mouse:up`: capture `fabric.toJSON()` into the Command stack, then a single `setState` on the HistoryTimeline store. One re-render per op, zero re-renders during drag.
  - Rationale: AC#3 (<300ms canvas-only write) is trivially met because there is no React work during the drag. AC#5 (10+ edits no state corruption) is met because history is updated atomically once per op.

### R8. ToolRail per-button states (NEW — locked 2026-05-12)
- **6-button MVP.** Select / Text-edit / Move / Inpaint / Undo / Redo. No Zoom-in / Zoom-out in v1 (fabric handles wheel+pinch natively; defer dedicated zoom buttons to EPIC-10 polish if user feedback demands).
- **States per button.**
  | State    | Visual                                       | Trigger                                                                                  |
  |----------|----------------------------------------------|------------------------------------------------------------------------------------------|
  | idle     | `bg-surface-02 text-ink-muted`               | Default; tool available                                                                  |
  | active   | `bg-bronze/15 text-bronze ring-1 ring-bronze`| Currently-selected tool (only one of {Select, Text-edit, Move, Inpaint} can be active)   |
  | disabled | `opacity-40 cursor-not-allowed`              | Inpaint disabled when no mask region drawn; Undo disabled when undoStack empty; Redo disabled when redoStack empty; ALL siblings disabled while Inpaint is `loading` (R8 below) |
  | loading  | `<Spinner />` replaces icon; click-to-abort  | Inpaint only; while SSE stream is open                                                   |
- **Keyboard shortcuts.** `V` Select / `T` Text-edit / `M` Move / `I` Inpaint / `Ctrl+Z` Undo / `Ctrl+Shift+Z` Redo. Bound at the editor-route level via `useEffect` + `keydown` listener; ignored when an editable field has focus.
- **Tooltips.** shadcn `Tooltip` on hover; shows label + shortcut hint (e.g. "Inpaint (I)"). Bilingual via existing `messages/{zh,en}.json` keys (`editor.tools.select`, etc.).
- **Inpaint loading semantics — spinner + cancellable + sibling-disable.**
  - On click: opens SSE stream via `useInpaint()` hook (returns `{status: 'idle'|'streaming'|'success'|'error'|'aborted', abort: () => void}`).
  - Button icon → spinner. Click during `streaming` → `abortController.abort()` → server closes the SSE stream → returns to idle.
  - All other ToolRail buttons set to `disabled` while `status === 'streaming'`. Canvas pan/zoom remain functional (only the tool rail is gated).
  - Server-side: when the SSE client disconnects, the `image_edit` provider call is abandoned (no Postgres row inserted, no MinIO write). Idempotent.

## Non-Goals (EPIC-5)

- **Batch-edit across kit** (apply same fix to all 14 images) — v2.
- **AI-suggested rewrites** (auto-generate the replacement zh string from compliance feedback) — v2.
- **Multi-user real-time co-edit** — v3+ (single-tenant single-tab).
- **Revert UI.** Backend supports `op_type='revert'`; no ToolRail button exposes it in v1 (user can `Ctrl+Z` to the pre-inpaint snapshot).
- **Mobile / tablet < 1024px.** Editor is desktop-only (≥1280px primary, ≥1024px graceful per design-brief output requirements line 226).
- **Zoom-in / Zoom-out buttons.** fabric native pinch+wheel only.
- **Light-mode polish.** Deferred to EPIC-10 (consistent with EPIC-6/7 scope rule).
- **OCR for non-zh languages.** PaddleOCR bilingual zh+en only; ja/ko/etc. → v2.

## Acceptance Criteria (Test-mapped)

| # | Plan AC                                                                                                              | Concrete test                                                                                                              | File                                                            |
|---|----------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------|
| 1 | Scripted sequence of 3 fixed ops + 1 undo + 1 redo on a 3-zh-error fixture; ≤90s on stock 4-core CI                  | pytest replays the R6 op sequence with `FakeImageEdit` + `FakeOCR`; asserts `total_elapsed_seconds <= 90`                  | `tests/editor/test_scripted_edit_session.py`                    |
| 2 | OCR ≥90% box-detection ratio on 10 zh fixtures                                                                       | pytest loads the 10-image fixture, runs `services/editor/ocr.py`, computes `ratio = sum(IoU≥0.5)/sum(ground_truth) ≥ 0.90` | `tests/editor/test_ocr_accuracy.py`                             |
| 3 | Canvas-only edits (font / color / position) save in <300ms with no API call                                          | Playwright timing: select tool=Text-edit, change text, assert `network.requestCount === 0` and `elapsed_ms < 300`          | `apps/web/tests/web/editor-canvas-only.spec.ts`                 |
| 4 | Inpaint round-trip <20s for one 1024×1536 image                                                                      | pytest `time.monotonic()` around the orchestration call with `FakeImageEdit` (with a 1.5s sleep budget); assert `<20`      | `tests/editor/test_inpaint_round_trip.py`                       |
| 5 | History supports 10+ edits without state corruption                                                                  | Playwright drives 12 alternating canvas ops; assert HistoryTimeline shows 12 entries, undo to step 0 restores blank canvas | `apps/web/tests/web/editor-history.spec.ts`                     |
| 6 | (R7 derived) StrictMode double-mount produces exactly one `fabric.Canvas` instance, exactly one dispose on unmount   | Vitest unit: render `<CanvasStage/>` in StrictMode; assert `fabric.Canvas` constructor called once, `dispose()` called once on unmount | `apps/web/tests/unit/canvas-stage-strict-mode.test.tsx` |
| 7 | (R8 derived) Inpaint button cancellation: click during streaming aborts the SSE stream, no `image_edits` row created | Playwright + pytest end-to-end: start inpaint, click button again, assert `SELECT count(*) FROM image_edits = 0`           | `apps/web/tests/web/editor-inpaint-cancel.spec.ts`              |
| 8 | (R5 derived) Sidecar overwrite + fallback: after inpaint, `GET /api/images/{id}` returns sidecar PNG bytes; after revert, returns original | pytest with a MinIO testcontainer: assert MinIO `HEAD kits/.../edited/{id}.png` exists post-inpaint, absent post-revert | `tests/editor/test_minio_sidecar.py` |
| 9 | (R3 derived) `POST /api/images/{id}/ocr` returns deterministic boxes for the same image; cached on second call      | pytest: call twice, assert identical response and that PaddleOCR was invoked only once (mock the engine call counter)      | `tests/editor/test_ocr_route.py`                                |
| 10 | (R8 derived) ToolRail keyboard shortcuts: pressing `V/T/M/I/Ctrl+Z/Ctrl+Shift+Z` updates `active` state               | Playwright: dispatch keydown events, assert `data-state="active"` toggles correctly                                        | `apps/web/tests/web/editor-toolrail-keyboard.spec.ts`           |

**Test count target:** +10–14 pytest (services/editor + apps/api routes + provider role); +6–8 Playwright; +1–2 Vitest unit (StrictMode). Brings repo total from **326 → ~345 passing**.

## Implementation Map

### Backend (FastAPI / services)

- **`services/providers/base.py`** — add `ImageEditResponse` dataclass + `ImageEdit` Protocol (alongside `ImageGen`); export from `__all__`.
- **`services/providers/apimart/image_edit.py`** — NEW. `class ApimartImageEdit:` implements `ImageEdit`; multipart POST to `{base_url}/v1/images/edits`.
- **`services/providers/registry.py`** *(or wherever the role-resolution lives)* — register `image_edit` as the 5th mandatory role; startup raises `ProviderNotBound("image_edit")` if absent.
- **`services/editor/__init__.py`** — NEW package.
- **`services/editor/ocr.py`** — NEW. `def detect_text_boxes(image_bytes: bytes) -> list[TextBox]` using `paddleocr`. Module-level cached `PaddleOCR(lang='ch')` instance (lazy init).
- **`services/editor/inpaint_text.py`** — NEW. `async def inpaint_region(image_id, mask_box, new_text) -> bytes` composes `{base_image, mask_png, prompt}` and calls `registry.image_edit.edit(...)`.
- **`services/editor/composite.py`** — NEW. `def composite_to_minio(kit_id, image_id, edited_bytes) -> None` writes via the existing MinIO client used by `services/storage/` (mirror the `imagegen` write pattern).
- **`apps/api/routes/images.py`** — NEW file. Three routes:
  - `POST /api/images/{id}/ocr` → `services/editor/ocr.detect_text_boxes`.
  - `POST /api/images/{id}/edit` → spawns inpaint job, returns 202 + `job_id`.
  - `GET /api/images/{id}/edit/events` → SSE stream emitting `progress`/`success`/`error`/`aborted` events.
- **`apps/api/main.py`** — register `images.router`. Add `@app.on_event("startup")` guard for `image_edit` role (acknowledge pending lifespan migration; do not regress).
- **`infra/migrations/0002_image_edits_extend.sql`** — NEW migration. ADD COLUMN `op_type TEXT NOT NULL DEFAULT 'inpaint' CHECK (op_type IN ('inpaint','revert'))` + `payload_json JSONB`. Keep existing `text_layer_index/original_text/new_text` columns; the new columns supplement (do not replace).
- **`tests/editor/conftest.py`** — NEW. `FakeImageEdit` (Pillow-composite on mask region), `FakeOCR` (deterministic fixture boxes for 10 zh images), reuse `_set_fake_provider_env_vars` from `tests/imagegen/conftest.py` (already sets `FAKE_IMAGE_EDIT_KEY`).
- **`tests/editor/fixtures/`** — NEW. 10 zh-text PNG images + 10 ground-truth JSON box files. Generated deterministically by `scripts/seed_editor_fixtures.py` (Pillow-rendered Chinese text on solid backgrounds; no external assets).
- **`scripts/seed_editor_fixtures.py`** — NEW. Idempotent script; called by `make seed-editor-fixtures` and (optionally) Playwright `globalSetup`.
- **`Makefile`** — extend `seed-fixtures` target to include `seed-editor-fixtures`.

### Frontend (apps/web)

- **`apps/web/app/[locale]/editor/[image_id]/page.tsx`** — NEW. Server Component shell that renders the client `<EditorRoot>`. Pre-fetches `GET /api/images/{id}` + `GET /api/images/{id}/ocr` (cached) for SSR-friendly initial state.
- **`apps/web/components/editor/EditorRoot.tsx`** — NEW. Client Component. Hosts the 4-region layout grid + tool-state context.
- **`apps/web/components/editor/CanvasStage.tsx`** — NEW. fabric.js@6 wrapper. Dynamic-imported with `ssr: false` from `EditorRoot`. Implements R7 lifecycle (mount-guard + dispose + imperative-only handlers).
- **`apps/web/components/editor/TextLayerOverlay.tsx`** — NEW. SVG overlay on top of canvas; reads OCR boxes; emits click → selects corresponding fabric.Text.
- **`apps/web/components/editor/ToolRail.tsx`** — NEW. 6 buttons + per-button state machine per R8. Keyboard shortcut handler.
- **`apps/web/components/editor/HistoryTimeline.tsx`** — NEW. Reads from the Zustand-or-context-based command stack; renders 50-cap thumb strip.
- **`apps/web/lib/editor/command-stack.ts`** — NEW. Bounded-FIFO Command store (Zustand single-tenant; mirrors existing TanStack-Query-friendly state lifting).
- **`apps/web/hooks/use-inpaint.ts`** — NEW. SSE consumer; returns `{status, abort, lastEvent}`.
- **`apps/web/hooks/use-ocr.ts`** — NEW. TanStack Query `useQuery` wrapper for `POST /api/images/{id}/ocr` (mutation-shaped because POST, but cached by `image_id`).
- **`apps/web/lib/nav.ts`** — flip `editor.enabled = true`; drop `comingInEpic: 5`.
- **`apps/web/messages/{zh,en}.json`** — add `editor.*` keys: `editor.tools.select / text / move / inpaint / undo / redo`, `editor.history.empty`, `editor.history.cap`, `editor.inpaint.streaming`, `editor.inpaint.error`, `editor.inpaint.aborted`, etc.
- **`apps/web/package.json`** — add `fabric@^6.0.0` (apps/web only). Confirm `react-diff-view` already-installed from EPIC-7 is NOT reused (different problem domain).
- **`apps/web/scripts/check-token-drift.mjs`** — no change required; the existing drift guard enforces token usage on new components.

### Tests (apps/web)

- **`apps/web/tests/web/editor-canvas-only.spec.ts`** — AC#3.
- **`apps/web/tests/web/editor-history.spec.ts`** — AC#5.
- **`apps/web/tests/web/editor-inpaint-cancel.spec.ts`** — AC#7.
- **`apps/web/tests/web/editor-toolrail-keyboard.spec.ts`** — AC#10.
- **`apps/web/tests/web/editor-visual.spec.ts`** — full-page visual snapshot of `/[locale]/editor/[image_id]` against a fixed seeded image, `maxDiffPixelRatio: 0.03`, no mask. Baseline committed under `editor-visual.spec.ts-snapshots/`.
- **`apps/web/tests/unit/canvas-stage-strict-mode.test.tsx`** — Vitest. AC#6.
- **`apps/web/tests/web/_helpers/mock-editor.ts`** — NEW helper. `page.route('**/api/images/*/edit/events', ...)` shim that streams a canned SSE payload deterministically.

## Tooling Gates (must all pass before EPIC-5 ships)

- `pnpm typecheck` → clean (no new TS errors).
- `pnpm lint` → clean (biome unchanged; new components must use `data-state` attribute conventions consistent with EPIC-6).
- `pnpm build` → 9 routes total (8 from EPIC-6+EPIC-7 + `/editor/[image_id]` × 2 locales).
- `pnpm check:tokens` → no drift (must remain 45/45 or whatever baseline EPIC-7 left).
- `pnpm gen:api` → 15 paths (12 from EPIC-7 + 3 new: ocr, edit, edit/events).
- `uv run pytest -q` → **~345 passed** (326 from EPIC-7 + ~19 new EPIC-5).
- `pnpm exec playwright test --list` → 64–66 tests (58 from EPIC-7 + 6–8 new editor specs).
- `bash scripts/grep_providers.sh` → clean (no vendor brand names; `image_edit` role string is allowed because it's a role name, not a brand).
- `make seed-fixtures` → idempotent; includes new editor fixtures.

## Risk Register (EPIC-5)

| # | Risk                                                                                                                  | Mitigation                                                                                                       | Owner       |
|---|-----------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------|-------------|
| 1 | fabric.js@6 SSR / dynamic-import edge cases bite during HMR                                                           | R7 lifecycle pattern + AC#6 Vitest StrictMode test; HMR-loss is acceptable (dev-only)                            | ralph       |
| 2 | PaddleOCR install footprint is large (~100MB+ models)                                                                 | Lazy-init at first `/ocr` call; document in README; CI cache the model dir                                       | ralph       |
| 3 | GPT-Image-2 `/v1/images/edits` returns >20s p95 → AC#4 misses                                                         | Acknowledged at EPIC-4A AC#8 gate (zh-fail-rate > 40% → EPIC-5 budget doubles); FakeImageEdit drives CI timing   | ralph       |
| 4 | MinIO sidecar overwrite races with EPIC-7 kit-detail HEAD-check                                                       | Read path uses single-flight GET with sidecar-prefer; HEAD-then-GET is racy → just GET sidecar, fallback on 404  | ralph       |
| 5 | `image_edits` migration breaks existing rows                                                                          | `0002_image_edits_extend.sql` is purely additive (ADD COLUMN with DEFAULT); existing rows get `op_type='inpaint'`| ralph       |
| 6 | Spinner-while-cancellable Inpaint button cancellation leaks server-side work                                          | SSE on-disconnect handler explicitly aborts the `image_edit` provider call; AC#7 verifies zero DB row            | ralph       |
| 7 | Pre-existing tech debt (52 ruff + 3 mypy in apps/api/lib/, packages/, scripts/seed_*.py) compounds                    | OUT of EPIC-5 scope; flag for EPIC-8 pre-flight sweep                                                            | EPIC-8 lead |

## Estimated Work Units

- ~1.5–2.5 weeks (plan baseline). At the EPIC-4A AC#8 gate the zh-fail-rate budget did NOT double, so target the lower **1.5w** end. Add ~0.3w for the EPIC-7 follow-on integration (visual baseline, kit-detail sidecar fallback).
- **Effective budget: ~1.8 weeks.**

## Open Questions (post-spec, resolve during ralph)

- None blocking. All 8 ambiguity rounds locked. The 3.0% residual is implementation grit (e.g. exact PaddleOCR model id, exact Tailwind class for `bg-bronze/15`) that ralph resolves during execution.

## Next Step

`/ralph EPIC-5` — execute against this spec.
