/**
 * Shared types for the EPIC-5 Text-touchup Editor.
 *
 * The command-pattern history model stores a serialized fabric snapshot
 * with each operation and caps stack growth at the call site.
 */
export type OpType = 'edit_text' | 'move_layer' | 'inpaint' | 'revert';

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
  /** Export the current canvas as a PNG data URL for explicit save. */
  exportPngDataUrl: () => string | null;
  /** Count of fabric objects on the canvas (mask + text layers). For tests. */
  getObjectCount: () => number;
}
