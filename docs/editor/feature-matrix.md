# Viskit Editor Feature Matrix

This matrix is the release gate for the editor refactor approved in
`.omx/plans/ralplan-editor-refactor-implementation.md`. A row can move to **Done** only when it
has implementation files, automated coverage, and no known compatibility debt. Rows that use a tested equivalent must name the supported behavior and the explicit
automated or optional release sign-off evidence.

## Status legend

- **Done** — implemented and covered by automated tests or an existing verified flow.
- **Core ready** — headless document/tool/history contract exists; UI or pixel implementation has
  bounded automated evidence and optional sign-off evidence is explicit.
- **Existing flow** — current editor behavior remains green while migration proceeds.
- **Tested equivalent** — the release behavior is intentionally narrower than the PRD wording, with
  automated evidence proving the supported equivalent and hidden/disabled unsupported affordances.

## Phase 0/1 guardrails

| Capability group | Status | Implementation owner/files | Coverage / gate |
| --- | --- | --- | --- |
| Viskit image open by `image_id` | Existing flow | `apps/web/app/[locale]/editor/[image_id]/page.tsx`, `apps/web/components/editor/EditorRoot.tsx`, `apps/web/lib/editor/route.ts` | Route decoding and editor shell component smoke via `pnpm --filter @viskit/web test:editor-component-smoke`; image byte route tests stay green. |
| Versioned editor document schema | Core ready | `apps/web/lib/editor/document.ts`, `apps/web/lib/editor/serialization.ts` | `pnpm --filter @viskit/web test:editor-core` |
| Versioned project JSON / design state | Core ready with wrapper reconciliation | `apps/web/lib/editor/serialization.ts`, `apps/web/lib/api/images.ts`, `apps/api/routes/images.py` | Editor-core serialization tests plus `apps/api/test_images_routes.py` wrapped project save/import/export tests. |
| Layer model and selection invariants | Core ready | `apps/web/lib/editor/layers.ts`, `apps/web/lib/editor/document.ts` | `pnpm --filter @viskit/web test:editor-core` |
| Canvas/layer model | Core ready with visible state feedback | `apps/web/lib/editor/document.ts`, `apps/web/lib/editor/layers.ts`, `apps/web/components/editor/CanvasStage.tsx` | Editor-core tests, component smoke, and guardrail checks for canvas loading/error states. |
| Typed command/history model | Core ready | `apps/web/lib/editor/history.ts`, `apps/web/components/editor/HistoryTimeline.tsx` | `pnpm --filter @viskit/web test:editor-core`; component smoke covers focus and cursor jump behavior. |
| Tool registry contract | Core ready | `apps/web/lib/editor/tools.ts` | `pnpm --filter @viskit/web test:editor-core`; hidden/disabled unsupported affordances stay filtered or inert. |
| Fabric adapter boundary | Core ready | `apps/web/lib/editor/adapters/fabric.ts`, `apps/web/lib/editor/test-hooks.ts` | Adapter descriptor tests and non-production test-hook guardrails. |
| Current OCR text overlay | Existing flow | `apps/web/components/editor/TextLayerOverlay.tsx`, `apps/web/components/editor/CanvasStage.tsx` | Guardrail tests cover OCR empty/error operator feedback and stable overlay contracts. |
| Current inpaint mask/save flow | Existing flow | `apps/web/components/editor/EditorRoot.tsx`, `apps/web/hooks/use-inpaint.ts`, `apps/web/lib/api/images.ts` | Existing API behavior and ToolOptionsPanel state guardrails remain covered. |
| Save replace/copy for Viskit assets | Existing flow | `apps/web/lib/api/images.ts`, `apps/api/routes/images.py` | `apps/api/test_images_routes.py` save replace/copy and asset workflow tests. |
| AI inpaint mask workflow | Existing flow; Core ready for mask command state | `apps/web/components/editor/EditorRoot.tsx`, `apps/web/components/editor/ToolOptionsPanel.tsx`, `apps/api/routes/images.py` | Existing inpaint route/unit checks plus guardrail tests for visible disabled/streaming states. |

## Required PRD capability matrix

