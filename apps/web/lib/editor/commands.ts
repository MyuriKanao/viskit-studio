import {
  type ViskitEditorDocument,
  assertValidEditorDocument,
  selectLayers,
  withUpdatedLayer,
} from './document';
import { type EditorCommand, type EditorHistoryState, pushHistoryCommand } from './history';
import {
  type EditorLayer,
  type EditorLayerFilter,
  type EditorPoint,
  type EditorTransform,
  type MaskLayer,
  type PaintLayer,
  type VectorShapeLayer,
  addPaintStroke,
  applyLayerFilter,
  createMaskLayer,
  createPaintLayer,
  createVectorShapeLayer,
  insertLayer,
  removeLayer,
  reorderLayer,
  updateLayer,
} from './layers';

export type EditorSelectionShape =
  | { kind: 'none' }
  | { kind: 'rect'; bounds: EditorSelectionBounds }
  | { kind: 'polygon'; bounds: EditorSelectionBounds; points: EditorPoint[] };

export interface EditorSelectionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EditorSelectionState {
  shape: EditorSelectionShape;
  inverted: boolean;
  feather: number;
}

export type EditorCoreCommand =
  | { kind: 'layer.add'; layer: EditorLayer; index?: number; select?: boolean }
  | { kind: 'layer.remove'; layerId: string }
  | { kind: 'layer.update'; layerId: string; patch: Parameters<typeof updateLayer>[2] }
  | { kind: 'layer.transform'; layerId: string; transform: Partial<EditorTransform> }
  | { kind: 'layer.reorder'; layerId: string; toIndex: number }
  | { kind: 'layer.select'; layerIds: string[] }
  | { kind: 'shape.add'; layer: CreateShapeLayerInput; index?: number; select?: boolean }
  | { kind: 'paint.layer.add'; layer: CreatePaintLayerInput; index?: number; select?: boolean }
  | { kind: 'paint.stroke.add'; layerId: string; stroke: PaintLayer['strokes'][number] }
  | { kind: 'filter.apply'; layerId: string; filter: EditorLayerFilter }
  | { kind: 'selection.set'; selection: EditorSelectionState | null }
  | {
      kind: 'selection.mask.add';
      layer: CreateSelectionMaskInput;
      index?: number;
      select?: boolean;
    }
  | { kind: 'document.resize'; width: number; height: number; scaleLayers?: boolean }
  | { kind: 'document.crop'; crop: EditorSelectionBounds }
  | { kind: 'document.rotate'; degrees: 90 | -90 | 180 | 270 | -270 }
  | { kind: 'document.flip'; axis: 'horizontal' | 'vertical'; layerIds?: string[] }
  | { kind: 'tool.change'; toolId: string; enabledToolGroups?: string[] }
  | { kind: 'export.checkpoint'; commandId: string; documentHash?: string; savedAt?: string };

export interface ApplyEditorCommandWithHistoryOptions {
  commandId?: string;
  now?: string;
  ts?: number;
  checkpoint?: ViskitEditorDocument;
}

export interface ApplyEditorCommandWithHistoryResult {
  document: ViskitEditorDocument;
  history: EditorHistoryState;
  command: EditorCommand<EditorCoreCommand>;
}

export type CreateShapeLayerInput = Omit<Parameters<typeof createVectorShapeLayer>[0], 'now'>;
export type CreatePaintLayerInput = Omit<Parameters<typeof createPaintLayer>[0], 'now'>;
export type CreateSelectionMaskInput = Omit<
  Parameters<typeof createMaskLayer>[0],
  'now' | 'purpose'
> & {
  purpose?: MaskLayer['purpose'];
};

export function applyEditorCommand(
  document: ViskitEditorDocument,
  command: EditorCoreCommand,
  now = new Date().toISOString()
): ViskitEditorDocument {
  const next = applyEditorCommandUnchecked(document, command, now);
  return assertValidEditorDocument({ ...next, updatedAt: now });
}

export function applyEditorCommandWithHistory(
  document: ViskitEditorDocument,
  history: EditorHistoryState,
  command: EditorCoreCommand,
  options: ApplyEditorCommandWithHistoryOptions = {}
): ApplyEditorCommandWithHistoryResult {
  const ts = options.ts ?? Date.now();
  const now = options.now ?? new Date(ts).toISOString();
  const nextDocument = applyEditorCommand(document, command, now);
  const historyCommand: EditorCommand<EditorCoreCommand> = {
    id: options.commandId ?? `${command.kind}:${ts}`,
    kind: command.kind,
    payload: command,
    ts,
    checkpoint: options.checkpoint ?? nextDocument,
  };
  return {
    document: nextDocument,
    history: pushHistoryCommand(history, historyCommand),
    command: historyCommand,
  };
}

