export type EditorLayerKind =
  | 'base-image'
  | 'raster'
  | 'ocr-text'
  | 'vector-shape'
  | 'paint'
  | 'mask';

export interface EditorPoint {
  x: number;
  y: number;
}

export interface EditorTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

export type EditorFilterKind =
  | 'brightness'
  | 'contrast'
  | 'saturation'
  | 'hue'
  | 'warmth'
  | 'grayscale'
  | 'negative'
  | 'blur'
  | 'sharpen'
  | 'desaturate';

export interface EditorLayerFilter {
  id: string;
  kind: EditorFilterKind;
  amount: number;
}

export interface EditorLayerBase {
  id: string;
  kind: EditorLayerKind;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  transform: EditorTransform;
  blendMode?: 'normal' | 'multiply' | 'screen' | 'overlay';
  source?: 'viskit' | 'ocr' | 'import' | 'user' | 'ai';
  createdAt: string;
  updatedAt: string;
}

export interface BaseImageLayer extends EditorLayerBase {
  kind: 'base-image';
  imageUrl: string;
  imageId: string;
  filters?: EditorLayerFilter[];
}

export interface RasterLayer extends EditorLayerBase {
  kind: 'raster';
  imageUrl: string;
  mimeType?: 'image/png' | 'image/jpeg' | 'image/webp';
  filters?: EditorLayerFilter[];
}

export interface OcrTextLayer extends EditorLayerBase {
  kind: 'ocr-text';
  text: string;
  ocrIndex?: number;
  fontFamily: string;
  fontSize: number;
  fill: string;
  backgroundColor?: string;
}

export interface VectorShapeLayer extends EditorLayerBase {
  kind: 'vector-shape';
  shape: 'rect' | 'ellipse' | 'polygon' | 'line' | 'arrow' | 'pen';
  stroke: string;
  strokeWidth: number;
  fill?: string;
  points?: EditorPoint[];
}

export interface PaintLayer extends EditorLayerBase {
  kind: 'paint';
  strokes: Array<{
    id: string;
    points: EditorPoint[];
    color: string;
    width: number;
    tool: 'brush' | 'pencil' | 'eraser';
  }>;
}

export interface MaskLayer extends EditorLayerBase {
  kind: 'mask';
  purpose: 'inpaint' | 'selection';
  maskBox: { x: number; y: number; w: number; h: number };
}

export type EditorLayer =
  | BaseImageLayer
  | RasterLayer
  | OcrTextLayer
  | VectorShapeLayer
  | PaintLayer
  | MaskLayer;

export type LayerPatch = Partial<
  Pick<EditorLayerBase, 'name' | 'visible' | 'locked' | 'opacity' | 'transform' | 'blendMode'>
>;

export type RasterLayerPatch = LayerPatch & { filters?: EditorLayerFilter[] };

export function createDefaultTransform(width: number, height: number): EditorTransform {
  assertPositiveFinite(width, 'width');
  assertPositiveFinite(height, 'height');
  return { x: 0, y: 0, width, height, rotation: 0, scaleX: 1, scaleY: 1 };
}

export function normalizeOpacity(opacity: number): number {
  if (!Number.isFinite(opacity)) return 1;
  return Math.max(0, Math.min(1, opacity));
}

export function createBaseImageLayer(input: {
  id?: string;
  imageId: string;
  imageUrl: string;
  width: number;
  height: number;
  now?: string;
}): BaseImageLayer {
  const now = input.now ?? new Date().toISOString();
  return {
    id: input.id ?? 'layer:base-image',
    kind: 'base-image',
    name: 'Base image',
    visible: true,
    locked: true,
    opacity: 1,
    transform: createDefaultTransform(input.width, input.height),
    source: 'viskit',
    createdAt: now,
    updatedAt: now,
    imageId: input.imageId,
    imageUrl: input.imageUrl,
  };
}

export function createRasterLayer(input: {
  id: string;
  name?: string;
  imageUrl: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
  mimeType?: RasterLayer['mimeType'];
  now?: string;
}): RasterLayer {
  const now = input.now ?? new Date().toISOString();
  return {
    id: input.id,
    kind: 'raster',
    name: input.name ?? 'Raster layer',
    visible: true,
    locked: false,
    opacity: 1,
    transform: {
      ...createDefaultTransform(input.width, input.height),
      x: input.x ?? 0,
      y: input.y ?? 0,
    },
    source: 'import',
    createdAt: now,
    updatedAt: now,
    imageUrl: input.imageUrl,
    mimeType: input.mimeType,
  };
}

