'use client';

import * as React from 'react';

import type { VaultAsset } from '@/hooks/use-vault-assets';

import { VaultCard } from './vault-card';

interface VaultGridProps {
  items: VaultAsset[];
  onSelect?: (item: VaultAsset) => void;
  selection?: Set<number>;
  onToggleSelect?: (id: number, next: boolean) => void;
}

export function VaultGrid({ items, onSelect, selection, onToggleSelect }: VaultGridProps) {
  return (
    <div className="columns-2 md:columns-3 lg:columns-4 gap-s-3" data-testid="vault-grid">
      {items.map((item) => (
        <VaultCard
          key={item.id}
          item={item}
          onSelect={onSelect}
          selected={selection?.has(item.id)}
          onToggleSelect={onToggleSelect}
        />
      ))}
    </div>
  );
}
