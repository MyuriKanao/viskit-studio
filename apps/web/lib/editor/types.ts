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
