'use client';

import * as fabric from 'fabric';
import * as React from 'react';

import { useCommandStack } from '@/lib/editor/command-stack';
import type { OpType } from '@/lib/editor/types';
import { cn } from '@/lib/utils';

export interface CanvasStageProps {
  imageId: string;
  imageUrl: string;
  width?: number;
  height?: number;
  className?: string;
}

/**
 * fabric.js@6 canvas host for the EPIC-5 Text-touchup Editor.
 *
 * Spec references:
 *   - `.omc/specs/deep-interview-epic-5-text-touchup-editor.md` §R7
 *     (StrictMode lifecycle + imperative-only fabric handlers).
 *   - §R2 (Command-stack snapshot on `mouse:up`).
 *
 * Consumers must import this via `next/dynamic` with `ssr: false`
 * (fabric.js touches `document` at module-init time). Dynamic-import
 * wiring lives in US-010 (`EditorRoot`); this file deliberately
 * does NOT default-export so it can never become a Next.js route entry.
 */
export function CanvasStage({
  imageId,
  imageUrl,
  width = 1024,
  height = 1536,
  className,
}: CanvasStageProps) {
  const canvasElRef = React.useRef<HTMLCanvasElement | null>(null);
  const fabricRef = React.useRef<fabric.Canvas | null>(null);
  /**
   * Mount guard ref — required to keep `new fabric.Canvas(...)` from running
   * twice under React 18 `<StrictMode>` double-mount. The cleanup branch
   * resets the guard to `false` so that legitimate unmount → remount (e.g.
   * HMR) still re-constructs cleanly.
   */
  const initRef = React.useRef(false);

  React.useEffect(() => {
    if (initRef.current) return;
    if (!canvasElRef.current) return;
    initRef.current = true;

    /**
     * §R7 quirk: under React 18 `<StrictMode>` the cleanup of the first mount
     * runs synchronously between the synthetic double-mount. If we constructed
     * fabric eagerly and disposed in cleanup, StrictMode would yield
     * construct=2 / dispose=2 (one mid-cycle, one final). AC#6 requires
     * exactly construct=1 / dispose=1.
     *
     * Resolution: defer construction by one microtask (rAF when available),
     * gated by a `cancelled` flag. The synthetic StrictMode cleanup flips
     * `cancelled = true` before fabric is ever instantiated, so the second
     * mount short-circuits via `initRef.current === true` (refs persist
     * across the StrictMode double-effect) and we end up with exactly one
     * live canvas at mount and exactly one dispose at unmount.
     */
    let cancelled = false;
    let raf: number | null = null;

    const construct = () => {
      if (cancelled) return;
      if (!canvasElRef.current) return;

      const fab = new fabric.Canvas(canvasElRef.current, {
        width,
        height,
        preserveObjectStacking: true,
        selection: true,
      });
      fabricRef.current = fab;

      // Per §R7: imperative-only event handlers — NO setState during
      // drag/scale, NO startTransition. Fabric drives its own 60fps render
      // loop. We track a `pendingOp` flag set inside the imperative handlers
      // and commit exactly ONE snapshot on `mouse:up`.
      let pendingOp: OpType | null = null;
      fab.on('object:moving', () => {
        pendingOp = 'move_layer';
      });
      fab.on('object:scaling', () => {
        pendingOp = 'move_layer';
      });
      fab.on('mouse:up', () => {
        if (!pendingOp) return;
        // `toObject(['customProps'])` lets us extend the schema later without
        // bumping the Command shape; stringify keeps `Command.snapshot_json`
        // a plain string per §R2. (fabric@6 typed `toJSON()` as zero-arg; the
        // propertiesToInclude array now lives on `toObject`.)
        const json = fab.toObject(['customProps']);
        useCommandStack.getState().push({
          id: `${imageId}-${Date.now()}`,
          op_type: pendingOp,
          payload: null,
          snapshot_json: JSON.stringify(json),
          ts: Date.now(),
        });
        pendingOp = null;
      });

      // Best-effort base-image load. Errors are swallowed; the canvas
      // remains usable for text-only ops even if the underlying PNG fails.
      fabric.FabricImage.fromURL(imageUrl, { crossOrigin: 'anonymous' })
        .then((img) => {
          if (!fabricRef.current) return; // unmounted during async load
          fab.backgroundImage = img;
          fab.requestRenderAll();
        })
        .catch(() => {
          /* swallow */
        });
    };

    if (typeof requestAnimationFrame === 'function') {
      raf = requestAnimationFrame(construct);
    } else {
      queueMicrotask(construct);
    }

    return () => {
      cancelled = true;
      if (raf !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(raf);
      }
      const fab = fabricRef.current;
      if (fab) {
        fab.dispose();
        fabricRef.current = null;
      }
      initRef.current = false;
    };
  }, [imageId, imageUrl, width, height]);

  return (
    <div
      data-testid="canvas-stage"
      className={cn(
        'relative inline-block rounded-card border border-border-subtle bg-surface-02',
        className
      )}
    >
      <canvas ref={canvasElRef} width={width} height={height} />
    </div>
  );
}