function applyEditorCommandUnchecked(
  document: ViskitEditorDocument,
  command: EditorCoreCommand,
  now: string
): ViskitEditorDocument {
  switch (command.kind) {
    case 'layer.add':
      return insertAndMaybeSelect(document, command.layer, command.index, command.select, now);
    case 'layer.remove':
      return {
        ...document,
        layers: removeLayer(document.layers, command.layerId),
        selectedLayerIds: document.selectedLayerIds.filter(
          (layerId) => layerId !== command.layerId
        ),
        updatedAt: now,
      };
    case 'layer.update':
      return {
        ...document,
        layers: updateLayer(document.layers, command.layerId, command.patch, now),
      };
    case 'layer.transform':
      return transformLayer(document, command.layerId, command.transform, now);
    case 'layer.reorder':
      return {
        ...document,
        layers: reorderLayer(document.layers, command.layerId, command.toIndex),
      };
    case 'layer.select':
      return selectLayers(document, command.layerIds, now);
    case 'shape.add':
      return insertAndMaybeSelect(
        document,
        createVectorShapeLayer({ ...command.layer, now }),
        command.index,
        command.select,
        now
      );
    case 'paint.layer.add':
      return insertAndMaybeSelect(
        document,
        createPaintLayer({ ...command.layer, now }),
        command.index,
        command.select,
        now
      );
    case 'paint.stroke.add':
      return {
        ...document,
        layers: addPaintStroke(document.layers, command.layerId, command.stroke, now),
      };
    case 'filter.apply':
      return {
        ...document,
        layers: applyLayerFilter(document.layers, command.layerId, command.filter, now),
      };
    case 'selection.set':
      return { ...document, selection: normalizeSelection(command.selection), updatedAt: now };
    case 'selection.mask.add': {
      const mask = createMaskLayer({
        ...command.layer,
        purpose: command.layer.purpose ?? 'selection',
        now,
      });
      return insertAndMaybeSelect(document, mask, command.index, command.select, now);
    }
    case 'document.resize':
      return resizeDocument(
        document,
        command.width,
        command.height,
        command.scaleLayers ?? true,
        now
      );
    case 'document.crop':
      return cropDocument(document, command.crop, now);
    case 'document.rotate':
      return rotateDocument(document, command.degrees, now);
    case 'document.flip':
      return flipDocument(document, command.axis, command.layerIds, now);
    case 'tool.change':
      return {
        ...document,
        toolState: {
          activeToolId: command.toolId,
          enabledToolGroups: command.enabledToolGroups ?? document.toolState.enabledToolGroups,
        },
        updatedAt: now,
      };
    case 'export.checkpoint':
      return {
        ...document,
        history: {
          checkpoints: [
            ...document.history.checkpoints,
            {
              commandId: command.commandId,
              documentHash: command.documentHash,
              savedAt: command.savedAt ?? now,
            },
          ],
          savedCommandId: command.commandId,
        },
        updatedAt: now,
      };
    default:
      return assertNever(command);
  }
}

function insertAndMaybeSelect(
  document: ViskitEditorDocument,
  layer: EditorLayer,
  index: number | undefined,
  select: boolean | undefined,
  now: string
): ViskitEditorDocument {
  return {
    ...document,
    layers: insertLayer(document.layers, layer, index),
    selectedLayerIds: select ? [layer.id] : document.selectedLayerIds,
    updatedAt: now,
  };
}

function transformLayer(
  document: ViskitEditorDocument,
  layerId: string,
  transform: Partial<EditorTransform>,
  now: string
): ViskitEditorDocument {
  const layer = document.layers.find((candidate) => candidate.id === layerId);
  if (!layer) throw new Error(`Layer not found: ${layerId}`);
  const nextTransform = normalizeTransform({ ...layer.transform, ...transform });
  return withUpdatedLayer(document, layerId, { transform: nextTransform }, now);
}

function resizeDocument(
  document: ViskitEditorDocument,
  width: number,
  height: number,
  scaleLayers: boolean,
  now: string
): ViskitEditorDocument {
  assertPositiveFinite(width, 'width');
  assertPositiveFinite(height, 'height');
  const scaleX = width / document.canvas.width;
  const scaleY = height / document.canvas.height;
  return {
    ...document,
    canvas: { width, height },
    layers: scaleLayers
      ? document.layers.map((layer) => ({
          ...layer,
          transform: normalizeTransform({
            ...layer.transform,
            x: layer.transform.x * scaleX,
            y: layer.transform.y * scaleY,
            width: layer.transform.width * scaleX,
            height: layer.transform.height * scaleY,
          }),
          updatedAt: now,
        }))
      : document.layers,
    updatedAt: now,
  };
}

