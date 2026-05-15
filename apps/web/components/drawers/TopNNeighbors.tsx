'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import type { VaultNeighbor } from '@/hooks/use-vault-asset-neighbors';

export interface TopNNeighborsProps {
  neighbors: VaultNeighbor[];
}

export function TopNNeighbors({ neighbors }: TopNNeighborsProps) {
  const t = useTranslations('vault');
  if (neighbors.length === 0) return null;

  return (
    <section
      aria-label={t('drawer_topn_title', { k: neighbors.length })}
      data-testid="vault-drawer-topn"
      className="flex flex-col gap-s-2"
    >
      <h3 className="font-display text-sm text-ink-primary">
        {t('drawer_topn_title', { k: neighbors.length })}
      </h3>
      <ul className="grid grid-cols-3 gap-s-2">
        {neighbors.map((n) => (
          <li
            key={n.id}
            data-testid={`vault-drawer-topn-${n.id}`}
            className="flex flex-col gap-s-1 rounded-card border border-border-subtle bg-surface-02 p-s-1"
          >
            <img
              src={n.image_url}
              alt={n.description ?? ''}
              loading="lazy"
              className="aspect-square w-full rounded-input bg-surface-01 object-cover"
            />
            <span className="font-mono text-[10px] text-ink-faint">
              {t('drawer_topn_distance', { value: n.distance.toFixed(3) })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
