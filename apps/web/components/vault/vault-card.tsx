'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import type { VaultAsset } from '@/hooks/use-vault-assets';

export type { VaultAsset };

interface VaultCardProps {
  item: VaultAsset;
}

export function VaultCard({ item }: VaultCardProps) {
  const t = useTranslations('vault');

  return (
    <article
      data-testid={`vault-card-${item.id}`}
      className="mb-s-3 break-inside-avoid rounded-card border border-border-subtle bg-surface-01 overflow-hidden"
    >
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
    </article>
  );
}