export function createOcrTextLayer(input: {
  id: string;
  name?: string;
  text: string;
  ocrIndex?: number;
  box: { x: number; y: number; w: number; h: number };
  now?: string;
}): OcrTextLayer {
  const now = input.now ?? new Date().toISOString();
  return {
    id: input.id,
    kind: 'ocr-text',
    name: input.name ?? `OCR text ${input.ocrIndex ?? ''}`.trim(),
    visible: true,
    locked: false,
    opacity: 1,
    transform: {
      x: input.box.x,
      y: input.box.y,
      width: input.box.w,
      height: input.box.h,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    },
    source: 'ocr',
    createdAt: now,
    updatedAt: now,
    text: input.text,
    ocrIndex: input.ocrIndex,
    fontFamily: 'Inter, PingFang SC, Noto Sans SC, sans-serif',
    fontSize: Math.max(18, Math.min(72, input.box.h * 0.9)),
    fill: '#f0e8dd',
    backgroundColor: 'rgba(11, 11, 14, 0.54)',
  };
}

export function createVectorShapeLayer(input: {
  id: string;
  name?: string;
  shape: VectorShapeLayer['shape'];
  bounds: { x: number; y: number; width: number; height: number };
  stroke?: string;
  strokeWidth?: number;
  fill?: string;
  points?: EditorPoint[];
  now?: string;
}): VectorShapeLayer {
  const now = input.now ?? new Date().toISOString();
  return {
    id: input.id,
    kind: 'vector-shape',
    name: input.name ?? `${input.shape} shape`,
    visible: true,
    locked: false,
    opacity: 1,
    transform: {
      x: input.bounds.x,
      y: input.bounds.y,
      width: input.bounds.width,
      height: input.bounds.height,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    },
    source: 'user',
    createdAt: now,
    updatedAt: now,
    shape: input.shape,
    stroke: input.stroke ?? '#ffffff',
    strokeWidth: input.strokeWidth ?? 2,
    fill: input.fill,
    points: input.points,
  };
}

export function createPaintLayer(input: {
  id: string;
  name?: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
  strokes?: PaintLayer['strokes'];
  now?: string;
}): PaintLayer {
  const now = input.now ?? new Date().toISOString();
  return {
    id: input.id,
    kind: 'paint',
    name: input.name ?? 'Paint layer',
    visible: true,
    locked: false,
    opacity: 1,
    transform: {
      ...createDefaultTransform(input.width, input.height),
      x: input.x ?? 0,
      y: input.y ?? 0,
    },
    source: 'user',
    createdAt: now,
    updatedAt: now,
    strokes: input.strokes ?? [],
  };
}

export function createMaskLayer(input: {
  id: string;
  name?: string;
  purpose: MaskLayer['purpose'];
  maskBox: MaskLayer['maskBox'];
  now?: string;
}): MaskLayer {
  const now = input.now ?? new Date().toISOString();
  return {
    id: input.id,
    kind: 'mask',
    name: input.name ?? `${input.purpose} mask`,
    visible: true,
    locked: false,
    opacity: 0.45,
    transform: {
      x: input.maskBox.x,
      y: input.maskBox.y,
      width: input.maskBox.w,
      height: input.maskBox.h,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    },
    source: input.purpose === 'inpaint' ? 'ai' : 'user',
    createdAt: now,
    updatedAt: now,
    purpose: input.purpose,
    maskBox: input.maskBox,
  };
}

export function insertLayer(layers: EditorLayer[], layer: EditorLayer, index = layers.length) {
  assertUniqueLayerId(layers, layer.id);
  const next = [...layers];
  const safeIndex = Math.max(0, Math.min(index, next.length));
  next.splice(safeIndex, 0, layer);
  return next;
}

export function removeLayer(layers: EditorLayer[], layerId: string) {
  const next = layers.filter((layer) => layer.id !== layerId);
  if (next.length === layers.length) throw new Error(`Layer not found: ${layerId}`);
  return next;
}

export function updateLayer(
  layers: EditorLayer[],
  layerId: string,
  patch: RasterLayerPatch,
  now?: string
) {
  let found = false;
  const updatedAt = now ?? new Date().toISOString();
  const next = layers.map((layer) => {
    if (layer.id !== layerId) return layer;
    found = true;
    return {
      ...layer,
      ...patch,
      opacity: patch.opacity === undefined ? layer.opacity : normalizeOpacity(patch.opacity),
      updatedAt,
    } as EditorLayer;
  });
  if (!found) throw new Error(`Layer not found: ${layerId}`);
  return next;
}

