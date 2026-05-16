'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { useVaultInspiredToggle } from '@/hooks/use-vault-inspired-toggle';

/**
 * EPIC-11 — lazy star-toggle overlay for VaultCard.
 *
 * The toggle hook (TanStack useMutation with optimistic update) ships
 * inside THIS chunk so the static /vault bundle stays inside the
 * 170 kB First Load JS budget. Loaded via next/dynamic where used.
 */
interface VaultCardStarProps {
  assetId: number;
  inspired: boolean;
}

export function VaultCardStar({ assetId, inspired }: VaultCardStarProps) {
  const t = useTranslations('vault');
  const toggle = useVaultInspiredToggle();

  return (
    <button
      type="button"
      aria-label={t(inspired ? 'inspired.toggle_off' : 'inspired.toggle_on')}
      aria-pressed={inspired}
      data-testid={`vault-card-${assetId}-star`}
      onClick={(e) => {
        e.stopPropagation();
        toggle.mutate(assetId);
      }}
      className="absolute right-2 top-2 z-10 inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border-0 bg-surface-01/80 p-0 text-ink-muted backdrop-blur-sm hover:text-ink-primary focus:outline-none focus:ring-2 focus:ring-accent"
    >
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        aria-hidden="true"
        fill={inspired ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      >
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77 5.82 21l1.18-6.88-5-4.87 6.91-1.01L12 2z" />
      </svg>
    </button>
  );
}
