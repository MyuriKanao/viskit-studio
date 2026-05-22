import type { EditorSelectionState } from './commands';
import {
  type EditorLayer,
  assertUniqueLayerIds,
  createBaseImageLayer,
  removeLayer,
  updateLayer,
  validateLayer,
} from './layers';

export const EDITOR_DOCUMENT_VERSION = 1;

export type ViskitSourceKind = 'kit-slot' | 'asset' | 'external' | 'project';

export interface EditorCanvasSize {
  width: number;
  height: number;
}

export interface ViskitSourceMetadata {
  imageId: string;
  kind: ViskitSourceKind;
  imageUrl: string;
  originalWidth?: number;
  originalHeight?: number;
}

export interface EditorExportSettings {
  format: 'png' | 'jpeg' | 'webp';
  quality: number;
  includeProjectJson: boolean;
}

export interface EditorToolState {
  activeToolId: string;
  enabledToolGroups: string[];
}

export interface EditorHistoryCheckpoint {
  commandId: string;
  documentHash?: string;
  savedAt?: string;
}

export interface ViskitEditorDocument {
  schema: 'viskit-editor-document';
  version: typeof EDITOR_DOCUMENT_VERSION;
  id: string;
  canvas: EditorCanvasSize;
  source: ViskitSourceMetadata;
  layers: EditorLayer[];
  selectedLayerIds: string[];
  toolState: EditorToolState;
  exportSettings: EditorExportSettings;
  history: {
    checkpoints: EditorHistoryCheckpoint[];
    savedCommandId?: string;
  };
  selection?: EditorSelectionState | null;
  createdAt: string;
  updatedAt: string;
}

export function inferSourceKind(imageId: string): ViskitSourceKind {
  if (imageId.startsWith('kit-slot:')) return 'kit-slot';
  if (imageId.startsWith('asset:')) return 'asset';
  return 'external';
}

export function createEditorDocument(input: {
  id?: string;
  imageId: string;
  imageUrl: string;
  width: number;
  height: number;
  now?: string;
}): ViskitEditorDocument {
  const now = input.now ?? new Date().toISOString();
  const source = {
    imageId: input.imageId,
    kind: inferSourceKind(input.imageId),
    imageUrl: input.imageUrl,
    originalWidth: input.width,
    originalHeight: input.height,
  };
  return {
    schema: 'viskit-editor-document',
    version: EDITOR_DOCUMENT_VERSION,
    id: input.id ?? `doc:${input.imageId}`,
    canvas: { width: input.width, height: input.height },
    source,
    layers: [
      createBaseImageLayer({
        imageId: input.imageId,
        imageUrl: input.imageUrl,
        width: input.width,
        height: input.height,
        now,
      }),
    ],
    selectedLayerIds: ['layer:base-image'],
    toolState: {
      activeToolId: 'select',
      enabledToolGroups: ['select', 'text', 'ai'],
    },
    exportSettings: { format: 'png', quality: 0.92, includeProjectJson: true },
    history: { checkpoints: [] },
    selection: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function selectLayers(
  document: ViskitEditorDocument,
  layerIds: string[],
  now = new Date().toISOString()
) {
  const existing = new Set(document.layers.map((layer) => layer.id));
  const selectedLayerIds = layerIds.filter((layerId) => existing.has(layerId));
  return { ...document, selectedLayerIds, updatedAt: now };
}

export function withUpdatedLayer(
  document: ViskitEditorDocument,
  layerId: string,
  patch: Parameters<typeof updateLayer>[2],
  now = new Date().toISOString()
): ViskitEditorDocument {
  return {
    ...document,
    layers: updateLayer(document.layers, layerId, patch, now),
    updatedAt: now,
  };
}

export function withoutLayer(
  document: ViskitEditorDocument,
  layerId: string,
  now = new Date().toISOString()
): ViskitEditorDocument {
  const layers = removeLayer(document.layers, layerId);
  const selectedLayerIds = document.selectedLayerIds.filter((selected) => selected !== layerId);
  return { ...document, layers, selectedLayerIds, updatedAt: now };
}

export function validateEditorDocument(document: ViskitEditorDocument): string[] {
  const errors: string[] = [];
  if (document.schema !== 'viskit-editor-document') errors.push('document.schema is invalid');
  if (document.version !== EDITOR_DOCUMENT_VERSION) {
    errors.push(`document.version ${document.version} is unsupported`);
  }
  if (!Number.isFinite(document.canvas.width) || document.canvas.width <= 0) {
    errors.push('document.canvas.width must be positive');
  }
  if (!Number.isFinite(document.canvas.height) || document.canvas.height <= 0) {
    errors.push('document.canvas.height must be positive');
  }
  if (!document.source.imageId) errors.push('document.source.imageId is required');
  if (!document.source.imageUrl) errors.push('document.source.imageUrl is required');
  try {
    assertUniqueLayerIds(document.layers);
  } catch (error) {
    errors.push((error as Error).message);
  }
  for (const layer of document.layers) {
    errors.push(...validateLayer(layer));
  }
  const layerIds = new Set(document.layers.map((layer) => layer.id));
  for (const selectedLayerId of document.selectedLayerIds) {
    if (!layerIds.has(selectedLayerId)) errors.push(`selected layer not found: ${selectedLayerId}`);
  }
  if (document.exportSettings.quality < 0 || document.exportSettings.quality > 1) {
    errors.push('document.exportSettings.quality must be between 0 and 1');
  }
  return errors;
}

export function assertValidEditorDocument(document: ViskitEditorDocument): ViskitEditorDocument {
  const errors = validateEditorDocument(document);
  if (errors.length > 0) throw new Error(errors.join('; '));
  return document;
}
