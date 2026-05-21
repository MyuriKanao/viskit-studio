'use client';

import * as React from 'react';

import { KitCard } from '@/components/dashboard/kit-card';
import type { KitListItem } from '@/hooks/use-recent-kits';

export interface CatalogGridProps {
  kits: KitListItem[];
  locale: 'zh' | 'en';
  labels: { empty: string; deleteImage: string };
  onKitClick?: (kit: KitListItem) => void;
  onDeleteImage?: (kit: KitListItem, imageId: string) => void;
}

export function CatalogGrid({ kits, locale, labels, onKitClick, onDeleteImage }: CatalogGridProps) {
  if (kits.length === 0) {
    return (
      <p className="py-s-12 text-center text-sm text-ink-muted" data-testid="catalog-grid-empty">
        {labels.empty}
      </p>
    );
  }

  return (
    <div
      className="grid grid-cols-1 gap-s-4 md:grid-cols-2 lg:grid-cols-3"
      data-testid="catalog-grid"
    >
      {kits.map((kit) => (
        <KitCard
          key={kit.id}
          kit={kit}
          locale={locale}
          onClick={() => onKitClick?.(kit)}
          onDeleteImage={(imageId) => onDeleteImage?.(kit, imageId)}
          deleteImageLabel={labels.deleteImage}
        />
      ))}
    </div>
  );
}
