import assert from 'node:assert/strict';
import test from 'node:test';

import { toFabricAdapterState } from './adapters/fabric';
import { applyEditorCommand, applyEditorCommandWithHistory } from './commands';
import { createEditorDocument, selectLayers, validateEditorDocument } from './document';
import {
  createEditorHistory,
  isHistoryDirty,
  jumpHistory,
  markHistorySaved,
  pushHistoryCommand,
  redoHistory,
  undoHistory,
} from './history';
import { createOcrTextLayer, duplicateLayer, insertLayer, reorderLayer } from './layers';
import {
  createSerializedEditorProject,
  deserializeEditorDocument,
  serializeEditorDocument,
} from './serialization';
import {
  EDITOR_TOOL_REGISTRY,
  assertValidToolRegistry,
  canToolTargetLayer,
  resolveDefaultTool,
  resolveEnabledTools,
} from './tools';

test('creates a versioned document from a Viskit image id', () => {
  const doc = createEditorDocument({
    imageId: 'kit-slot:hero:0',
    imageUrl: '/api/images/kit-slot%3Ahero%3A0/bytes',
    width: 1024,
    height: 1536,
    now: '2026-05-22T00:00:00.000Z',
  });

  assert.equal(doc.version, 1);
  assert.equal(doc.source.kind, 'kit-slot');
  assert.equal(doc.layers[0].kind, 'base-image');
  assert.deepEqual(validateEditorDocument(doc), []);
});

test('layer operations preserve unique ids and selection validity', () => {
  const doc = createEditorDocument({
    imageId: 'asset:shirt',
    imageUrl: '/bytes',
    width: 512,
    height: 512,
    now: '2026-05-22T00:00:00.000Z',
  });
  const textLayer = createOcrTextLayer({
    id: 'layer:ocr:1',
    text: 'Sale',
    ocrIndex: 1,
    box: { x: 10, y: 20, w: 120, h: 30 },
    now: '2026-05-22T00:00:00.000Z',
  });
  const withText = { ...doc, layers: insertLayer(doc.layers, textLayer) };
  const selected = selectLayers(withText, ['layer:ocr:1', 'missing']);

  assert.deepEqual(selected.selectedLayerIds, ['layer:ocr:1']);
  assert.throws(() => insertLayer(withText.layers, textLayer), /Duplicate layer id/);
  assert.equal(
    duplicateLayer(withText.layers, 'layer:ocr:1', 'layer:ocr:2')[2].name,
    'OCR text 1 copy'
  );
  assert.equal(reorderLayer(withText.layers, 'layer:ocr:1', 0)[0].id, 'layer:ocr:1');
});

test('serializes, deserializes, and rejects unsupported project versions', () => {
  const doc = createEditorDocument({
    imageId: 'asset:1',
    imageUrl: '/bytes',
    width: 10,
    height: 20,
  });
  const serialized = serializeEditorDocument(doc);
  assert.deepEqual(createSerializedEditorProject(doc), {
    schema: 'viskit-editor-project',
    version: 1,
    document: doc,
  });
  assert.deepEqual(deserializeEditorDocument(serialized), doc);
  assert.deepEqual(deserializeEditorDocument(JSON.stringify(doc)), doc);

  const unsupported = JSON.stringify({
    schema: 'viskit-editor-project',
    version: 999,
    document: doc,
  });
  assert.throws(() => deserializeEditorDocument(unsupported), /Unsupported project version/);
});

test('tool registry enforces unique ids, planned core tools, config filtering, default tool, and compatibility', () => {
  assert.doesNotThrow(() => assertValidToolRegistry(EDITOR_TOOL_REGISTRY));
  const textOnly = resolveEnabledTools({ enabledGroups: ['text'] });
  assert.deepEqual(
    textOnly.map((tool) => tool.id),
    ['text']
  );
  assert.deepEqual(
    resolveEnabledTools({ enabledGroups: ['transform'] }).map((tool) => tool.id),
    ['crop', 'resize', 'rotate', 'flip']
  );
  assert.deepEqual(
    resolveEnabledTools({ enabledGroups: ['shape', 'draw', 'selection', 'filter'] }).map(
      (tool) => tool.id
    ),
    ['shape-rect', 'shape-ellipse', 'brush', 'selection-rect', 'filter-adjust']
  );
  assert.equal(resolveDefaultTool({ enabledGroups: ['ai'], defaultToolId: 'text' })?.id, 'inpaint');
  const inpaint = EDITOR_TOOL_REGISTRY.find((tool) => tool.id === 'inpaint');
  assert.ok(inpaint);
  assert.equal(canToolTargetLayer(inpaint, 'base-image'), true);
  assert.equal(canToolTargetLayer(inpaint, 'ocr-text'), false);
  const filter = EDITOR_TOOL_REGISTRY.find((tool) => tool.id === 'filter-adjust');
  assert.ok(filter);
  assert.equal(canToolTargetLayer(filter, 'raster'), true);
  assert.equal(canToolTargetLayer(filter, 'vector-shape'), false);
});

