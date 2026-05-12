/**
 * Shared types for the EPIC-5 Text-touchup Editor.
 *
 * The Command-pattern history model is locked in
 * `.omc/specs/deep-interview-epic-5-text-touchup-editor.md` §R2:
 *   Command = { id, op_type, payload, snapshot_json, ts }
 * Stack capped at 50 with FIFO eviction.
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
 * the EPIC-5b mask UI in `EditorRoot` drive fabric.js without subscribing
 * to a re-render on every fabric event (which would defeat §R7's
 * imperative-only handler rule).
 */
export interface CanvasStageHandle {
  /** Focus the fabric.Text at the given OCR-box index. No-op if absent. */
  selectByOcrIndex: (index: number) => void;
  /** Remove the live mask rectangle (called on inpaint success / mask reset). */
  clearMaskRect: () => void;
  /** Count of fabric objects on the canvas (mask + text layers). For tests. */
  getObjectCount: () => number;
}
