# Viskit Editor Architecture

The refactor uses a first-party editor core for Viskit with Fabric as an adapter, not as the public
state model. The core is intentionally headless so document, layer, tool, history, and project JSON
contracts can be tested before UI breadth expands.

## Boundaries

| Boundary | Owns | Must not own |
| --- | --- | --- |
| Editor document core (`apps/web/lib/editor/document.ts`) | Canvas size, source metadata, selected layers, export settings, layer list | React state, Fabric object instances, API fetches |
| Layer core (`apps/web/lib/editor/layers.ts`) | Layer union, ordering, visibility, lock, opacity, duplication, rename/reorder invariants | Panel layout, direct canvas mutation |
| Tool registry (`apps/web/lib/editor/tools.ts`) | Stable tool ids, groups, shortcuts, layer compatibility, history semantics, config filtering | Tool button rendering or incomplete advertised features |
| History core (`apps/web/lib/editor/history.ts`) | Typed commands, undo/redo cursor, cap, save checkpoint, dirty state | Fabric snapshot storage as the only source of truth |
| Serialization (`apps/web/lib/editor/serialization.ts`) | Project JSON parse/stringify, schema version, migration hooks, validation | Network persistence or backend ownership checks |
| Fabric adapter (`apps/web/lib/editor/adapters/fabric.ts`) | Translation from document layers into Fabric-friendly descriptors | Public API state, React lifecycle, importing `fabric` at module init |

## Data flow

1. Versioned document creation: a Viskit image id (`kit-slot:*`, `asset:*`, or another supported
   source) creates a
   `ViskitEditorDocument` with source metadata and a base image layer.
2. UI tools dispatch typed commands against the document core.
3. History stores command entries and optional document checkpoints; redo branches are cleared when
   a new command is pushed after undo.
4. Adapters project the headless document into engine-specific render state. The Fabric adapter
   currently returns serializable descriptors so SSR-safe modules can test the boundary without
   importing Fabric.
5. Project JSON export/import uses the versioned serializer and migration hook before a document is
   accepted.

## No-debt guardrails

- Tool registry metadata: a tool is registered only when it has stable id, group, label key, shortcut/cursor contract,
  layer compatibility, history semantics, and test id.
- Typed commands are the only supported mutation path for history-aware document changes.
- Capabilities without a shipped visible UI stay in `docs/editor/feature-matrix.md` as
  tested-equivalent or sign-off-scoped rows; they are not surfaced as completed tools.
- Fabric objects are adapter internals. Public editor state is the document/layer/command schema.
- OCR, inpaint, and save replace/copy flows must stay green while their UI migrates into the new
  model.
- Any copied or substantially derived MIT reference code must carry attribution in source and
  release docs before merge.

## Migration and deletion guardrails

- Old editor code can be deleted only after the replacement route owns the matching matrix row and
  has automated coverage for the user-visible behavior.
- During migration, shared OCR, inpaint, save, and project-load contracts stay behind thin adapters
  instead of duplicated forked flows.

## Test strategy scaffold

- Core state: `pnpm --filter @viskit/web test:editor-core`.
- Backend persistence and Viskit asset contracts: `uv run python -m unittest apps.api.test_images_routes`.
- Release guardrails: `uv run python -m unittest tests.test_editor_phase0_guardrails`.
- Full gates remain `make lint`, `make typecheck`, `uv run python -m unittest discover`, and
  `make web-build`.

## No-tech-debt audit checklist

- Feature matrix rows match shipped UI and backend behavior.
- Visible tools are functional or hidden; no inert affordances ship.
- Attribution, dependency review, performance smoke, and old-code deletion are recorded in
  `docs/editor/release-audit.md`.

## Extension points

- Add a layer by extending the `EditorLayer` union and serializer validation.
- Add a tool by declaring an `EditorToolDefinition` in `tools.ts`, then adding command handlers,
  option UI, adapter support, and tests before marking the matrix row Done.
- Add a renderer by mapping `ViskitEditorDocument` to an adapter state without changing document
  schema consumers.
- Add persistence by storing the serialized project JSON plus Viskit source metadata; ownership and
  path safety checks belong to backend routes, not the client serializer.

## Verification commands

```bash
pnpm --filter @viskit/web test:editor-core
pnpm --filter @viskit/web typecheck
pnpm --filter @viskit/web lint
```

Full release verification remains the approved quality gate:

```bash
make lint
make typecheck
uv run python -m unittest discover
make web-build
```