test('editor core commands transform, crop, resize, rotate, flip, and select layers', () => {
  let doc = createEditorDocument({
    imageId: 'asset:core-transform',
    imageUrl: '/bytes',
    width: 100,
    height: 80,
    now: '2026-05-22T00:00:00.000Z',
  });

  doc = applyEditorCommand(
    doc,
    {
      kind: 'shape.add',
      layer: {
        id: 'layer:shape:rect',
        shape: 'rect',
        bounds: { x: 10, y: 20, width: 30, height: 10 },
      },
      select: true,
    },
    '2026-05-22T00:00:01.000Z'
  );
  assert.deepEqual(doc.selectedLayerIds, ['layer:shape:rect']);

  doc = applyEditorCommand(
    doc,
    {
      kind: 'layer.transform',
      layerId: 'layer:shape:rect',
      transform: { x: 12, y: 18, rotation: 15 },
    },
    '2026-05-22T00:00:02.000Z'
  );

  doc = applyEditorCommand(
    doc,
    { kind: 'document.resize', width: 200, height: 160 },
    '2026-05-22T00:00:03.000Z'
  );
  let shape = doc.layers.find((layer) => layer.id === 'layer:shape:rect');
  assert.ok(shape);
  assert.deepEqual(shape.transform, {
    x: 24,
    y: 36,
    width: 60,
    height: 20,
    rotation: 15,
    scaleX: 1,
    scaleY: 1,
  });

  doc = applyEditorCommand(
    doc,
    { kind: 'document.crop', crop: { x: 20, y: 30, width: 100, height: 80 } },
    '2026-05-22T00:00:04.000Z'
  );
  assert.deepEqual(doc.canvas, { width: 100, height: 80 });
  assert.equal(doc.selection, null);
  shape = doc.layers.find((layer) => layer.id === 'layer:shape:rect');
  assert.ok(shape);
  assert.deepEqual(shape.transform, {
    x: 4,
    y: 6,
    width: 60,
    height: 20,
    rotation: 15,
    scaleX: 1,
    scaleY: 1,
  });

  doc = applyEditorCommand(
    doc,
    { kind: 'document.rotate', degrees: 90 },
    '2026-05-22T00:00:05.000Z'
  );
  assert.deepEqual(doc.canvas, { width: 80, height: 100 });
  shape = doc.layers.find((layer) => layer.id === 'layer:shape:rect');
  assert.ok(shape);
  assert.deepEqual(shape.transform, {
    x: 54,
    y: 4,
    width: 20,
    height: 60,
    rotation: 105,
    scaleX: 1,
    scaleY: 1,
  });

  doc = applyEditorCommand(
    doc,
    { kind: 'document.flip', axis: 'horizontal', layerIds: ['layer:shape:rect'] },
    '2026-05-22T00:00:06.000Z'
  );
  shape = doc.layers.find((layer) => layer.id === 'layer:shape:rect');
  assert.ok(shape);
  assert.deepEqual(shape.transform, {
    x: 6,
    y: 4,
    width: 20,
    height: 60,
    rotation: 105,
    scaleX: -1,
    scaleY: 1,
  });

  doc = applyEditorCommand(
    doc,
    { kind: 'layer.select', layerIds: ['layer:base-image', 'missing'] },
    '2026-05-22T00:00:07.000Z'
  );
  assert.deepEqual(doc.selectedLayerIds, ['layer:base-image']);
});

