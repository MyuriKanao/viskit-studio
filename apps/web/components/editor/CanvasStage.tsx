'use client';

import * as fabric from 'fabric';
import * as React from 'react';

import { useCommandStack } from '@/lib/editor/command-stack';
import type { CanvasStageHandle, MaskBox, OpType } from '@/lib/editor/types';
import { cn } from '@/lib/utils';

export type EditorActiveTool = 'select' | 'text' | 'move' | 'inpaint' | null;

export interface CanvasStageProps {
  imageId: string;
  imageUrl: string;
  width?: number;
  height?: number;
  className?: string;
  /** Current active tool; mask drag is only armed when this is 'inpaint'. */
  activeTool?: EditorActiveTool;
  /** Fired on mouse-up after a mask rect is committed (or `null` on clear). */
  onMaskChange?: (box: MaskBox | null) => void;
  /** Fired when a local canvas edit needs explicit save. */
  onLocalEdit?: () => void;
}

/**
 * fabric.js@6 canvas host for the image editor.
 *
 * Consumers must import this via `next/dynamic` with `ssr: false`
 * (fabric.js touches `document` at module-init time). Dynamic-import
 * wiring lives in US-010 (`EditorRoot`); this file deliberately
 * does NOT default-export so it can never become a Next.js route entry.
 */