| PRD group | Target release capability | Current status | Implementation / coverage gate |
| --- | --- | --- | --- |
| Select, move, and transform | Select layers, move/transform selected layer, keyboard shortcuts | Core ready with visible select/move flow | `apps/web/lib/editor/commands.ts`, `apps/web/lib/editor/tools.ts`, `ToolRail.tsx`, `CanvasStage.tsx`; `pnpm --filter @viskit/web test:editor-core`, `pnpm --filter @viskit/web test:editor-component-smoke`, typecheck, and build. Component shortcut/focus smoke is covered; browser canvas capture can be attached as optional release evidence. |
| OCR text as editable layers | OCR boxes become editable text layers with history | Existing flow; Core ready for `ocr-text` layers | `TextLayerOverlay.tsx`, `CanvasStage.tsx`, `LayerPanel.tsx`, and guardrail tests cover OCR empty/error feedback, layer contracts, and focus-safe controls. |
| AI inpaint mask | Mask draw/commit/success/error/abort reconciles as history command | Existing flow; Core ready for `mask` layer + `ai.inpaint.commit` command | `ToolOptionsPanel.tsx`, `use-inpaint.ts`, and API route tests preserve terminal states; mocked stream/browser capture can be attached as optional release evidence. |
| Crop, resize, rotate, and flip | Raster transform commands update document/canvas/export dimensions | Core ready for headless commands | `apps/web/lib/editor/commands.ts`, `document.ts`, `adapters/fabric.ts`; editor-core command tests pass and component export/download helper smoke is covered. |
| Brush, pencil, eraser, fill, and color picker | Paint stroke layers and pixel-edit tools | Core ready for paint layers/commands | Headless paint layer serialization and performance smoke pass; visible pixel-edit browser capture can be attached as optional release evidence. |
| Pixel selection / magic-wand equivalent | Pixel/region selection with documented fallback if needed | Core ready for mask selection model | Selection model, mask commands, and adapter descriptor coverage pass; user-facing advanced selection browser capture can be attached as optional release evidence. |
| Shapes and annotations | Rect, ellipse, polygon, line, arrow, pen as vector layers | Core ready for vector layers/commands | Vector layer commands and adapter tests pass; component export/download helper smoke is covered. |
| Watermark and image overlay | Imported image overlay with opacity/transform/history | Core ready for raster overlay model | Raster layer commands, opacity/transform, project persistence, and component export helper smoke are covered. |
| Clone, blur, sharpen, desaturate, and content-fill class tools | Implement feasible tools or documented tested equivalent | Tested equivalent: unsupported destructive tools hidden; reversible filter metadata covered | `apps/web/lib/editor/tools.ts` exposes no inert clone/content-fill tool; `layers.ts`, `commands.ts`, and editor-core tests cover reversible filter metadata for blur/sharpen/desaturate-style adjustments. |
| Filters and finetunes | Brightness, contrast, hue/saturation/luminance, warmth, grayscale, negative, presets | Core ready for reversible filter commands | `commands.ts` and `layers.ts` cover filter metadata/clamping; visible filter UI/browser capture can be attached as optional release evidence. |
| Layers panel operations | Order, selection, visibility, lock, opacity, rename, duplicate, merge, flatten, delete | Core ready with component focus coverage | `LayerPanel.tsx` exposes stable row/action test IDs, keyboard/focus affordances, disabled base-image guards, and guardrail coverage. |
| Workspace UI panels | Tool rail, canvas, layer panel, tool options, history, import/export affordances | Core ready with visible wiring | `EditorRoot.tsx`, `ViskitEditor.tsx`, `ToolRail.tsx`, `LayerPanel.tsx`, `ToolOptionsPanel.tsx`; static contracts, typecheck, build, and `pnpm --filter @viskit/web test:editor-component-smoke` pass for route/export/keyboard/focus smoke. |
| Local file import / drag-drop / paste / data URL / URL import | Local file, drag/drop, paste, data URL, CORS-safe URL | Core ready for project/local-file/data-URL paths | `apps/web/lib/api/images.ts`, `apps/api/routes/source_images.py`, and backend source-image tests cover data URL, existing-image import, BMP/TIFF/GIF preservation, and unsupported image rejection. Drag/drop/paste/remote URL browser capture can be attached as optional operator evidence. |
| Export PNG/JPEG/WebP and project JSON | PNG/JPEG/WebP plus project JSON | Core ready with visible export controls | `EditorRoot.tsx`, `ViskitEditor.tsx`, `apps/web/lib/editor/downloads.ts`, `lib/api/images.ts`; backend project export tests and component download filename/MIME/data-URL smoke pass. |
| BMP/TIFF/animated GIF support or tested equivalent | Import/export support or documented tested equivalent | Tested equivalent: source import preserves BMP/TIFF/GIF bytes; raster export stays PNG/JPEG/WebP | `apps/api/routes/source_images.py` accepts and stores `image/bmp`, `image/tiff`, and `image/gif`; `apps/api/test_images_routes.py` verifies preserved bytes and unsupported SVG rejection. |
| Project/design-state JSON | Save/load versioned document state with migration hooks | Core ready with UI/backend wrapper persistence | `serialization.ts`, `EditorRoot.tsx`, `lib/api/images.ts`, `apps/api/routes/images.py`; editor-core and backend route tests pass for wrapped frontend project JSON and canonical backend export. |
| Typed command history / dirty checkpoints | Undo/redo, capped history, save checkpoints, dirty state | Core ready | `apps/web/lib/editor/history.ts`; `pnpm --filter @viskit/web test:editor-core`. |
| Configurable Viskit editor embed API | Enabled groups, default tool, theme/locale, callbacks, imperative export/update refs | Core ready with public wrapper | `ViskitEditor.tsx`, `EditorRoot.tsx`, `tools.ts`; typecheck/build pass, and route/export/keyboard/focus component smoke covers the public shell. |
| Performance guardrails | Large image, 30 layers, 100 history commands | Core ready for headless smoke | `apps/web/lib/editor/core-tests.ts` covers 4096px document, 30 OCR layers, 120 commands capped to 100; component export smoke passes. Browser visual performance capture can be attached as optional release evidence. |
| Licensing and attribution | MIT attribution for copied/derived Filerobot/miniPaint code | Done for Phase 0/1: no copied reference code landed | Add attribution before any future direct port; current first-party code has no copied reference-code dependency. |
| Quality gates and release audit | Lint, typecheck, Python tests, web build, performance/UX smoke, no-old-code audit | Core ready / final integration gates green after task 4 | `docs/editor/release-audit.md`; final gates are `make test`, `make lint`, `make typecheck`, `make web-build`, editor-core, component smoke, schema checks, and guardrail tests. |

## Release gate

Release-ready claim rules:

1. Every row above must either be **Done**, **Core ready**, **Existing flow**, or **Tested equivalent**
   with implementation files and automated evidence named in the matrix.
2. `make lint`, `make typecheck`, `uv run python -m unittest discover`, and `make web-build` must
   pass after the worker-lane changes are integrated.
3. No duplicate old/new editor behavior may remain outside an intentional adapter boundary.
4. The PR summary must link this matrix and list optional browser/sign-off evidence separately
   from implementation completeness.
