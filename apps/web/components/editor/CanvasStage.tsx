'use client';

import * as fabric from 'fabric';
import * as React from 'react';

import { useCommandStack } from '@/lib/editor/command-stack';
import { assertValidEditorDocument, createEditorDocument } from '@/lib/editor/document';
import type { EditorLayer, MaskLayer, OcrTextLayer } from '@/lib/editor/layers';
import { getEditorTestHooks } from '@/lib/editor/test-hooks';
import type {
  CanvasStageHandle,
  EditorActiveTool,
  EditorLayerSummary,
  MaskBox,
  OpType,
} from '@/lib/editor/types';
import { cn } from '@/lib/utils';

type EditorCustomProps = {
  layerId?: string;
  layerType?: EditorLayerSummary['kind'];
  ocrIndex?: number;
  label?: string;
};

type EditorFabricObject = fabric.Object & { customProps?: EditorCustomProps };
type ExportImageFormat = 'png' | 'jpeg' | 'webp';
type CanvasImageLoadStatus = 'loading' | 'ready' | 'error';

const BASE_LAYER_ID = 'base-image';
const INPAINT_MASK_LAYER_ID = 'inpaint-mask';

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
  /** Fired when Fabric layer membership or layer metadata changes. */
  onLayersChange?: (layers: EditorLayerSummary[]) => void;
  /** Fired when Fabric active selection changes. */
  onSelectionChange?: (layerId: string | null) => void;
  /** Visible operator feedback when the base image cannot be loaded into Fabric. */
  imageLoadErrorLabel?: string;
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
      onLayersChange,
      onSelectionChange,
      imageLoadErrorLabel = 'Image failed to load. Canvas tools remain available.',
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
    const onLayersChangeRef = React.useRef<typeof onLayersChange>(onLayersChange);
    const onSelectionChangeRef = React.useRef<typeof onSelectionChange>(onSelectionChange);
    const baselineSnapshotRef = React.useRef<string | null>(null);
    const [imageLoadStatus, setImageLoadStatus] = React.useState<CanvasImageLoadStatus>('loading');
    const [imageLoadError, setImageLoadError] = React.useState<string | null>(null);
    /**
     * Mount guard ref — required to keep `new fabric.Canvas(...)` from running
     * twice under React 18 `<StrictMode>` double-mount. The cleanup branch
     * resets the guard to `false` so that legitimate unmount → remount (e.g.
     * HMR) still re-constructs cleanly.
     */
    const initRef = React.useRef(false);

    React.useEffect(() => {
      activeToolRef.current = activeTool ?? null;
      const fab = fabricRef.current;
      if (!fab) return;
      fab.defaultCursor =
        activeTool === 'inpaint' ? 'crosshair' : activeTool === 'text' ? 'text' : 'default';
      fab.hoverCursor =
        activeTool === 'inpaint' ? 'crosshair' : activeTool === 'text' ? 'text' : 'move';
      fab.selection = activeTool !== 'inpaint';
      if (activeTool === 'inpaint') {
        fab.discardActiveObject();
      }
      fab.requestRenderAll();
    }, [activeTool]);

    React.useEffect(() => {
      onMaskChangeRef.current = onMaskChange;
    }, [onMaskChange]);

    React.useEffect(() => {
      onLocalEditRef.current = onLocalEdit;
    }, [onLocalEdit]);

    React.useEffect(() => {
      onLayersChangeRef.current = onLayersChange;
    }, [onLayersChange]);

    React.useEffect(() => {
      onSelectionChangeRef.current = onSelectionChange;
    }, [onSelectionChange]);

    const ensureLayerProps = React.useCallback(
      (
        object: EditorFabricObject,
        index: number
      ): Required<Pick<EditorCustomProps, 'layerId'>> & EditorCustomProps => {
        const existing = object.customProps ?? {};
        if (existing.layerId) return { ...existing, layerId: existing.layerId };
        const layerId = `${imageId}-layer-${index}-${Date.now()}`;
        object.customProps = {
          ...existing,
          layerId,
          layerType: existing.layerType ?? 'fabric-object',
          label: existing.label ?? `Layer ${index + 1}`,
        };
        return { ...object.customProps, layerId };
      },
      [imageId]
    );

    const buildLayerSummaries = React.useCallback((): EditorLayerSummary[] => {
      const fab = fabricRef.current;
      if (!fab) return [];

      const activeObject = fab.getActiveObject() as EditorFabricObject | undefined;
      const activeLayerId = activeObject?.customProps?.layerId ?? null;
      const objectLayers = fab
        .getObjects()
        .map((object, index) => {
          const editorObject = object as EditorFabricObject;
          const props = ensureLayerProps(editorObject, index);
          const kind = props.layerType ?? 'fabric-object';
          return {
            id: props.layerId,
            label:
              props.label ??
              (kind === 'ocr-text'
                ? `OCR text ${(props.ocrIndex ?? index) + 1}`
                : kind === 'inpaint-mask'
                  ? 'Inpaint mask'
                  : `Layer ${index + 1}`),
            kind,
            visible: editorObject.visible !== false,
            locked: editorObject.selectable === false || editorObject.evented === false,
            opacity: typeof editorObject.opacity === 'number' ? editorObject.opacity : 1,
            selected: props.layerId === activeLayerId,
          } satisfies EditorLayerSummary;
        })
        .reverse();

      return [
        ...objectLayers,
        {
          id: BASE_LAYER_ID,
          label: 'Base image',
          kind: 'base-image',
          visible: true,
          locked: true,
          opacity: 1,
          selected: false,
        },
      ];
    }, [ensureLayerProps]);

    const emitLayerState = React.useCallback(() => {
      const summaries = buildLayerSummaries();
      onLayersChangeRef.current?.(summaries);
      onSelectionChangeRef.current?.(summaries.find((layer) => layer.selected)?.id ?? null);
    }, [buildLayerSummaries]);

    const findLayerObject = React.useCallback((layerId: string): EditorFabricObject | null => {
      const fab = fabricRef.current;
      if (!fab) return null;
      return (
        (fab
          .getObjects()
          .find((object) => (object as EditorFabricObject).customProps?.layerId === layerId) as
          | EditorFabricObject
          | undefined) ?? null
      );
    }, []);

    const layerTransformFromObject = React.useCallback((object: EditorFabricObject) => {
      return {
        x: Number(object.left ?? 0),
        y: Number(object.top ?? 0),
        width: Number(object.width ?? 0),
        height: Number(object.height ?? 0),
        rotation: Number(object.angle ?? 0),
        scaleX: Number(object.scaleX ?? 1),
        scaleY: Number(object.scaleY ?? 1),
      };
    }, []);

    const layerBaseFromObject = React.useCallback(
      (object: EditorFabricObject, index: number, now: string) => {
        const props = ensureLayerProps(object, index);
        return {
          id: props.layerId,
          name: props.label ?? `Layer ${index + 1}`,
          visible: object.visible !== false,
          locked: object.selectable === false || object.evented === false,
          opacity: typeof object.opacity === 'number' ? object.opacity : 1,
          transform: layerTransformFromObject(object),
          updatedAt: now,
          createdAt: now,
        };
      },
      [ensureLayerProps, layerTransformFromObject]
    );

    const fabricObjectToEditorLayer = React.useCallback(
      (object: EditorFabricObject, index: number, now: string): EditorLayer | null => {
        const props = ensureLayerProps(object, index);
        const base = layerBaseFromObject(object, index, now);

        if (props.layerType === 'ocr-text' && object instanceof fabric.Textbox) {
          const fill = typeof object.fill === 'string' ? object.fill : '#f0e8dd';
          const backgroundColor =
            typeof object.backgroundColor === 'string' ? object.backgroundColor : undefined;
          return {
            ...base,
            kind: 'ocr-text',
            source: 'ocr',
            text: object.text || 'Text',
            ocrIndex: props.ocrIndex,
            fontFamily:
              typeof object.fontFamily === 'string'
                ? object.fontFamily
                : 'Inter, PingFang SC, Noto Sans SC, sans-serif',
            fontSize: typeof object.fontSize === 'number' ? object.fontSize : 18,
            fill,
            backgroundColor,
          } satisfies OcrTextLayer;
        }

        if (props.layerType === 'inpaint-mask' && object instanceof fabric.Rect) {
          return {
            ...base,
            kind: 'mask',
            source: 'user',
            purpose: 'inpaint',
            maskBox: {
              x: Number(object.left ?? 0),
              y: Number(object.top ?? 0),
              w: Number(object.width ?? 0),
              h: Number(object.height ?? 0),
            },
          } satisfies MaskLayer;
        }

        return null;
      },
      [ensureLayerProps, layerBaseFromObject]
    );

    const fabricObjectFromEditorLayer = React.useCallback(
      async (layer: EditorLayer): Promise<EditorFabricObject | null> => {
        if (layer.kind === 'ocr-text') {
          const text = new fabric.Textbox(layer.text || 'Text', {
            left: layer.transform.x,
            top: layer.transform.y,
            width: Math.max(1, layer.transform.width),
            fontSize: layer.fontSize,
            fontFamily: layer.fontFamily,
            fill: layer.fill,
            backgroundColor: layer.backgroundColor,
            opacity: layer.opacity,
            visible: layer.visible,
            selectable: !layer.locked,
            evented: !layer.locked,
            angle: layer.transform.rotation,
            scaleX: layer.transform.scaleX,
            scaleY: layer.transform.scaleY,
            editable: true,
            cornerColor: '#ffffff',
            borderColor: '#ffffff',
            transparentCorners: false,
          }) as fabric.Textbox & { customProps?: EditorCustomProps };
          text.customProps = {
            layerId: layer.id,
            layerType: 'ocr-text',
            ocrIndex: layer.ocrIndex,
            label: layer.name,
          };
          return text;
        }

        if (layer.kind === 'mask') {
          const rect = new fabric.Rect({
            left: layer.maskBox.x,
            top: layer.maskBox.y,
            width: layer.maskBox.w,
            height: layer.maskBox.h,
            fill: 'rgba(99, 102, 241, 0.18)',
            stroke: 'rgb(99, 102, 241)',
            strokeWidth: 2,
            strokeUniform: true,
            opacity: layer.opacity,
            visible: layer.visible,
            selectable: !layer.locked,
            evented: !layer.locked,
            angle: layer.transform.rotation,
            scaleX: layer.transform.scaleX,
            scaleY: layer.transform.scaleY,
          }) as fabric.Rect & { customProps?: EditorCustomProps };
          rect.customProps = {
            layerId: layer.id,
            layerType: 'inpaint-mask',
            label: layer.name,
          };
          return rect;
        }

        if (layer.kind === 'raster') {
          const image = (await fabric.FabricImage.fromURL(layer.imageUrl, {
            crossOrigin: 'anonymous',
          })) as fabric.FabricImage & { customProps?: EditorCustomProps };
          image.set({
            left: layer.transform.x,
            top: layer.transform.y,
            width: layer.transform.width,
            height: layer.transform.height,
            opacity: layer.opacity,
            visible: layer.visible,
            selectable: !layer.locked,
            evented: !layer.locked,
            angle: layer.transform.rotation,
            scaleX: layer.transform.scaleX,
            scaleY: layer.transform.scaleY,
          });
          image.customProps = {
            layerId: layer.id,
            layerType: 'fabric-object',
            label: layer.name,
          };
          return image;
        }

        return null;
      },
      []
    );

    const addTextLayer = React.useCallback(
      (point?: { x: number; y: number }) => {
        const fab = fabricRef.current;
        if (!fab) return;

        const rootStyle =
          typeof window !== 'undefined' ? getComputedStyle(document.documentElement) : null;
        const textFill = rootStyle?.getPropertyValue('--text-primary').trim() || '#f0e8dd';
        const now = Date.now();
        const text = new fabric.Textbox('Text', {
          left: Math.max(0, Math.min(width - 180, point?.x ?? width / 2 - 90)),
          top: Math.max(0, Math.min(height - 48, point?.y ?? height / 2 - 24)),
          width: 180,
          fontSize: 36,
          fontFamily: 'Inter, PingFang SC, Noto Sans SC, sans-serif',
          fill: textFill,
          backgroundColor: 'rgba(11, 11, 14, 0.54)',
          padding: 6,
          editable: true,
          selectable: true,
          cornerColor: '#ffffff',
          borderColor: '#ffffff',
          transparentCorners: false,
        }) as fabric.Textbox & { customProps?: EditorCustomProps };
        text.customProps = {
          layerId: `text-${now}`,
          layerType: 'ocr-text',
          label: 'Text layer',
        };
        fab.add(text);
        fab.setActiveObject(text);
        text.enterEditing();
        text.selectAll();
        useCommandStack.getState().push({
          id: `${imageId}-${now}`,
          op_type: 'edit_text',
          payload: { text: 'Text', source: 'manual' },
          snapshot_json: JSON.stringify(fab.toObject(['customProps'])),
          ts: now,
        });
        onLocalEditRef.current?.();
        fab.requestRenderAll();
        emitLayerState();
      },
      [emitLayerState, height, imageId, width]
    );

    React.useImperativeHandle(
      ref,
      () => ({
        selectByOcrIndex: (index: number) => {
          const fab = fabricRef.current;
          if (!fab) return;
          const target = fab
            .getObjects()
            .find((o) => (o as EditorFabricObject).customProps?.ocrIndex === index);
          if (target) {
            fab.setActiveObject(target);
            fab.requestRenderAll();
            emitLayerState();
          }
        },
        upsertTextLayerFromOcr: (index, box) => {
          const fab = fabricRef.current;
          if (!fab) return;
          const existing = fab
            .getObjects()
            .find((o) => (o as EditorFabricObject).customProps?.ocrIndex === index);
          if (existing) {
            fab.setActiveObject(existing);
            if (existing instanceof fabric.Textbox) {
              existing.enterEditing();
              existing.selectAll();
            }
            fab.requestRenderAll();
            emitLayerState();
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
          }) as fabric.Textbox & { customProps?: EditorCustomProps };
          text.customProps = {
            layerId: `ocr-text-${index}`,
            layerType: 'ocr-text',
            ocrIndex: index,
            label: `OCR text ${index + 1}`,
          };
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
          emitLayerState();
        },
        addTextLayer,
        clearMaskRect: () => {
          const fab = fabricRef.current;
          const rect = maskRectRef.current;
          if (fab && rect) {
            fab.remove(rect);
            maskRectRef.current = null;
            fab.requestRenderAll();
          }
          onMaskChangeRef.current?.(null);
          emitLayerState();
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
            emitLayerState();
          });
        },
        redo: () => {
          const fab = fabricRef.current;
          if (!fab) return;
          const redone = useCommandStack.getState().redo();
          if (!redone) return;
          void fab.loadFromJSON(JSON.parse(redone.snapshot_json)).then(() => {
            fab.requestRenderAll();
            emitLayerState();
          });
        },
        selectLayerById: (layerId) => {
          if (layerId === BASE_LAYER_ID) return;
          const fab = fabricRef.current;
          const target = findLayerObject(layerId);
          if (!fab || !target || target.selectable === false) return;
          fab.setActiveObject(target);
          fab.requestRenderAll();
          emitLayerState();
        },
        setLayerVisibility: (layerId, visible) => {
          const fab = fabricRef.current;
          const target = findLayerObject(layerId);
          if (!fab || !target) return;
          target.set({ visible });
          if (!visible && fab.getActiveObject() === target) {
            fab.discardActiveObject();
          }
          fab.requestRenderAll();
          onLocalEditRef.current?.();
          emitLayerState();
        },
        setLayerLocked: (layerId, locked) => {
          const fab = fabricRef.current;
          const target = findLayerObject(layerId);
          if (!fab || !target) return;
          target.set({
            selectable: !locked,
            evented: !locked,
            lockMovementX: locked,
            lockMovementY: locked,
            lockRotation: locked,
            lockScalingX: locked,
            lockScalingY: locked,
          });
          if (locked && fab.getActiveObject() === target) {
            fab.discardActiveObject();
          }
          fab.requestRenderAll();
          onLocalEditRef.current?.();
          emitLayerState();
        },
        moveLayer: (layerId, direction) => {
          const fab = fabricRef.current;
          const target = findLayerObject(layerId);
          if (!fab || !target) return;
          const stack = fab as fabric.Canvas & {
            bringObjectForward?: (object: fabric.Object) => void;
            sendObjectBackwards?: (object: fabric.Object) => void;
          };
          if (direction === 'up') {
            stack.bringObjectForward?.(target);
          } else {
            stack.sendObjectBackwards?.(target);
          }
          fab.requestRenderAll();
          onLocalEditRef.current?.();
          emitLayerState();
        },
        deleteLayer: (layerId) => {
          const fab = fabricRef.current;
          const target = findLayerObject(layerId);
          if (!fab || !target) return;
          if (maskRectRef.current === target) {
            maskRectRef.current = null;
            onMaskChangeRef.current?.(null);
          }
          fab.remove(target);
          if (fab.getActiveObject() === target) {
            fab.discardActiveObject();
          }
          fab.requestRenderAll();
          onLocalEditRef.current?.();
          emitLayerState();
        },
        setLayerOpacity: (layerId, opacity) => {
          const fab = fabricRef.current;
          const target = findLayerObject(layerId);
          if (!fab || !target) return;
          target.set({ opacity: Math.max(0, Math.min(1, opacity)) });
          fab.requestRenderAll();
          onLocalEditRef.current?.();
          emitLayerState();
        },
        exportPngDataUrl: () => {
          const fab = fabricRef.current;
          if (!fab) return null;
          fab.discardActiveObject();
          fab.requestRenderAll();
          return fab.toDataURL({ format: 'png', multiplier: 1 });
        },
        exportImageDataUrl: (options = {}) => {
          const fab = fabricRef.current;
          if (!fab) return null;
          const format: ExportImageFormat = options.format ?? 'png';
          fab.discardActiveObject();
          fab.requestRenderAll();
          return fab.toDataURL({
            format,
            quality: options.quality,
            multiplier: 1,
          });
        },
        exportEditorDocument: (input) => {
          const fab = fabricRef.current;
          if (!fab) return null;
          const now = new Date().toISOString();
          const baseDocument = createEditorDocument({
            id: input.id,
            imageId: input.imageId,
            imageUrl: input.imageUrl,
            width: input.width,
            height: input.height,
            now,
          });
          const objectLayers = fab
            .getObjects()
            .map((object, index) =>
              fabricObjectToEditorLayer(object as EditorFabricObject, index, now)
            )
            .filter((layer): layer is EditorLayer => layer !== null);
          const activeLayerId =
            (fab.getActiveObject() as EditorFabricObject | undefined)?.customProps?.layerId ?? null;
          return assertValidEditorDocument({
            ...baseDocument,
            layers: [baseDocument.layers[0], ...objectLayers],
            selectedLayerIds: activeLayerId ? [activeLayerId] : ['layer:base-image'],
            toolState: {
              activeToolId: input.activeToolId,
              enabledToolGroups: input.enabledToolGroups,
            },
            updatedAt: now,
          });
        },
        loadEditorDocument: async (document) => {
          const fab = fabricRef.current;
          if (!fab) return;
          const validDocument = assertValidEditorDocument(document);
          fab.discardActiveObject();
          for (const object of [...fab.getObjects()]) {
            fab.remove(object);
          }
          maskRectRef.current = null;
          onMaskChangeRef.current?.(null);

          const baseLayer =
            validDocument.layers.find((layer) => layer.kind === 'base-image') ?? null;
          const backgroundImageUrl =
            baseLayer?.kind === 'base-image' ? baseLayer.imageUrl : validDocument.source.imageUrl;
          try {
            const image = await fabric.FabricImage.fromURL(backgroundImageUrl, {
              crossOrigin: 'anonymous',
            });
            fab.backgroundImage = image;
          } catch {
            fab.backgroundImage = undefined;
          }

          const fabricObjects = await Promise.all(
            validDocument.layers
              .filter((layer) => layer.kind !== 'base-image')
              .map((layer) => fabricObjectFromEditorLayer(layer))
          );
          for (const object of fabricObjects) {
            if (!object) continue;
            fab.add(object);
            if (object.customProps?.layerType === 'inpaint-mask' && object instanceof fabric.Rect) {
              maskRectRef.current = object;
              onMaskChangeRef.current?.({
                x: Number(object.left ?? 0),
                y: Number(object.top ?? 0),
                w: Number(object.width ?? 0),
                h: Number(object.height ?? 0),
              });
            }
          }

          const selectedLayerId = validDocument.selectedLayerIds[0];
          const selectedObject = selectedLayerId ? findLayerObject(selectedLayerId) : null;
          if (selectedObject && selectedObject.selectable !== false) {
            fab.setActiveObject(selectedObject);
          }
          baselineSnapshotRef.current = JSON.stringify(fab.toObject(['customProps']));
          useCommandStack.getState().clear();
          fab.requestRenderAll();
          emitLayerState();
        },
        exportFabricSnapshot: () => fabricRef.current?.toObject(['customProps']) ?? null,
        getObjectCount: () => fabricRef.current?.getObjects().length ?? 0,
      }),
      [
        addTextLayer,
        emitLayerState,
        fabricObjectFromEditorLayer,
        fabricObjectToEditorLayer,
        findLayerObject,
        imageId,
      ]
    );

    React.useEffect(() => {
      if (initRef.current) return;
      if (!canvasElRef.current) return;
      initRef.current = true;
      setImageLoadStatus('loading');
      setImageLoadError(null);

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
        fab.defaultCursor =
          activeToolRef.current === 'inpaint'
            ? 'crosshair'
            : activeToolRef.current === 'text'
              ? 'text'
              : 'default';
        fab.hoverCursor =
          activeToolRef.current === 'inpaint'
            ? 'crosshair'
            : activeToolRef.current === 'text'
              ? 'text'
              : 'move';
        fab.selection = activeToolRef.current !== 'inpaint';

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
          const tool = activeToolRef.current;
          if (tool === 'text' && !e.target) {
            addTextLayer(fab.getPointer(e.e));
            return;
          }
          if (tool !== 'inpaint') return;
          if (maskRectRef.current) return; // committed mask exists — block re-draw
          const p = fab.getPointer(e.e);
          drawingMask = true;
          dragStart = { x: p.x, y: p.y };
          const maskRect = new fabric.Rect({
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
          }) as fabric.Rect & { customProps?: EditorCustomProps };
          maskRect.customProps = {
            layerId: INPAINT_MASK_LAYER_ID,
            layerType: 'inpaint-mask',
            label: 'Inpaint mask',
          };
          liveMaskRect = maskRect;
          fab.add(liveMaskRect);
          emitLayerState();
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
            emitLayerState();
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
          emitLayerState();
        });

        fab.on('selection:created', emitLayerState);
        fab.on('selection:updated', emitLayerState);
        fab.on('selection:cleared', emitLayerState);

        const hooks = getEditorTestHooks();
        if (hooks) {
          hooks.canvas = fab;
          hooks.commandStack = useCommandStack;
        }

        if (!imageUrl) {
          setImageLoadStatus('error');
          setImageLoadError('Image URL is empty.');
          emitLayerState();
          return;
        }

        fabric.FabricImage.fromURL(imageUrl, { crossOrigin: 'anonymous' })
          .then((img) => {
            if (!fabricRef.current) return; // unmounted during async load
            fab.backgroundImage = img;
            baselineSnapshotRef.current = JSON.stringify(fab.toObject(['customProps']));
            setImageLoadStatus('ready');
            setImageLoadError(null);
            fab.requestRenderAll();
            emitLayerState();
          })
          .catch((error: unknown) => {
            if (cancelled || !fabricRef.current) return;
            setImageLoadStatus('error');
            setImageLoadError(error instanceof Error ? error.message : 'Image load failed.');
            emitLayerState();
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
        const hooks = getEditorTestHooks();
        if (hooks?.canvas === fab) {
          hooks.canvas = undefined;
        }
        initRef.current = false;
      };
    }, [addTextLayer, emitLayerState, imageId, imageUrl, width, height]);

    return (
      <div
        data-testid="canvas-stage"
        data-active-tool={activeTool ?? 'none'}
        data-image-load-state={imageLoadStatus}
        className={cn(
          'relative inline-block rounded-card border border-border-subtle bg-surface-02',
          className
        )}
      >
        <canvas ref={canvasElRef} width={width} height={height} />
        {imageLoadStatus !== 'ready' ? (
          <div
            data-testid={
              imageLoadStatus === 'error' ? 'canvas-image-error' : 'canvas-image-loading'
            }
            role={imageLoadStatus === 'error' ? 'alert' : 'status'}
            aria-live="polite"
            className={cn(
              'pointer-events-none absolute inset-4 flex items-start justify-center rounded-input border px-s-3 py-s-2 text-center text-xs shadow-lift',
              imageLoadStatus === 'error'
                ? 'border-danger/40 bg-danger/10 text-danger'
                : 'border-border-subtle bg-surface-01/85 text-ink-muted'
            )}
          >
            {imageLoadStatus === 'error'
              ? `Canvas image could not be loaded. Editing remains available. ${imageLoadError ?? ''}`
              : 'Loading canvas image…'}
          </div>
        ) : null}
      </div>
    );
  }
);
