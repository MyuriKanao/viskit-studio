'use client';

import * as React from 'react';

interface VaultInspiredChipProps {
  pressed: boolean;
  onChange: (next: boolean) => void;
  label: string;
  tooltip: string;
}

/** Inline SVG star — NO lucide-react import (Radix surface frozen, bundle budget). */
function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

/**
 * EPIC-12: Inspired-only filter chip.
 * Static inline (not lazy) — chip is visible on initial paint.
 * No Radix imports; Tailwind classes match existing vault filter chips.
 */
export function VaultInspiredChip({ pressed, onChange, label, tooltip }: VaultInspiredChipProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      data-testid="vault-inspired-chip"
      title={tooltip}
      onClick={() => onChange(!pressed)}
      className={[
        'inline-flex items-center gap-s-1 rounded-input border px-s-2 py-s-1 text-sm transition-colors',
        pressed
          ? 'border-accent bg-accent text-ink-on-accent'
          : 'border-border-subtle bg-surface-01 text-ink-muted hover:text-ink-primary',
      ].join(' ')}
    >
      <StarIcon filled={pressed} />
      {label}
    </button>
  );
}