test('editor core commands create shape, paint, filter, selection, and adapter descriptors', () => {
  let doc = createEditorDocument({
    imageId: 'asset:core-draw',
    imageUrl: '/bytes',
    width: 300,
    height: 200,
    now: '2026-05-22T00:00:00.000Z',
  });

  doc = applyEditorCommand(
    doc,
    {
      kind: 'shape.add',
      layer: {
        id: 'layer:shape:ellipse',
        shape: 'ellipse',
        bounds: { x: 20, y: 30, width: 60, height: 40 },
        fill: '#ff00aa',
      },
      select: true,
    },
    '2026-05-22T00:00:01.000Z'
  );
  doc = applyEditorCommand(
    doc,
    {
      kind: 'paint.layer.add',
      layer: { id: 'layer:paint:1', width: 300, height: 200 },
    },
    '2026-05-22T00:00:02.000Z'
  );
  doc = applyEditorCommand(
    doc,
    {
      kind: 'paint.stroke.add',
      layerId: 'layer:paint:1',
      stroke: {
        id: 'stroke:1',
        points: [
          { x: 1, y: 1 },
          { x: 5, y: 5 },
        ],
        color: '#fff',
        width: 4,
        tool: 'brush',
      },
    },
    '2026-05-22T00:00:03.000Z'
  );
  doc = applyEditorCommand(
    doc,
    {
      kind: 'filter.apply',
      layerId: 'layer:base-image',
      filter: { id: 'filter:brightness', kind: 'brightness', amount: 0.2 },
    },
    '2026-05-22T00:00:04.000Z'
  );
  doc = applyEditorCommand(
    doc,
    {
      kind: 'selection.set',
      selection: {
        shape: { kind: 'rect', bounds: { x: 10, y: 10, width: 50, height: 30 } },
        inverted: false,
        feather: -5,
      },
    },
    '2026-05-22T00:00:05.000Z'
  );
  doc = applyEditorCommand(
    doc,
    {
      kind: 'selection.mask.add',
      layer: { id: 'layer:selection-mask', maskBox: { x: 10, y: 10, w: 50, h: 30 } },
    },
    '2026-05-22T00:00:06.000Z'
  );

  assert.equal(doc.selection?.feather, 0);
  const base = doc.layers.find((layer) => layer.kind === 'base-image');
  assert.ok(base && base.kind === 'base-image');
  assert.equal(base.filters?.[0]?.kind, 'brightness');
  const paint = doc.layers.find((layer) => layer.id === 'layer:paint:1');
  assert.ok(paint && paint.kind === 'paint');
  assert.equal(paint.strokes.length, 1);

  const adapterState = toFabricAdapterState(doc);
  assert.equal(adapterState.backgroundFilters?.includes('brightness'), true);
  assert.equal(
    adapterState.objects.find((object) => object.layerId === 'layer:shape:ellipse')?.type,
    'ellipse'
  );
  assert.equal(
    adapterState.objects.find((object) => object.layerId === 'layer:paint:1')?.props.strokeCount,
    1
  );
  assert.equal(
    adapterState.objects.find((object) => object.layerId === 'layer:selection-mask')?.props.purpose,
    'selection'
  );
});

test('editor core commands push typed history checkpoints through one mutation path', () => {
  const doc = createEditorDocument({
    imageId: 'asset:history-command',
    imageUrl: '/bytes',
    width: 100,
    height: 50,
    now: '2026-05-22T00:00:00.000Z',
  });
  const history = createEditorHistory(5);
  const result = applyEditorCommandWithHistory(
    doc,
    history,
    { kind: 'document.resize', width: 200, height: 100 },
    {
      commandId: 'cmd:resize:1',
      now: '2026-05-22T00:00:01.000Z',
      ts: 1,
    }
  );

  assert.deepEqual(result.document.canvas, { width: 200, height: 100 });
  assert.equal(result.command.kind, 'document.resize');
  assert.equal(result.command.id, 'cmd:resize:1');
  assert.deepEqual(result.command.payload, { kind: 'document.resize', width: 200, height: 100 });
  assert.equal(result.command.checkpoint?.canvas.width, 200);
  assert.deepEqual(
    result.history.undoStack.map((command) => command.id),
    ['cmd:resize:1']
  );
  assert.deepEqual(result.history.redoStack, []);
});

