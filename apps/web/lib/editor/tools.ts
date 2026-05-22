import type { EditorLayerKind } from './layers';

export type EditorToolGroup =
  | 'select'
  | 'text'
  | 'transform'
  | 'draw'
  | 'selection'
  | 'shape'
  | 'filter'
  | 'ai'
  | 'export';

export type HistorySemantics = 'none' | 'checkpoint' | 'command' | 'streaming-command';

export interface EditorToolDefinition {
  id: string;
  group: EditorToolGroup;
  labelKey: string;
  iconToken: string;
  cursor: string;
  inputMode: 'pointer' | 'text' | 'brush' | 'region' | 'none';
  shortcut?: string;
  layerCompatibility: EditorLayerKind[] | 'any';
  history: HistorySemantics;
  optionPanel: 'none' | 'text' | 'inpaint' | 'transform' | 'filter' | 'layers';
  testId: string;
}

export interface EditorToolConfig {
  enabledGroups?: EditorToolGroup[];
  enabledToolIds?: string[];
  defaultToolId?: string;
}

export const EDITOR_TOOL_REGISTRY = [
  {
    id: 'select',
    group: 'select',
    labelKey: 'editor.tools.select',
    iconToken: 'mouse-pointer',
    cursor: 'default',
    inputMode: 'pointer',
    shortcut: 'V',
    layerCompatibility: 'any',
    history: 'none',
    optionPanel: 'none',
    testId: 'tool-select',
  },
  {
    id: 'move',
    group: 'select',
    labelKey: 'editor.tools.move',
    iconToken: 'move',
    cursor: 'move',
    inputMode: 'pointer',
    shortcut: 'M',
    layerCompatibility: 'any',
    history: 'command',
    optionPanel: 'layers',
    testId: 'tool-move',
  },
  {
    id: 'text',
    group: 'text',
    labelKey: 'editor.tools.text',
    iconToken: 'type',
    cursor: 'text',
    inputMode: 'text',
    shortcut: 'T',
    layerCompatibility: ['ocr-text', 'vector-shape', 'raster', 'base-image'],
    history: 'command',
    optionPanel: 'text',
    testId: 'tool-text',
  },

  {
    id: 'crop',
    group: 'transform',
    labelKey: 'editor.tools.crop',
    iconToken: 'crop',
    cursor: 'crosshair',
    inputMode: 'region',
    shortcut: 'C',
    layerCompatibility: 'any',
    history: 'command',
    optionPanel: 'transform',
    testId: 'tool-crop',
  },
  {
    id: 'resize',
    group: 'transform',
    labelKey: 'editor.tools.resize',
    iconToken: 'maximize',
    cursor: 'nwse-resize',
    inputMode: 'pointer',
    shortcut: 'R',
    layerCompatibility: 'any',
    history: 'command',
    optionPanel: 'transform',
    testId: 'tool-resize',
  },
  {
    id: 'rotate',
    group: 'transform',
    labelKey: 'editor.tools.rotate',
    iconToken: 'rotate-cw',
    cursor: 'grab',
    inputMode: 'pointer',
    layerCompatibility: 'any',
    history: 'command',
    optionPanel: 'transform',
    testId: 'tool-rotate',
  },
  {
    id: 'flip',
    group: 'transform',
    labelKey: 'editor.tools.flip',
    iconToken: 'flip-horizontal',
    cursor: 'pointer',
    inputMode: 'none',
    layerCompatibility: 'any',
    history: 'command',
    optionPanel: 'transform',
    testId: 'tool-flip',
  },
  {
    id: 'shape-rect',
    group: 'shape',
    labelKey: 'editor.tools.shapeRect',
    iconToken: 'square',
    cursor: 'crosshair',
    inputMode: 'region',
    shortcut: 'U',
    layerCompatibility: ['vector-shape'],
    history: 'command',
    optionPanel: 'layers',
    testId: 'tool-shape-rect',
  },
  {
    id: 'shape-ellipse',
    group: 'shape',
    labelKey: 'editor.tools.shapeEllipse',
    iconToken: 'circle',
    cursor: 'crosshair',
    inputMode: 'region',
    layerCompatibility: ['vector-shape'],
    history: 'command',
    optionPanel: 'layers',
    testId: 'tool-shape-ellipse',
  },
  {
    id: 'brush',
    group: 'draw',
    labelKey: 'editor.tools.brush',
    iconToken: 'brush',
    cursor: 'crosshair',
    inputMode: 'brush',
    shortcut: 'B',
    layerCompatibility: ['paint', 'raster', 'base-image'],
    history: 'streaming-command',
    optionPanel: 'layers',
    testId: 'tool-brush',
  },
  {
    id: 'selection-rect',
    group: 'selection',
    labelKey: 'editor.tools.selectionRect',
    iconToken: 'scan',
    cursor: 'crosshair',
    inputMode: 'region',
    layerCompatibility: 'any',
    history: 'command',
    optionPanel: 'layers',
    testId: 'tool-selection-rect',
  },
  {
    id: 'filter-adjust',
    group: 'filter',
    labelKey: 'editor.tools.filterAdjust',
    iconToken: 'sliders-horizontal',
    cursor: 'default',
    inputMode: 'none',
    shortcut: 'F',
    layerCompatibility: ['base-image', 'raster'],
    history: 'command',
    optionPanel: 'filter',
    testId: 'tool-filter-adjust',
  },
  {
    id: 'inpaint',
    group: 'ai',
    labelKey: 'editor.tools.inpaint',
    iconToken: 'wand',
    cursor: 'crosshair',
    inputMode: 'region',
    shortcut: 'I',
    layerCompatibility: ['base-image', 'raster', 'mask'],
    history: 'streaming-command',
    optionPanel: 'inpaint',
    testId: 'tool-inpaint',
  },
] as const satisfies readonly EditorToolDefinition[];

