import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import { NextIntlClientProvider } from 'next-intl';
import * as React from 'react';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';

import { HistoryTimeline } from '@/components/editor/HistoryTimeline';
import { LayerPanel } from '@/components/editor/LayerPanel';
import { ToolRail } from '@/components/editor/ToolRail';
import { useCommandStack } from '@/lib/editor/command-stack';
import { downloadDataUrl, downloadText, safeDownloadName } from '@/lib/editor/downloads';
import { decodeEditorRouteImageId } from '@/lib/editor/route';
import type { EditorActiveTool, EditorLayerSummary } from '@/lib/editor/types';

type JSDOMConstructor = new (
  html?: string,
  options?: { url?: string; pretendToBeVisual?: boolean }
) => { window: Window & typeof globalThis; close?: () => void };

const nodeModule = require('node:module') as {
  Module: { _load: (request: string, parent?: unknown, isMain?: boolean) => unknown };
};
const originalModuleLoad = nodeModule.Module._load;
nodeModule.Module._load = function loadWithoutNativeCanvas(
  request: string,
  parent?: unknown,
  isMain?: boolean
) {
  if (request === 'canvas') {
    return {};
  }
  return originalModuleLoad.apply(this, [request, parent, isMain]);
};
const { JSDOM } = require('jsdom') as { JSDOM: JSDOMConstructor };
nodeModule.Module._load = originalModuleLoad;

const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const first = String(args[0] ?? '');
  const stack = String(args[1] ?? '');
  if (first.includes('not wrapped in act') && stack.includes('Tooltip')) return;
  originalConsoleError(...args);
};

const messages = {
  editor: {
    title: 'Image Editor',
    tools: {
      select: 'Select',
      text: 'Text',
      move: 'Move',
      inpaint: 'AI Inpaint',
      undo: 'Undo',
      redo: 'Redo',
    },
    history: {
      empty: 'No history yet',
      cap: 'History capped at 50 steps',
    },
    layers: {
      title: 'Layers',
      subtitle: '{count, plural, one {# layer} other {# layers}}',
      hide: 'Hide layer',
      show: 'Show layer',
      lock: 'Lock layer',
      unlock: 'Unlock layer',
      kind: {
        'base-image': 'Base',
        'fabric-object': 'Object',
        'inpaint-mask': 'Mask',
        'ocr-text': 'OCR text',
      },
      moveUp: 'Move layer up',
      moveDown: 'Move layer down',
      delete: 'Delete layer',
      opacity: 'Opacity',
    },
  },
};

let activeRoots: Root[] = [];

function exposeDomGlobal(name: string, value: unknown) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value,
    writable: true,
  });
}

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    pretendToBeVisual: true,
    url: 'http://localhost/en/editor/asset%3Asmoke',
  });
  const window = dom.window;

  exposeDomGlobal('window', window);
  exposeDomGlobal('document', window.document);
  exposeDomGlobal('navigator', window.navigator);
  exposeDomGlobal('HTMLElement', window.HTMLElement);
  exposeDomGlobal('HTMLAnchorElement', window.HTMLAnchorElement);
  exposeDomGlobal('HTMLInputElement', window.HTMLInputElement);
  exposeDomGlobal('KeyboardEvent', window.KeyboardEvent);
  exposeDomGlobal('MouseEvent', window.MouseEvent);
  exposeDomGlobal('Event', window.Event);
  exposeDomGlobal('CustomEvent', window.CustomEvent);
  exposeDomGlobal('Blob', window.Blob);
  exposeDomGlobal('URL', window.URL);
  exposeDomGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(Date.now()), 0)
  );
  exposeDomGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
  exposeDomGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  exposeDomGlobal('DOMRect', window.DOMRect);
  const htmlElementPrototype = window.HTMLElement.prototype as HTMLElement & {
    attachEvent?: () => void;
    detachEvent?: () => void;
  };
  htmlElementPrototype.attachEvent = () => undefined;
  htmlElementPrototype.detachEvent = () => undefined;
  exposeDomGlobal('IS_REACT_ACT_ENVIRONMENT', true);
}