test('history supports cap, undo/redo, jump, dirty state, and redo branch clearing', () => {
  let state = createEditorHistory(2);
  state = pushHistoryCommand(state, { id: 'a', kind: 'tool.change', payload: {}, ts: 1 });
  state = pushHistoryCommand(state, { id: 'b', kind: 'layer.add', payload: {}, ts: 2 });
  state = markHistorySaved(state, 'b');
  assert.equal(isHistoryDirty(state), false);
  state = pushHistoryCommand(state, { id: 'c', kind: 'document.crop', payload: {}, ts: 3 });
  assert.deepEqual(
    state.undoStack.map((command) => command.id),
    ['b', 'c']
  );
  assert.equal(isHistoryDirty(state), true);

  const undone = undoHistory(state);
  assert.equal(undone.command?.id, 'c');
  const redone = redoHistory(undone.state);
  assert.equal(redone.command?.id, 'c');
  const jumped = jumpHistory(redone.state, 0);
  assert.deepEqual(
    jumped.undoStack.map((command) => command.id),
    ['b']
  );
  const branched = pushHistoryCommand(jumped, {
    id: 'd',
    kind: 'layer.select',
    payload: {},
    ts: 4,
  });
  assert.deepEqual(branched.redoStack, []);
});

test('Fabric adapter projects document layers without importing Fabric internals', () => {
  const doc = createEditorDocument({
    imageId: 'asset:1',
    imageUrl: '/bytes',
    width: 10,
    height: 20,
  });
  const textLayer = createOcrTextLayer({
    id: 'layer:ocr:1',
    text: 'Hello',
    box: { x: 1, y: 2, w: 3, h: 4 },
  });
  const state = toFabricAdapterState({ ...doc, layers: insertLayer(doc.layers, textLayer) });

  assert.equal(state.backgroundImageUrl, '/bytes');
  assert.equal(state.objects.length, 1);
  assert.equal(state.objects[0].type, 'textbox');
  assert.equal(state.objects[0].props.text, 'Hello');
});

test('component-safe smoke covers large document, layers, and history cap', () => {
  const now = '2026-05-22T00:00:00.000Z';
  const baseDoc = createEditorDocument({
    imageId: 'asset:large-smoke',
    imageUrl: '/api/images/asset%3Alarge-smoke/bytes',
    width: 4096,
    height: 4096,
    now,
  });
  const ocrLayers = Array.from({ length: 30 }, (_, index) =>
    createOcrTextLayer({
      id: `layer:ocr:${index}`,
      text: `Smoke layer ${index}`,
      ocrIndex: index,
      box: { x: index * 4, y: index * 3, w: 240, h: 48 },
      now,
    })
  );
  let layers = baseDoc.layers;
  for (const layer of ocrLayers) {
    layers = insertLayer(layers, layer);
  }
  const layeredDoc = { ...baseDoc, layers };
  const selectedDoc = selectLayers(
    layeredDoc,
    ocrLayers.map((layer) => layer.id)
  );

  assert.equal(selectedDoc.canvas.width, 4096);
  assert.equal(selectedDoc.layers.length, 31);
  assert.equal(selectedDoc.selectedLayerIds.length, 30);
  assert.deepEqual(validateEditorDocument(selectedDoc), []);

  const adapterState = toFabricAdapterState(selectedDoc);
  assert.equal(adapterState.objects.length, 30);
  assert.equal(
    adapterState.objects.every((object) => object.type === 'textbox'),
    true
  );
  assert.equal(
    adapterState.objects.every((object) => object.selectable),
    true
  );

  const project = deserializeEditorDocument(serializeEditorDocument(selectedDoc));
  assert.equal(project.layers.length, selectedDoc.layers.length);
  assert.deepEqual(project.selectedLayerIds, selectedDoc.selectedLayerIds);

  let history = createEditorHistory(100);
  for (let index = 0; index < 120; index += 1) {
    history = pushHistoryCommand(history, {
      id: `cmd:${index}`,
      kind: 'layer.update',
      payload: { layerId: ocrLayers[index % ocrLayers.length].id },
      ts: index,
      checkpoint: index % 30 === 0 ? selectedDoc : undefined,
    });
  }

  assert.equal(history.undoStack.length, 100);
  assert.equal(history.undoStack[0].id, 'cmd:20');
  assert.equal(history.undoStack.at(-1)?.id, 'cmd:119');
  assert.equal(history.redoStack.length, 0);

  const undone = undoHistory(history);
  assert.equal(undone.command?.id, 'cmd:119');
  const redone = redoHistory(undone.state);
  assert.equal(redone.command?.id, 'cmd:119');
});