export type RegisteredToolId = (typeof EDITOR_TOOL_REGISTRY)[number]['id'];

export function getToolById(toolId: string, registry = EDITOR_TOOL_REGISTRY) {
  return registry.find((tool) => tool.id === toolId) ?? null;
}

export function assertValidToolRegistry(registry: readonly EditorToolDefinition[]) {
  const seen = new Set<string>();
  for (const tool of registry) {
    if (seen.has(tool.id)) throw new Error(`Duplicate tool id: ${tool.id}`);
    seen.add(tool.id);
    if (!tool.labelKey) throw new Error(`Tool ${tool.id} is missing labelKey`);
    if (!tool.iconToken) throw new Error(`Tool ${tool.id} is missing iconToken`);
    if (!tool.testId) throw new Error(`Tool ${tool.id} is missing testId`);
  }
}

export function resolveEnabledTools(
  config: EditorToolConfig = {},
  registry: readonly EditorToolDefinition[] = EDITOR_TOOL_REGISTRY
) {
  assertValidToolRegistry(registry);
  const enabledGroups = config.enabledGroups ? new Set(config.enabledGroups) : null;
  const enabledToolIds = config.enabledToolIds ? new Set(config.enabledToolIds) : null;
  return registry.filter((tool) => {
    if (enabledGroups && !enabledGroups.has(tool.group)) return false;
    if (enabledToolIds && !enabledToolIds.has(tool.id)) return false;
    return true;
  });
}

export function resolveDefaultTool(config: EditorToolConfig = {}, registry = EDITOR_TOOL_REGISTRY) {
  const enabledTools = resolveEnabledTools(config, registry);
  const configured = config.defaultToolId
    ? enabledTools.find((tool) => tool.id === config.defaultToolId)
    : null;
  return configured ?? enabledTools[0] ?? null;
}

export function canToolTargetLayer(tool: EditorToolDefinition, layerKind: EditorLayerKind) {
  return tool.layerCompatibility === 'any' || tool.layerCompatibility.includes(layerKind);
}
