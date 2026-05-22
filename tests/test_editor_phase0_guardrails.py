from __future__ import annotations

import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
FEATURE_MATRIX = REPO_ROOT / "docs" / "editor" / "feature-matrix.md"
ARCHITECTURE = REPO_ROOT / "docs" / "editor" / "architecture.md"
RELEASE_AUDIT = REPO_ROOT / "docs" / "editor" / "release-audit.md"
EDITOR_COMPONENT_DIR = REPO_ROOT / "apps" / "web" / "components" / "editor"
EDITOR_LIB_DIR = REPO_ROOT / "apps" / "web" / "lib" / "editor"

REQUIRED_MATRIX_PHRASES = (
    "Viskit image open by `image_id`",
    "Versioned project JSON / design state",
    "Canvas/layer model",
    "OCR text as editable layers",
    "Select, move, and transform",
    "Crop, resize, rotate, and flip",
    "Brush, pencil, eraser, fill, and color picker",
    "Pixel selection / magic-wand equivalent",
    "Shapes and annotations",
    "Watermark and image overlay",
    "Clone, blur, sharpen, desaturate, and content-fill class tools",
    "Filters and finetunes",
    "AI inpaint mask workflow",
    "Save replace/copy for Viskit assets",
    "Local file import / drag-drop / paste / data URL / URL import",
    "Export PNG/JPEG/WebP and project JSON",
    "BMP/TIFF/animated GIF support or tested equivalent",
    "Typed command history / dirty checkpoints",
    "Configurable Viskit editor embed API",
    "Workspace UI panels",
    "Licensing and attribution",
    "Quality gates and release audit",
)

REQUIRED_ARCHITECTURE_PHRASES = (
    "first-party editor core",
    "Versioned document creation",
    "Tool registry metadata",
    "Typed commands",
    "Migration and deletion guardrails",
    "Test strategy scaffold",
    "No-tech-debt audit checklist",
)

REQUIRED_AUDIT_PHRASES = (
    "Feature matrix complete",
    "Old/new duplication removed",
    "Visible tools are functional",
    "Attribution complete",
    "Dependency review complete",
    "Performance/UX smoke complete",
    "Component-safe smoke evidence",
    "Large image / 30-layer / 100-command smoke",
    "No-tech-debt marker scan",
)

QUALITY_GATES = (
    "make lint",
    "make typecheck",
    "uv run python -m unittest discover",
    "make web-build",
)

TARGETED_EDITOR_GATES = (
    "pnpm --filter @viskit/web test:editor-core",
    "pnpm --filter @viskit/web test:editor-component-smoke",
    "uv run python -m unittest tests.test_editor_phase0_guardrails",
)

FORBIDDEN_RELEASE_MARKERS = ("TBD", "TODO", "FIXME", "stub", "not implemented")

TEST_HOOK_GATE_CONTRACTS = {
    EDITOR_LIB_DIR / "test-hooks.ts": (
        "NEXT_PUBLIC_VISKIT_EDITOR_TEST_HOOKS",
        "process.env.NODE_ENV !== 'production'",
    ),
}

COMPONENT_TEST_CONTRACTS = {
    EDITOR_COMPONENT_DIR / "ToolRail.tsx": (
        'data-testid="tool-rail"',
        "data-testid={tool.testId}",
        'data-testid="tool-undo"',
        'data-testid="tool-redo"',
        "data-state={state}",
        "disabled={state === 'disabled'}",
        "disabled={undoState === 'disabled'}",
        "disabled={redoState === 'disabled'}",
    ),
    EDITOR_COMPONENT_DIR / "LayerPanel.tsx": (
        'data-testid="editor-layer-panel"',
        "data-testid={`editor-layer-${layer.id}`}",
        "data-testid={`editor-layer-${layer.id}-select`}",
        "data-testid={`editor-layer-${layer.id}-visibility`}",
        "data-testid={`editor-layer-${layer.id}-lock`}",
        "data-testid={`editor-layer-${layer.id}-move-up`}",
        "data-testid={`editor-layer-${layer.id}-move-down`}",
        "data-testid={`editor-layer-${layer.id}-delete`}",
        "data-testid={`editor-layer-${layer.id}-opacity`}",
        "data-state={isSelected ? 'selected' : 'idle'}",
        "data-testid={`editor-layer-${layer.id}-select`}",
        "aria-pressed={isSelected}",
        "onKeyDown={(event) => handleLayerSelectKeyDown(event, layer)}",
        "data-testid={`editor-layer-${layer.id}-visibility`}",
        "data-testid={`editor-layer-${layer.id}-lock`}",
        "data-testid={`editor-layer-${layer.id}-move-up`}",
        "data-testid={`editor-layer-${layer.id}-move-down`}",
        "data-testid={`editor-layer-${layer.id}-delete`}",
        "data-testid={`editor-layer-${layer.id}-opacity`}",
        "disabled={isBase}",
    ),
    EDITOR_COMPONENT_DIR / "ToolOptionsPanel.tsx": (
        'data-testid="editor-tool-options"',
        "data-status={inpaintStatus}",
        "disabled={!canStartInpaint}",
        "disabled={!isStreaming}",
    ),
    EDITOR_COMPONENT_DIR / "CanvasStage.tsx": (
        'data-testid="canvas-stage"',
        "getEditorTestHooks()",
        "canvas-image-loading",
        "canvas-image-error",
        "role={imageLoadStatus === 'error' ? 'alert' : 'status'}",
    ),
    EDITOR_COMPONENT_DIR / "EditorRoot.tsx": ('data-testid="canvas-skeleton"',),
    EDITOR_COMPONENT_DIR / "TextLayerOverlay.tsx": (
        "ocr-error-state",
        "ocr-empty-state",
        "role={state === 'error' ? 'alert' : 'status'}",
    ),
}


