import type { ViskitEditorDocument } from '../document';
import type { EditorLayer } from '../layers';

export interface FabricObjectDescriptor {
  layerId: string;
  type: 'textbox' | 'image' | 'rect' | 'ellipse' | 'line' | 'path' | 'mask';
  visible: boolean;
  selectable: boolean;
  opacity: number;
  props: Record<string, string | number | boolean | null>;
}

export interface FabricAdapterState {
  width: number;
  height: number;
  backgroundImageUrl?: string;
  backgroundFilters?: string;
  objects: FabricObjectDescriptor[];
  selectedLayerIds: string[];
}

export function toFabricAdapterState(document: ViskitEditorDocument): FabricAdapterState {
  const background = document.layers.find((layer) => layer.kind === 'base-image');
  return {
    width: document.canvas.width,
    height: document.canvas.height,
    backgroundImageUrl: background?.kind === 'base-image' ? background.imageUrl : undefined,
    backgroundFilters:
      background?.kind === 'base-image' && background.filters
        ? JSON.stringify(background.filters)
        : undefined,
    objects: document.layers.flatMap(layerToFabricDescriptor),
    selectedLayerIds: document.selectedLayerIds,
  };
}

function layerToFabricDescriptor(layer: EditorLayer): FabricObjectDescriptor[] {
  if (layer.kind === 'base-image') return [];
  const base = {
    layerId: layer.id,
    visible: layer.visible,
    selectable: !layer.locked,
    opacity: layer.opacity,
  };
  const transform = {
    left: layer.transform.x,
    top: layer.transform.y,
    width: layer.transform.width,
    height: layer.transform.height,
    angle: layer.transform.rotation,
    scaleX: layer.transform.scaleX,
    scaleY: layer.transform.scaleY,
  };
  switch (layer.kind) {
    case 'ocr-text':
      return [
        {
          ...base,
          type: 'textbox',
          props: {
            ...transform,
            text: layer.text,
            fontFamily: layer.fontFamily,
            fontSize: layer.fontSize,
            fill: layer.fill,
            backgroundColor: layer.backgroundColor ?? null,
          },
        },
      ];
    case 'raster':
      return [
        {
          ...base,
          type: 'image',
          props: {
            ...transform,
            src: layer.imageUrl,
            filterCount: layer.filters?.length ?? 0,
            filters: layer.filters ? JSON.stringify(layer.filters) : null,
          },
        },
      ];
    case 'vector-shape':
      return [
        {
          ...base,
          type: vectorShapeToFabricType(layer.shape),
          props: {
            ...transform,
            shape: layer.shape,
            stroke: layer.stroke,
            strokeWidth: layer.strokeWidth,
            fill: layer.fill ?? null,
            points: layer.points ? JSON.stringify(layer.points) : null,
          },
        },
      ];
    case 'paint':
      return [
        {
          ...base,
          type: 'path',
          props: { ...transform, strokeCount: layer.strokes.length },
        },
      ];
    case 'mask':
      return [
        {
          ...base,
          type: 'mask',
          props: {
            left: layer.maskBox.x,
            top: layer.maskBox.y,
            width: layer.maskBox.w,
            height: layer.maskBox.h,
            purpose: layer.purpose,
          },
        },
      ];
    default:
      return [];
  }
}

function vectorShapeToFabricType(
  shape: Extract<EditorLayer, { kind: 'vector-shape' }>['shape']
): FabricObjectDescriptor['type'] {
  if (shape === 'ellipse') return 'ellipse';
  if (shape === 'line' || shape === 'arrow') return 'line';
  if (shape === 'pen' || shape === 'polygon') return 'path';
  return 'rect';
}
