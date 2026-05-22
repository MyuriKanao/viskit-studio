# Viskit Editor Release Audit

This audit runbook supports the no-known-tech-debt release constraint for the
editor refactor. It should be completed during Phase 6 and updated whenever a
Phase 0 guardrail changes.

## Required evidence before release

| Gate | Evidence required | Command or source |
| --- | --- | --- |
| Feature matrix complete | Every row in `docs/editor/feature-matrix.md` names implementation files and automated tests before being marked complete or tested-equivalent. | Review matrix diff in the release PR. |
| Architecture boundaries intact | Public editor state remains a versioned document model; Fabric stays behind an adapter. | `docs/editor/architecture.md`; editor core unit tests. |
| Current Viskit contracts preserved | `kit-slot:*` and `asset:*` bytes, OCR shape, inpaint terminal states, edit-result creation, save replace, save copy, source image import, and project JSON persistence keep passing. | `uv run python -m unittest apps.api.test_images_routes` plus focused schema/guardrail tests. |
| Frontend behavior covered | Route load, registry rendering, layer/canvas sync, OCR layer feedback, inpaint states, save/export helpers, keyboard/focus behavior, and project JSON helpers have automated component or unit evidence. | `pnpm --filter @viskit/web test:editor-core`; `pnpm --filter @viskit/web test:editor-component-smoke`. |
| Old/new duplication removed | Superseded editor components are deleted or reduced to documented thin adapters; duplicate matrix rows are removed. | Code review plus feature matrix ownership rows. |
| Visible tools are functional | No enabled tool is a non-working surface; unsupported destructive tools are hidden, and disabled controls are blocked at command execution. | Tool registry tests, component smoke, and guardrail tests. |
| Attribution complete | Any copied or substantially derived MIT reference code retains attribution. | Source comments and release docs; Phase 0/1 currently uses first-party code. |
| Dependency review complete | Any new editor dependency has license, maintenance, bundle/performance, SSR, and testability notes. | Dependency review notes in the PR; component smoke runner dependencies are pinned in `apps/web/package.json` / `pnpm-lock.yaml`. |
| Performance/UX smoke complete | Large image, multi-layer history, export helpers, keyboard navigation, focus states, and accessible controls pass automated smoke; browser visual capture is separately recorded if required by sign-off. | Commands below plus release PR evidence. |
| Quality gates green | Lint, typecheck, Python tests, and web build all pass. | Commands below. |

## Final quality commands

```bash
make lint
make typecheck
uv run python -m unittest discover
make web-build
```

## Targeted editor verification commands

```bash
pnpm --filter @viskit/web test:editor-core
pnpm --filter @viskit/web test:editor-component-smoke
uv run python -m unittest tests.test_editor_phase0_guardrails
uv run python -m unittest apps.api.test_images_routes
uv run python -m unittest apps.api.test_schema_contract
```

## Final task integration snapshot — 2026-05-22

- Task 1 added executable component smoke in
  `apps/web/lib/editor/component-smoke-tests.tsx`, covering encoded route
  decoding, editor shell rendering, export/download helper side effects,
  keyboard shortcuts, focusable LayerPanel/HistoryTimeline controls, and visible
  disabled-state behavior.
- Task 2 hardened visible UI release contracts: LayerPanel row controls have
  stable test IDs and focus affordances, Fabric/editor test hooks are gated by
  `NEXT_PUBLIC_VISKIT_EDITOR_TEST_HOOKS` outside production, CanvasStage exposes
  loading/error feedback, and TextLayerOverlay exposes OCR empty/error feedback.
- Task 3 reconciled frontend wrapped `viskit-editor-project` payloads with the
  backend's persisted/exported editor document, and added source-image
  tested-equivalent coverage for BMP/TIFF/GIF byte preservation plus unsupported
  SVG rejection.
- Task 4 removed duplicate matrix rows, replaced stale implementation-blocking
  wording with explicit tested-equivalent evidence, and kept final gate
  ownership in this audit.

## Task 4 evidence snapshot — 2026-05-22

- Component-safe smoke evidence: `apps/web/lib/editor/core-tests.ts` includes the
  **Large image / 30-layer / 100-command smoke** guard so the headless document,
  Fabric-adapter descriptor projection, project JSON round trip, and bounded
  history behavior are checked without browser or canvas dependencies.
- Component contract evidence: `tests/test_editor_phase0_guardrails.py` checks
  stable test IDs, state attributes, native disabled-state hooks, gated editor
  test hooks, canvas load/error feedback, and OCR empty/error feedback across
  `ToolRail`, `LayerPanel`, `ToolOptionsPanel`, `CanvasStage`, `EditorRoot`, and
  `TextLayerOverlay`.
- No-tech-debt marker scan: `tests/test_editor_phase0_guardrails.py` scans the
  editor guardrail docs and component entry points for unowned placeholder or
  incomplete-code markers.
- Visible-disabled control evidence: `ToolRail` and `LayerPanel` apply native
  disabled attributes when controls are visually disabled, covering the release
  rule that hidden or disabled tools cannot execute commands through click
  handlers.
- Performance/UX smoke status: headless large-document and history-cap smoke is
  automated. Component-level route, keyboard, focus, and export smoke is also
  automated. Browser visual capture is optional release-PR evidence only when
  pixel-level capture is required.

## Optional release visual sign-off evidence

- Full browser visual capture with the dynamically imported Fabric canvas is
  optional evidence, separate from the component smoke runner.
- `LayerPanel` row-level browser navigation can be recorded as visual sign-off;
  component smoke already covers focusable controls, visibility actions, opacity
  changes, and disabled base-image guards.
- Drag/drop, paste, and remote URL import can receive browser/operator sign-off if they are
  highlighted in release notes; data URL, existing-image import, BMP/TIFF/GIF
  preservation, and unsupported SVG rejection are covered by backend tests.
- Cross-stack project save/load has backend and frontend helper coverage; browser
  reload capture is optional release-PR evidence if required.

## Audit notes for Phase 0

- The current repository has backend coverage for image bytes and save semantics,
  source image persistence, project JSON wrappers, and frontend component smoke
  for route/export/keyboard/focus; a browser visual runner is intentionally
  tracked separately from this component evidence.
- Browser test hooks are gated to non-production test environments and are not
  counted as public browser evidence by themselves.
- If any file uses placeholder or incomplete-code release-risk markers, the
  release PR must either remove the code or document ownership and automated
  coverage in the feature matrix.