installDom();

afterEach(() => {
  for (const root of activeRoots) {
    act(() => root.unmount());
  }
  activeRoots = [];
  document.body.replaceChildren();
  useCommandStack.getState().clear();
});

async function renderWithIntl(element: React.ReactElement) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  activeRoots.push(root);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        {element}
      </NextIntlClientProvider>
    );
  });
  return host;
}

function dispatchKey(key: string, options: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key,
        ...options,
      })
    );
  });
}

test('editor route smoke decodes image ids and rejects malformed params', () => {
  assert.equal(decodeEditorRouteImageId('asset%3Asmoke'), 'asset:smoke');
  assert.equal(decodeEditorRouteImageId('kit-slot%3A42%3Ahero'), 'kit-slot:42:hero');
  assert.equal(decodeEditorRouteImageId('%E0%A4%A'), null);
});

test('editor export smoke records project and raster download side effects', async () => {
  const clicks: Array<{ download: string; href: string }> = [];
  const objectUrls: Blob[] = [];
  const revoked: string[] = [];
  const originalClick = HTMLAnchorElement.prototype.click;
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;

  HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
    clicks.push({ download: this.download, href: this.href });
  };
  URL.createObjectURL = (blob: Blob) => {
    objectUrls.push(blob);
    return `blob:viskit-smoke-${objectUrls.length}`;
  };
  URL.revokeObjectURL = (url: string) => {
    revoked.push(url);
  };

  try {
    downloadText(safeDownloadName('asset:smoke', 'viskit-project.json'), '{"version":1}');
    downloadDataUrl(safeDownloadName('asset:smoke', 'png'), 'data:image/png;base64,AAAA');
  } finally {
    HTMLAnchorElement.prototype.click = originalClick;
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
  }

  assert.equal(clicks[0]?.download, 'asset_smoke.viskit-project.json');
  assert.equal(clicks[0]?.href, 'blob:viskit-smoke-1');
  assert.equal(objectUrls[0]?.type, 'application/json');
  assert.deepEqual(revoked, ['blob:viskit-smoke-1']);
  assert.deepEqual(clicks[1], {
    download: 'asset_smoke.png',
    href: 'data:image/png;base64,AAAA',
  });
});

test('tool rail component smoke covers shortcut routing, disabled state, and focused-input guard', async () => {
  useCommandStack.getState().push({
    id: 'cmd:smoke',
    op_type: 'edit_text',
    payload: null,
    snapshot_json: '{}',
    ts: 1,
  });

  let activeTool: EditorActiveTool = 'select';
  const undoCalls: string[] = [];

  function Harness() {
    const [tool, setTool] = React.useState<EditorActiveTool>('select');
    activeTool = tool;
    return (
      <ToolRail
        activeTool={tool}
        onToolChange={(nextTool) => setTool(nextTool)}
        onInpaintStart={() => undefined}
        inpaintStatus="idle"
        onInpaintAbort={() => undefined}
        onUndo={() => undoCalls.push('undo')}
        onRedo={() => undefined}
        hasMask={false}
      />
    );
  }

  const host = await renderWithIntl(<Harness />);
  const textButton = host.querySelector('[data-testid="tool-text"]') as HTMLButtonElement | null;
  const undoButton = host.querySelector('[data-testid="tool-undo"]') as HTMLButtonElement | null;
  assert.ok(textButton);
  assert.ok(undoButton);
  assert.equal(textButton.disabled, false);
  assert.equal(undoButton.disabled, false);

  textButton.focus();
  assert.equal(document.activeElement, textButton);

  dispatchKey('t');
  assert.equal(activeTool, 'text');

  const input = document.createElement('input');
  document.body.append(input);
  input.focus();
  dispatchKey('m');
  assert.equal(activeTool, 'text');

  input.blur();
  dispatchKey('m');
  assert.equal(activeTool, 'move');

  dispatchKey('z', { ctrlKey: true });
  assert.deepEqual(undoCalls, ['undo']);
});

