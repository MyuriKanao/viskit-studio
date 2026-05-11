import * as React from 'react';

import type { QueueJob } from '@/hooks/use-queue-active';

import { QueueProgress } from './queue-progress';

export interface QueueRowProps {
  row: QueueJob;
}

function formatEta(etaMs: number): string {
  if (!etaMs || etaMs <= 0) return '—';
  const seconds = Math.round(etaMs / 1000);
  if (seconds < 60) return `≈ ${seconds}s`;
  const minutes = Math.round(seconds / 60);
  return `≈ ${minutes}m`;
}

export function QueueRow({ row }: QueueRowProps) {
  const name = row.name ?? row.kit_id;
  const sku = [row.sku, row.locale].filter(Boolean).join(' · ');
  return (
    <div
      aria-label={`Queue job ${name}`}
      className="grid grid-cols-[1fr_auto_120px_60px] items-center gap-s-4 rounded-input border border-border-subtle bg-surface-01 px-s-4 py-s-3"
    >
      <div className="flex flex-col gap-s-1 overflow-hidden">
        <span className="truncate text-sm text-ink-primary">{name}</span>
        {sku ? <span className="truncate font-mono text-xs text-ink-faint">{sku}</span> : null}
      </div>
      <QueueProgress stages={row.stages} ariaLabel={`Progress for ${name}`} />
      <span className="truncate font-mono text-xs text-ink-muted">{row.current_stage}</span>
      <span className="text-right font-mono text-xs text-ink-faint">{formatEta(row.eta_ms)}</span>
    </div>
  );
}