export function duplicateLayer(
  layers: EditorLayer[],
  layerId: string,
  newId: string,
  now?: string
) {
  assertUniqueLayerId(layers, newId);
  const index = layers.findIndex((layer) => layer.id === layerId);
  if (index === -1) throw new Error(`Layer not found: ${layerId}`);
  const source = layers[index];
  const timestamp = now ?? new Date().toISOString();
  const copy = {
    ...structuredClone(source),
    id: newId,
    name: `${source.name} copy`,
    locked: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  } as EditorLayer;
  return insertLayer(layers, copy, index + 1);
}

export function addPaintStroke(
  layers: EditorLayer[],
  layerId: string,
  stroke: PaintLayer['strokes'][number],
  now?: string
) {
  const target = layers.find((layer) => layer.id === layerId);
  if (!target) throw new Error(`Layer not found: ${layerId}`);
  if (target.kind !== 'paint') throw new Error(`Layer is not paint: ${layerId}`);
  const updatedAt = now ?? new Date().toISOString();
  return layers.map((layer) =>
    layer.id === layerId && layer.kind === 'paint'
      ? { ...layer, strokes: [...layer.strokes, stroke], updatedAt }
      : layer
  );
}

export function applyLayerFilter(
  layers: EditorLayer[],
  layerId: string,
  filter: EditorLayerFilter,
  now?: string
) {
  const target = layers.find((layer) => layer.id === layerId);
  if (!target) throw new Error(`Layer not found: ${layerId}`);
  if (target.kind !== 'base-image' && target.kind !== 'raster') {
    throw new Error(`Layer cannot receive filters: ${layerId}`);
  }
  const filters = [
    ...(target.filters ?? []).filter((existing) => existing.id !== filter.id),
    filter,
  ];
  return updateLayer(layers, layerId, { filters }, now);
}

export function reorderLayer(layers: EditorLayer[], layerId: string, toIndex: number) {
  const fromIndex = layers.findIndex((layer) => layer.id === layerId);
  if (fromIndex === -1) throw new Error(`Layer not found: ${layerId}`);
  const next = [...layers];
  const [layer] = next.splice(fromIndex, 1);
  const safeIndex = Math.max(0, Math.min(toIndex, next.length));
  next.splice(safeIndex, 0, layer);
  return next;
}

export function validateLayer(layer: EditorLayer): string[] {
  const errors: string[] = [];
  if (!layer.id) errors.push('layer.id is required');
  if (!layer.name) errors.push(`layer.name is required for ${layer.id}`);
  if (!layer.transform) {
    errors.push(`layer.transform is required for ${layer.id}`);
  } else {
    for (const [key, value] of Object.entries(layer.transform)) {
      if (!Number.isFinite(value))
        errors.push(`layer.transform.${key} must be finite for ${layer.id}`);
    }
    if (layer.transform.width <= 0 || layer.transform.height <= 0) {
      errors.push(`layer.transform dimensions must be positive for ${layer.id}`);
    }
  }
  if (layer.opacity < 0 || layer.opacity > 1) {
    errors.push(`layer.opacity out of range for ${layer.id}`);
  }
  if (layer.kind === 'ocr-text' && layer.text.length === 0) {
    errors.push(`ocr-text layer text is required for ${layer.id}`);
  }
  if (layer.kind === 'base-image' && !layer.imageId) {
    errors.push(`base-image layer imageId is required for ${layer.id}`);
  }
  if (layer.kind === 'paint') {
    for (const stroke of layer.strokes) {
      if (!stroke.id) errors.push(`paint stroke id is required for ${layer.id}`);
      if (stroke.points.length === 0)
        errors.push(`paint stroke points are required for ${layer.id}`);
      if (stroke.width <= 0) errors.push(`paint stroke width must be positive for ${layer.id}`);
    }
  }
  if (layer.kind === 'vector-shape' && layer.strokeWidth <= 0) {
    errors.push(`vector-shape strokeWidth must be positive for ${layer.id}`);
  }
  return errors;
}

export function assertUniqueLayerIds(layers: EditorLayer[]) {
  const seen = new Set<string>();
  for (const layer of layers) {
    if (seen.has(layer.id)) throw new Error(`Duplicate layer id: ${layer.id}`);
    seen.add(layer.id);
  }
}

function assertUniqueLayerId(layers: EditorLayer[], layerId: string) {
  if (layers.some((layer) => layer.id === layerId))
    throw new Error(`Duplicate layer id: ${layerId}`);
}

function assertPositiveFinite(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive number`);
}
