'use client';

import { create } from 'zustand';

import type { Command } from '@/lib/editor/types';

/**
 * Bounded-FIFO Command stack for the Text-touchup Editor.
 *
 * Spec §R2:
 *   - Stack capped at 50; oldest evicted when length would exceed 50.
 *   - `push` clears the redo branch (standard Command-pattern semantics).
 *   - `undo` pops the top of `undoStack` into `redoStack`.
 *   - `redo` pops the top of `redoStack` back into `undoStack`.
 *   - `jumpTo(index)` truncates/rebalances so index is the top of undo.
 *   - In-memory only — never persisted (AC#3 budget: <300ms canvas-only writes).
 */
export const HISTORY_CAP = 50;

export interface CommandStackState {
  undoStack: Command[];
  redoStack: Command[];
  push: (cmd: Command) => void;
  undo: () => Command | null;
  redo: () => Command | null;
  clear: () => void;
  /**
   * Set the cursor so that `undoStack[index]` is the new top.
   * Valid range: `-1` (empty) through `current.length - 1`.
   * Out-of-range indices are clamped; no-op when already there.
   */
  jumpTo: (index: number) => void;
}

export const useCommandStack = create<CommandStackState>((set, get) => ({
  undoStack: [],
  redoStack: [],
  push: (cmd) => {
    set((state) => {
      const next = [...state.undoStack, cmd];
      // FIFO eviction: drop oldest entries past the cap.
      while (next.length > HISTORY_CAP) {
        next.shift();
      }
      return { undoStack: next, redoStack: [] };
    });
  },
  undo: () => {
    const { undoStack } = get();
    if (undoStack.length === 0) return null;
    const top = undoStack[undoStack.length - 1];
    set((state) => ({
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, top],
    }));
    return top;
  },
  redo: () => {
    const { redoStack } = get();
    if (redoStack.length === 0) return null;
    const top = redoStack[redoStack.length - 1];
    set((state) => ({
      undoStack: [...state.undoStack, top],
      redoStack: state.redoStack.slice(0, -1),
    }));
    return top;
  },
  clear: () => set({ undoStack: [], redoStack: [] }),
  jumpTo: (index) => {
    set((state) => {
      const combined = [...state.undoStack, ...state.redoStack.slice().reverse()];
      const clamped = Math.max(-1, Math.min(index, combined.length - 1));
      const nextUndo = combined.slice(0, clamped + 1);
      const nextRedo = combined.slice(clamped + 1).reverse();
      return { undoStack: nextUndo, redoStack: nextRedo };
    });
  },
}));