class EditorPhase0GuardrailsTest(unittest.TestCase):
    def test_feature_matrix_covers_required_capability_groups(self) -> None:
        self.assertTrue(FEATURE_MATRIX.exists(), "editor feature matrix must exist")
        content = FEATURE_MATRIX.read_text(encoding="utf-8")

        for phrase in REQUIRED_MATRIX_PHRASES:
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, content)

        self.assertIn("apps/api/test_images_routes.py", content)
        self.assertIn("Tested equivalent", content)
        self.assertIn("release sign-off", content.lower())

    def test_architecture_doc_records_boundaries_and_quality_gates(self) -> None:
        self.assertTrue(ARCHITECTURE.exists(), "editor architecture guardrail doc must exist")
        content = ARCHITECTURE.read_text(encoding="utf-8")

        for phrase in REQUIRED_ARCHITECTURE_PHRASES + QUALITY_GATES:
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, content)

    def test_release_audit_lists_no_tech_debt_gates(self) -> None:
        self.assertTrue(RELEASE_AUDIT.exists(), "editor release audit runbook must exist")
        content = RELEASE_AUDIT.read_text(encoding="utf-8")

        for phrase in REQUIRED_AUDIT_PHRASES + QUALITY_GATES + TARGETED_EDITOR_GATES:
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, content)

    def test_editor_components_expose_component_safe_test_contracts(self) -> None:
        for path, required_snippets in COMPONENT_TEST_CONTRACTS.items():
            self.assertTrue(path.exists(), f"{path.relative_to(REPO_ROOT)} must exist")
            content = path.read_text(encoding="utf-8")
            for snippet in required_snippets:
                with self.subTest(path=path.relative_to(REPO_ROOT), snippet=snippet):
                    self.assertIn(snippet, content)

    def test_editor_test_hooks_are_non_production_gated(self) -> None:
        helper = EDITOR_LIB_DIR / "test-hooks.ts"
        self.assertTrue(helper.exists(), "editor test-hook gate helper must exist")
        helper_content = helper.read_text(encoding="utf-8")
        self.assertIn("NEXT_PUBLIC_VISKIT_EDITOR_TEST_HOOKS", helper_content)
        self.assertIn("process.env.NODE_ENV !== 'production'", helper_content)

        hook_consumers = (
            EDITOR_COMPONENT_DIR / "EditorRoot.tsx",
            EDITOR_COMPONENT_DIR / "CanvasStage.tsx",
        )
        for path in hook_consumers:
            content = path.read_text(encoding="utf-8")
            with self.subTest(path=path.relative_to(REPO_ROOT)):
                self.assertIn("getEditorTestHooks()", content)
                self.assertNotIn("window.__editorTest", content)

    def test_guardrail_docs_and_editor_source_do_not_contain_unowned_risk_markers(self) -> None:
        scanned_paths = (
            FEATURE_MATRIX,
            ARCHITECTURE,
            RELEASE_AUDIT,
            EDITOR_LIB_DIR / "test-hooks.ts",
            *COMPONENT_TEST_CONTRACTS.keys(),
            *TEST_HOOK_GATE_CONTRACTS.keys(),
        )
        for path in scanned_paths:
            content = path.read_text(encoding="utf-8")
            lowercase_content = content.lower()
            for marker in FORBIDDEN_RELEASE_MARKERS:
                with self.subTest(path=path.relative_to(REPO_ROOT), marker=marker):
                    self.assertNotIn(marker.lower(), lowercase_content)


if __name__ == "__main__":
    unittest.main()
