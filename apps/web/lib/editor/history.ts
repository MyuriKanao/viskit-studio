import type { ViskitEditorDocument } from './document';

export const EDITOR_HISTORY_CAP = 100;

export type EditorCommandKind =
  | 'layer.add'
  | 'layer.remove'
  | 'layer.update'
  | 'layer.transform'
  | 'layer.reorder'
  | 'layer.select'
  | 'shape.add'
  | 'paint.layer.add'
  | 'paint.stroke.add'
  | 'filter.apply'
  | 'selection.set'
  | 'selection.mask.add'
  | 'tool.change'
  | 'document.resize'
  | 'document.crop'
  | 'document.rotate'
  | 'document.flip'
  | 'ai.inpaint.commit'
  | 'export.checkpoint';

export interface EditorCommand<TPayload = unknown> {
  id: string;
  kind: EditorCommandKind;
  payload: TPayload;
  ts: number;
  checkpoint?: ViskitEditorDocument;
}

export interface EditorHistoryState {
  undoStack: EditorCommand[];
  redoStack: EditorCommand[];
  savedCommandId?: string;
  cap: number;
}

export function createEditorHistory(cap = EDITOR_HISTORY_CAP): EditorHistoryState {
  return { undoStack: [], redoStack: [], cap };
}

export function pushHistoryCommand(state: EditorHistoryState, command: EditorCommand) {
  const undoStack = [...state.undoStack, command];
  while (undoStack.length > state.cap) undoStack.shift();
  return { ...state, undoStack, redoStack: [] };
}

export function undoHistory(state: EditorHistoryState) {
  const command = state.undoStack.at(-1) ?? null;
  if (!command) return { state, command };
  return {
    command,
    state: {
      ...state,
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, command],
    },
  };
}

export function redoHistory(state: EditorHistoryState) {
  const command = state.redoStack.at(-1) ?? null;
  if (!command) return { state, command };
  return {
    command,
    state: {
      ...state,
      undoStack: [...state.undoStack, command],
      redoStack: state.redoStack.slice(0, -1),
    },
  };
}

export function jumpHistory(state: EditorHistoryState, index: number): EditorHistoryState {
  const combined = [...state.undoStack, ...state.redoStack.slice().reverse()];
  const clamped = Math.max(-1, Math.min(index, combined.length - 1));
  return {
    ...state,
    undoStack: combined.slice(0, clamped + 1),
    redoStack: combined.slice(clamped + 1).reverse(),
  };
}

export function markHistorySaved(
  state: EditorHistoryState,
  commandId = state.undoStack.at(-1)?.id
) {
  return { ...state, savedCommandId: commandId };
}

export function isHistoryDirty(state: EditorHistoryState) {
  return state.undoStack.at(-1)?.id !== state.savedCommandId;
}
