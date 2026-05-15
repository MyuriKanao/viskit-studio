'use client';

import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import * as React from 'react';

import type { VaultAsset } from '@/hooks/use-vault-assets';

export type { VaultAsset };

// EPIC-11: star toggle is lazy so its TanStack-mutation bytes don't ship in
// the static /vault First Load (170 kB cap). First render of any card triggers
// the chunk fetch once; subsequent renders are instant.
const VaultCardStar = dynamic(
  () => import('./vault-card-star').then((m) => m.VaultCardStar),
  { ssr: false }
);

interface VaultCardProps {
  item: VaultAsset;
  onSelect?: (item: VaultAsset) => void;
  selected?: boolean;
  onToggleSelect?: (id: number, next: boolean) => void;
  /** EPIC-11: when true, render the star toggle overlay. */
  showInspiredToggle?: boolean;
}

export function VaultCard({
  item,
  onSelect,
  selected,
  onToggleSelect,
  showInspiredToggle,
}: VaultCardProps) {
  const t = useTranslations('vault');

  const inner = (
    <>
      {onToggleSelect !== undefined && (
        <span className="absolute left-2 top-2 z-10">
          <input
            type="checkbox"
            checked={selected ?? false}
            aria-label={`Select asset ${item.id}`}
            onChange={(e) => onToggleSelect(item.id, e.target.checked)}
            onClick={(e) => e.stopPropagation()}
            className="h-4 w-4 cursor-pointer rounded-sm accent-accent"
          />
        </span>
      )}
      {showInspiredToggle && (
        <VaultCardStar assetId={item.id} inspired={item.inspired ?? false} />
      )}
      <img
        src={item.image_url}
        alt={item.description || item.category}
        loading="lazy"
        className="w-full block object-cover"
      />
      <div className="p-s-3 flex flex-col gap-s-1">
        <span className="font-mono text-xs uppercase tracking-wider text-ink-faint">
          {item.category} · {item.season}
        </span>
        <span className="font-display text-base text-ink-primary line-clamp-2">
          {item.description}
        </span>
        <div className="flex justify-between text-xs text-ink-muted">
          <span>{t('sales_pattern', { count: item.sales_count })}</span>
          <span>¥{item.price.toFixed(2)}</span>
        </div>
      </div>
    </>
  );

  if (onSelect) {
    return (
      <button
        type="button"
        data-testid={`vault-card-${item.id}`}
        onClick={() => onSelect(item)}
        className="relative mb-s-3 block w-full text-left break-inside-avoid rounded-card border border-border-subtle bg-surface-01 overflow-hidden hover:border-border-strong focus:outline-none focus:ring-2 focus:ring-accent"
      >
        {inner}
      </button>
    );
  }

  return (
    <article
      data-testid={`vault-card-${item.id}`}
      className="relative mb-s-3 break-inside-avoid rounded-card border border-border-subtle bg-surface-01 overflow-hidden"
    >
      {inner}
    </article>
  );
}