export const CanvasStage = React.forwardRef<CanvasStageHandle, CanvasStageProps>(
  function CanvasStage(
    {
      imageId,
      imageUrl,
      width = 1024,
      height = 1536,
      className,
      activeTool,
      onMaskChange,
      onLocalEdit,
    },
    ref
  ) {
    const canvasElRef = React.useRef<HTMLCanvasElement | null>(null);
    const fabricRef = React.useRef<fabric.Canvas | null>(null);
    /** Committed mask rectangle (after mouse-up); cleared on `clearMaskRect()`. */
    const maskRectRef = React.useRef<fabric.Rect | null>(null);
    /** Latest activeTool — read inside fabric handlers (kept out of useEffect deps). */
    const activeToolRef = React.useRef<EditorActiveTool>(activeTool ?? null);
    /** Latest onMaskChange — read inside fabric handlers (kept out of useEffect deps). */
    const onMaskChangeRef = React.useRef<typeof onMaskChange>(onMaskChange);
    const onLocalEditRef = React.useRef<typeof onLocalEdit>(onLocalEdit);
    const baselineSnapshotRef = React.useRef<string | null>(null);
    /**
     * Mount guard ref — required to keep `new fabric.Canvas(...)` from running
     * twice under React 18 `<StrictMode>` double-mount. The cleanup branch
     * resets the guard to `false` so that legitimate unmount → remount (e.g.
     * HMR) still re-constructs cleanly.
     */
    const initRef = React.useRef(false);

    React.useEffect(() => {
      activeToolRef.current = activeTool ?? null;
    }, [activeTool]);

    React.useEffect(() => {
      onMaskChangeRef.current = onMaskChange;
    }, [onMaskChange]);

    React.useEffect(() => {
      onLocalEditRef.current = onLocalEdit;
    }, [onLocalEdit]);

    React.useImperativeHandle(
      ref,
      () => ({
        selectByOcrIndex: (index: number) => {
          const fab = fabricRef.current;
          if (!fab) return;
          const target = fab
            .getObjects()
            .find(
              (o) =>
                (o as fabric.Object & { customProps?: { ocrIndex?: number } }).customProps
                  ?.ocrIndex === index
            );
          if (target) {
            fab.setActiveObject(target);
            fab.requestRenderAll();
          }
        },
        upsertTextLayerFromOcr: (index, box) => {
          const fab = fabricRef.current;
          if (!fab) return;
          const existing = fab
            .getObjects()
            .find(
              (o) =>
                (o as fabric.Object & { customProps?: { ocrIndex?: number; layerType?: string } })
                  .customProps?.ocrIndex === index
            );
          if (existing) {
            fab.setActiveObject(existing);
            if (existing instanceof fabric.Textbox) {
              existing.enterEditing();
              existing.selectAll();
            }
            fab.requestRenderAll();
            return;
          }

          const fontSize = Math.max(18, Math.min(72, box.h * 0.9));
          const rootStyle =
            typeof window !== 'undefined' ? getComputedStyle(document.documentElement) : null;
          const textFill = rootStyle?.getPropertyValue('--text-primary').trim() || '#f0e8dd';
          const text = new fabric.Textbox(box.text || 'Text', {
            left: box.x,
            top: box.y,
            width: Math.max(80, box.w),
            fontSize,
            fontFamily: 'Inter, PingFang SC, Noto Sans SC, sans-serif',
            fill: textFill,
            backgroundColor: 'rgba(11, 11, 14, 0.54)',
            padding: 4,
            editable: true,
            selectable: true,
            cornerColor: '#ffffff',
            borderColor: '#ffffff',
            transparentCorners: false,
          }) as fabric.Textbox & { customProps?: { layerType: string; ocrIndex: number } };
          text.customProps = { layerType: 'ocr-text', ocrIndex: index };
          fab.add(text);
          fab.setActiveObject(text);
          text.enterEditing();
          text.selectAll();
          const snapshot = fab.toObject(['customProps']);
          useCommandStack.getState().push({
            id: `${imageId}-${Date.now()}`,
            op_type: 'edit_text',
            payload: { ocrIndex: index, text: box.text },
            snapshot_json: JSON.stringify(snapshot),
            ts: Date.now(),
          });
          onLocalEditRef.current?.();
          fab.requestRenderAll();
        },
        clearMaskRect: () => {
          const fab = fabricRef.current;
          const rect = maskRectRef.current;
          if (fab && rect) {
            fab.remove(rect);
            maskRectRef.current = null;
            fab.requestRenderAll();
          }
          onMaskChangeRef.current?.(null);
        },
        undo: () => {
          const fab = fabricRef.current;
          if (!fab) return;
          const undone = useCommandStack.getState().undo();
          if (!undone) return;
          const previous = useCommandStack.getState().undoStack.at(-1);
          const snapshot = previous?.snapshot_json ?? baselineSnapshotRef.current;
          if (!snapshot) return;
          void fab.loadFromJSON(JSON.parse(snapshot)).then(() => {
            fab.requestRenderAll();
          });
        },
        redo: () => {
          const fab = fabricRef.current;
          if (!fab) return;
          const redone = useCommandStack.getState().redo();
          if (!redone) return;
          void fab.loadFromJSON(JSON.parse(redone.snapshot_json)).then(() => {
            fab.requestRenderAll();
          });
        },
        exportPngDataUrl: () => {
          const fab = fabricRef.current;
          if (!fab) return null;
          fab.discardActiveObject();
          fab.requestRenderAll();
          return fab.toDataURL({ format: 'png', multiplier: 1 });
        },
        getObjectCount: () => fabricRef.current?.getObjects().length ?? 0,
      }),
      [imageId]
    );

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

        // Mask-drag state — only used when activeTool === 'inpaint' and no
        // committed mask exists yet. Drag below MIN_MASK_PX in either axis
        // is discarded as a stray click.
        const MIN_MASK_PX = 4;
        let drawingMask = false;
        let dragStart: { x: number; y: number } | null = null;
        let liveMaskRect: fabric.Rect | null = null;

        fab.on('object:moving', () => {
          pendingOp = 'move_layer';
        });
        fab.on('object:scaling', () => {
          pendingOp = 'move_layer';
        });
        fab.on('text:changed', () => {
          onLocalEditRef.current?.();
        });

        fab.on('mouse:down', (e) => {
          if (activeToolRef.current !== 'inpaint') return;
          if (maskRectRef.current) return; // committed mask exists — block re-draw
          const p = fab.getPointer(e.e);
          drawingMask = true;
          dragStart = { x: p.x, y: p.y };
          liveMaskRect = new fabric.Rect({
            left: p.x,
            top: p.y,
            width: 1,
            height: 1,
            fill: 'rgba(99, 102, 241, 0.18)',
            stroke: 'rgb(99, 102, 241)',
            strokeWidth: 2,
            strokeUniform: true,
            selectable: false,
            evented: false,
          });
          fab.add(liveMaskRect);
        });

        fab.on('mouse:move', (e) => {
          if (!drawingMask || !dragStart || !liveMaskRect) return;
          const p = fab.getPointer(e.e);
          const x = Math.min(dragStart.x, p.x);
          const y = Math.min(dragStart.y, p.y);
          const w = Math.abs(p.x - dragStart.x);
          const h = Math.abs(p.y - dragStart.y);
          liveMaskRect.set({ left: x, top: y, width: w, height: h });
          fab.requestRenderAll();
        });

        fab.on('mouse:up', () => {
          if (drawingMask && liveMaskRect) {
            const box: MaskBox = {
              x: liveMaskRect.left ?? 0,
              y: liveMaskRect.top ?? 0,
              w: liveMaskRect.width ?? 0,
              h: liveMaskRect.height ?? 0,
            };
            if (box.w >= MIN_MASK_PX && box.h >= MIN_MASK_PX) {
              maskRectRef.current = liveMaskRect;
              onMaskChangeRef.current?.(box);
            } else {
              fab.remove(liveMaskRect);
              fab.requestRenderAll();
            }
            drawingMask = false;
            dragStart = null;
            liveMaskRect = null;
            return;
          }
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

        // Test hook for Playwright. Viskit Studio is a single-tenant internal
        // tool (per project memory), so unconditionally exposing the canvas
        // and store via `window.__editorTest` is acceptable. Used by the
        // EPIC-5b AC#3/#5/#7 specs to drive real fabric events from the test
        // harness without simulating raw DOM pointer events. Direct property
        // assignment (not spread reassignment) avoids racing EditorRoot's
        // setMaskBox install when this canvas mounts second.
        if (typeof window !== 'undefined') {
          const w = window as Window & { __editorTest?: Record<string, unknown> };
          if (!w.__editorTest) w.__editorTest = {};
          w.__editorTest.canvas = fab;
          w.__editorTest.commandStack = useCommandStack;
        }

        // Best-effort base-image load. Errors are swallowed; the canvas
        // remains usable for text-only ops even if the underlying PNG fails.
        fabric.FabricImage.fromURL(imageUrl, { crossOrigin: 'anonymous' })
          .then((img) => {
            if (!fabricRef.current) return; // unmounted during async load
            fab.backgroundImage = img;
            baselineSnapshotRef.current = JSON.stringify(fab.toObject(['customProps']));
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
          maskRectRef.current = null;
        }
        if (typeof window !== 'undefined') {
          const w = window as Window & { __editorTest?: Record<string, unknown> };
          if (w.__editorTest) {
            w.__editorTest.canvas = undefined;
          }
        }
        initRef.current = false;
      };
    }, [imageId, imageUrl, width, height]);

    return (
      <div
        data-testid="canvas-stage"
        data-active-tool={activeTool ?? 'none'}
        className={cn(
          'relative inline-block rounded-card border border-border-subtle bg-surface-02',
          className
        )}
      >
        <canvas ref={canvasElRef} width={width} height={height} />
      </div>
    );
  }
);