test('layer panel component smoke covers focusable controls and native disabled guards', async () => {
  const layers: EditorLayerSummary[] = [
    {
      id: 'layer:ocr:1',
      label: 'OCR text 1',
      kind: 'ocr-text',
      visible: true,
      locked: false,
      opacity: 0.75,
      selected: true,
    },
    {
      id: 'base-image',
      label: 'Base image',
      kind: 'base-image',
      visible: true,
      locked: true,
      opacity: 1,
      selected: false,
    },
  ];
  const actions: string[] = [];

  const host = await renderWithIntl(
    <LayerPanel
      layers={layers}
      selectedLayerId="layer:ocr:1"
      onSelectLayer={(layerId) => actions.push(`select:${layerId}`)}
      onToggleVisibility={(layerId, visible) => actions.push(`visible:${layerId}:${visible}`)}
      onToggleLocked={(layerId, locked) => actions.push(`locked:${layerId}:${locked}`)}
      onMoveLayer={(layerId, direction) => actions.push(`move:${layerId}:${direction}`)}
      onDeleteLayer={(layerId) => actions.push(`delete:${layerId}`)}
      onChangeOpacity={(layerId, opacity) => actions.push(`opacity:${layerId}:${opacity}`)}
    />
  );

  const selectedRow = host.querySelector(
    '[data-testid="editor-layer-layer:ocr:1"]'
  ) as HTMLElement | null;
  const baseRow = host.querySelector(
    '[data-testid="editor-layer-base-image"]'
  ) as HTMLElement | null;
  assert.ok(selectedRow);
  assert.ok(baseRow);
  assert.equal(selectedRow.getAttribute('data-state'), 'selected');

  const selectedButtons = [...selectedRow.querySelectorAll('button')];
  const selectButton = selectedButtons[0];
  const hideButton = selectedButtons.find(
    (button) => button.getAttribute('aria-label') === 'Hide layer'
  );
  assert.ok(selectButton);
  assert.ok(hideButton);
  selectButton.focus();
  assert.equal(document.activeElement, selectButton);

  act(() => selectButton.click());
  act(() => hideButton.click());

  const opacity = selectedRow.querySelector('input[type="range"]') as HTMLInputElement | null;
  assert.ok(opacity);
  opacity.focus();
  assert.equal(document.activeElement, opacity);
  act(() => {
    opacity.value = '40';
    Simulate.change(opacity);
  });

  const baseButtons = [...baseRow.querySelectorAll('button')];
  assert.equal(
    baseButtons.every((button) => button.disabled),
    true
  );
  assert.deepEqual(actions, [
    'select:layer:ocr:1',
    'visible:layer:ocr:1:false',
    'opacity:layer:ocr:1:0.4',
  ]);
});

test('history timeline component smoke covers focus and cursor jump behavior', async () => {
  const stack = useCommandStack.getState();
  stack.push({ id: 'cmd:a', op_type: 'edit_text', payload: null, snapshot_json: '{}', ts: 1 });
  stack.push({ id: 'cmd:b', op_type: 'inpaint', payload: null, snapshot_json: '{}', ts: 2 });
  stack.undo();

  const host = await renderWithIntl(<HistoryTimeline />);
  const pendingEntry = host.querySelector(
    '[data-testid="history-entry-1"]'
  ) as HTMLButtonElement | null;
  assert.ok(pendingEntry);
  assert.equal(pendingEntry.getAttribute('data-state'), 'pending');

  pendingEntry.focus();
  assert.equal(document.activeElement, pendingEntry);
  act(() => pendingEntry.click());

  assert.deepEqual(
    useCommandStack.getState().undoStack.map((command) => command.id),
    ['cmd:a', 'cmd:b']
  );
  assert.equal(useCommandStack.getState().redoStack.length, 0);
});
