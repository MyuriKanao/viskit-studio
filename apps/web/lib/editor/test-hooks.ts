export type EditorTestHooks = Record<string, unknown>;

declare global {
  interface Window {
    __editorTest?: EditorTestHooks;
  }
}

export function shouldExposeEditorTestHooks() {
  return (
    process.env.NODE_ENV !== 'production' &&
    process.env.NEXT_PUBLIC_VISKIT_EDITOR_TEST_HOOKS === '1'
  );
}

export function getEditorTestHooks(): EditorTestHooks | null {
  if (!shouldExposeEditorTestHooks() || typeof window === 'undefined') return null;
  window.__editorTest ??= {};
  return window.__editorTest;
}
