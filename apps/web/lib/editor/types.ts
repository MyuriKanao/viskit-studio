/**
 * Shared types for the EPIC-5 Text-touchup Editor.
 *
 * The command-pattern history model stores a serialized fabric snapshot
 * with each operation and caps stack growth at the call site.
 */
export type OpType = 'edit_text' | 'move_layer' | 'inpaint' | 'revert';

export type EditorActiveTool = 'select' | 'text' | 'move' | 'inpaint' | null;

export interface EditorLayerSummary {
  id: string;
  label: string;
  kind: 'base-image' | 'ocr-text' | 'inpaint-mask' | 'fabric-object';
  visible: boolean;
  locked: boolean;
  opacity: number;
  selected: boolean;
}

export interface Command {
  id: string;
  op_type: OpType;
  payload: unknown;
  /** `fabric.toJSON(['customProps'])` result, stringified. */
  snapshot_json: string;
  /** Wall-clock timestamp in milliseconds since epoch. */
  ts: number;
}

/**
 * Canvas-coordinate inpaint mask. Shape mirrors `InpaintRequest.mask_box`
 * in `apps/web/hooks/use-inpaint.ts` — same field names so the box can be
 * passed straight through to the backend.
 */
export interface MaskBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Imperative handle exposed by `CanvasStage` via `React.forwardRef`. Lets
 * the mask UI in `EditorRoot` drive fabric.js without subscribing to a
 * re-render on every fabric event.
 */
export interface CanvasStageHandle {
  /** Focus the fabric.Text at the given OCR-box index. No-op if absent. */
  selectByOcrIndex: (index: number) => void;
  /** Create or focus an editable text layer from an OCR box. */
  upsertTextLayerFromOcr: (
    index: number,
    box: { x: number; y: number; w: number; h: number; text: string }
  ) => void;
  /** Remove the live mask rectangle (called on inpaint success / mask reset). */
  clearMaskRect: () => void;
  /** Apply editor history and restore the matching fabric snapshot. */
  undo: () => void;
  /** Re-apply the next editor history snapshot. */
  redo: () => void;
  /** Select a Fabric-backed editor layer by stable layer id. */
  selectLayerById: (layerId: string) => void;
  /** Toggle a Fabric-backed editor layer's visibility. */
  setLayerVisibility: (layerId: string, visible: boolean) => void;
  /** Toggle a Fabric-backed editor layer's lock/selectability. */
  setLayerLocked: (layerId: string, locked: boolean) => void;
  /** Move a Fabric-backed layer up/down in the stack. */
  moveLayer: (layerId: string, direction: 'up' | 'down') => void;
  /** Delete a Fabric-backed layer. Base image is intentionally not deletable. */
  deleteLayer: (layerId: string) => void;
  /** Set a Fabric-backed layer opacity, clamped to 0..1 by the caller. */
  setLayerOpacity: (layerId: string, opacity: number) => void;
  /** Export the current canvas as a PNG data URL for explicit save. */
  exportPngDataUrl: () => string | null;
  /** Export the current canvas as a raster data URL for downloads. */
  exportImageDataUrl: (options?: {
    format?: 'png' | 'jpeg' | 'webp';
    quality?: number;
  }) => string | null;
  /** Build a versioned editor document from the current Fabric-backed layer state. */
  exportEditorDocument: (input: {
    id?: string;
    imageId: string;
    imageUrl: string;
    width: number;
    height: number;
    activeToolId: string;
    enabledToolGroups: string[];
  }) => import('@/lib/editor/document').ViskitEditorDocument | null;
  /** Load a versioned editor document into the Fabric canvas. */
  loadEditorDocument: (
    document: import('@/lib/editor/document').ViskitEditorDocument
  ) => Promise<void>;
  /** Export the current Fabric snapshot for production history checkpoints. */
  exportFabricSnapshot: () => unknown | null;
  /** Count of fabric objects on the canvas (mask + text layers). For tests. */
  getObjectCount: () => number;
}
