'use client';

import * as React from 'react';

import { ComplianceRing } from '@/components/atoms/compliance-ring';
import { LocaleFlag } from '@/components/atoms/locale-flag';
import { StatusChip } from '@/components/atoms/status-chip';
import type { KitListItem } from '@/hooks/use-recent-kits';
import { resolveApiImageSrc } from '@/lib/api/images';
import { imageIdForIndex, normalizeKitThumbs } from '@/lib/kits/images';
import { cn } from '@/lib/utils';

export interface KitCardProps {
  kit: KitListItem;
  locale: 'zh' | 'en';
  onClick?: () => void;
  onImageClick?: (imageIndex: number) => void;
  openImageLabel?: string;
}

type KitStatus = 'ok' | 'warn' | 'error' | 'pending';

function statusKind(raw: string): KitStatus {
  const s = (raw ?? '').toLowerCase();
  if (s === 'ready' || s === 'done' || s === 'ok') return 'ok';
  if (s === 'failed' || s === 'error') return 'error';
  if (s === 'needs_review' || s === 'warn') return 'warn';
  return 'pending';
}

function statusLabel(raw: string): string {
  const s = (raw ?? '').toLowerCase();
  if (s === 'ready') return 'Ready';
  if (s === 'generating') return 'Generating';
  if (s === 'needs_review') return 'Needs review';
  if (s === 'queued') return 'Queued';
  if (s === 'failed') return 'Failed';
  return raw || 'Unknown';
}

function Cell({ src }: { src: string | null | undefined }) {
  if (!src) {
    return <span aria-hidden="true" className="block h-full w-full bg-surface-03" />;
  }
  return (
    <img
      src={resolveApiImageSrc(src)}
      alt="kit thumbnail"
      loading="lazy"
      className="block h-full w-full object-cover"
    />
  );
}

export function KitCard({ kit, locale, onClick, onImageClick, openImageLabel }: KitCardProps) {
  const displayName = locale === 'zh' ? kit.name : (kit.name_en ?? kit.name);
  const thumbs = normalizeKitThumbs(kit.thumbs);
  const localeBadge: 'zh' | 'en' = (kit.locale ?? '').toLowerCase().startsWith('en') ? 'en' : 'zh';
  const kind = statusKind(kit.status);
  return (
    <article
      className={cn(
        'flex w-full flex-col gap-s-2 rounded-card border border-border-subtle bg-surface-01 p-s-3 text-left transition-colors duration-fast hover:border-border-strong hover:bg-surface-02'
      )}
    >
      <div className="grid grid-cols-7 grid-rows-2 gap-s-1 overflow-hidden rounded-input border border-border-hair">
        {thumbs.map((t, i) => {
          const imageId = imageIdForIndex(i);
          const handleImageClick = t && onImageClick ? () => onImageClick(i) : onClick;
          return (
            <button
              key={imageId}
              type="button"
              aria-label={
                t && onImageClick
                  ? `${openImageLabel ?? 'Open image'} ${imageId}`
                  : `${displayName} ${kit.sku}`
              }
              onClick={handleImageClick}
              disabled={!handleImageClick}
              className="aspect-square overflow-hidden bg-surface-02 transition-opacity duration-fast hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset disabled:cursor-default"
            >
              <Cell src={t} />
            </button>
          );
        })}
      </div>
      <button
        type="button"
        aria-label={`${displayName} ${kit.sku}`}
        onClick={onClick}
        className="flex w-full flex-col gap-s-1 rounded-input text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ink-base"
      >
        <div className="flex items-baseline justify-between gap-s-2">
          <span className="truncate text-sm font-medium text-ink-primary">{displayName}</span>
          <span className="font-mono text-xs text-ink-faint">{kit.sku}</span>
        </div>
        <div className="flex items-center gap-s-2">
          <StatusChip status={kind} label={statusLabel(kit.status)} />
          <LocaleFlag locale={localeBadge} />
          <span className="flex-1" />
          {kit.score !== null ? (
            <>
              <ComplianceRing score={kit.score} size={28} />
              <span className="font-mono text-xs text-ink-muted">{kit.score}</span>
            </>
          ) : (
            <span
              aria-label="Compliance score computing"
              className="inline-block h-7 w-7 animate-pulse rounded-pill bg-surface-03"
            />
          )}
        </div>
      </button>
    </article>
  );
}
