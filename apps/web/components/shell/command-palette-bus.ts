'use client';

/**
 * Tiny pub/sub the Topbar uses to ask the CommandPalette to open without
 * lifting state up into the layout. Avoids a context provider for a single
 * boolean.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export function subscribeOpenCommandPalette(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function openCommandPalette(): void {
  for (const l of Array.from(listeners)) l();
}