function cropDocument(
  document: ViskitEditorDocument,
  crop: EditorSelectionBounds,
  now: string
): ViskitEditorDocument {
  assertPositiveFinite(crop.width, 'crop.width');
  assertPositiveFinite(crop.height, 'crop.height');
  return {
    ...document,
    canvas: { width: crop.width, height: crop.height },
    layers: document.layers.map((layer) => ({
      ...layer,
      transform: normalizeTransform({
        ...layer.transform,
        x: layer.transform.x - crop.x,
        y: layer.transform.y - crop.y,
      }),
      updatedAt: now,
    })),
    selection: null,
    updatedAt: now,
  };
}

function rotateDocument(
  document: ViskitEditorDocument,
  degrees: 90 | -90 | 180 | 270 | -270,
  now: string
): ViskitEditorDocument {
  const quarterTurns = normalizeQuarterTurns(degrees);
  const canvas =
    quarterTurns % 2 === 0
      ? document.canvas
      : { width: document.canvas.height, height: document.canvas.width };
  return {
    ...document,
    canvas,
    layers: document.layers.map((layer) => ({
      ...layer,
      transform: rotateTransform(
        layer.transform,
        document.canvas.width,
        document.canvas.height,
        quarterTurns
      ),
      updatedAt: now,
    })),
    selection: null,
    updatedAt: now,
  };
}

function flipDocument(
  document: ViskitEditorDocument,
  axis: 'horizontal' | 'vertical',
  layerIds: string[] | undefined,
  now: string
): ViskitEditorDocument {
  const targetIds = layerIds ? new Set(layerIds) : null;
  return {
    ...document,
    layers: document.layers.map((layer) => {
      if (targetIds && !targetIds.has(layer.id)) return layer;
      return {
        ...layer,
        transform: flipTransform(
          layer.transform,
          document.canvas.width,
          document.canvas.height,
          axis
        ),
        updatedAt: now,
      };
    }),
    updatedAt: now,
  };
}

function rotateTransform(
  transform: EditorTransform,
  canvasWidth: number,
  canvasHeight: number,
  quarterTurns: 0 | 1 | 2 | 3
): EditorTransform {
  if (quarterTurns === 0) return normalizeTransform(transform);
  const { x, y, width, height } = transform;
  if (quarterTurns === 1) {
    return normalizeTransform({
      ...transform,
      x: canvasHeight - (y + height),
      y: x,
      width: height,
      height: width,
      rotation: transform.rotation + 90,
    });
  }
  if (quarterTurns === 2) {
    return normalizeTransform({
      ...transform,
      x: canvasWidth - (x + width),
      y: canvasHeight - (y + height),
      rotation: transform.rotation + 180,
    });
  }
  return normalizeTransform({
    ...transform,
    x: y,
    y: canvasWidth - (x + width),
    width: height,
    height: width,
    rotation: transform.rotation + 270,
  });
}

function flipTransform(
  transform: EditorTransform,
  canvasWidth: number,
  canvasHeight: number,
  axis: 'horizontal' | 'vertical'
): EditorTransform {
  if (axis === 'horizontal') {
    return normalizeTransform({
      ...transform,
      x: canvasWidth - (transform.x + transform.width),
      scaleX: -transform.scaleX,
    });
  }
  return normalizeTransform({
    ...transform,
    y: canvasHeight - (transform.y + transform.height),
    scaleY: -transform.scaleY,
  });
}

function normalizeSelection(selection: EditorSelectionState | null): EditorSelectionState | null {
  if (!selection || selection.shape.kind === 'none') return null;
  assertPositiveFinite(selection.shape.bounds.width, 'selection.width');
  assertPositiveFinite(selection.shape.bounds.height, 'selection.height');
  return {
    ...selection,
    feather: Math.max(0, selection.feather),
  };
}

function normalizeTransform(transform: EditorTransform): EditorTransform {
  assertPositiveFinite(transform.width, 'transform.width');
  assertPositiveFinite(transform.height, 'transform.height');
  for (const [key, value] of Object.entries(transform)) {
    if (!Number.isFinite(value)) throw new Error(`transform.${key} must be finite`);
  }
  return {
    ...transform,
    rotation: normalizeDegrees(transform.rotation),
  };
}

function normalizeQuarterTurns(degrees: 90 | -90 | 180 | 270 | -270): 0 | 1 | 2 | 3 {
  const normalized = normalizeDegrees(degrees);
  if (normalized === 90) return 1;
  if (normalized === 180) return 2;
  if (normalized === 270) return 3;
  return 0;
}

function normalizeDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

function assertPositiveFinite(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive number`);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled editor command: ${JSON.stringify(value)}`);
}
