'use client';

import * as React from 'react';

import { StatusChip } from '@/components/atoms/status-chip';
import type { KitListItem } from '@/hooks/use-recent-kits';
import { cn } from '@/lib/utils';

import { AdvisoryBadge } from './AdvisoryBadge';

export interface CatalogTableLabels {
  thumb: string;
  sku: string;
  name: string;
  category: string;
  status: string;
  compliance: string;
  updated: string;
  empty: string;
  advisory: string;
}

export interface CatalogTableProps {
  kits: KitListItem[];
  labels: CatalogTableLabels;
  onRowClick?: (kit: KitListItem) => void;
}

function statusKind(raw: string): 'ok' | 'warn' | 'error' | 'pending' {
  const s = (raw ?? '').toLowerCase();
  if (s === 'ready' || s === 'done') return 'ok';
  if (s === 'failed' || s === 'error') return 'error';
  if (s === 'needs_review') return 'warn';
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

export function CatalogTable({ kits, labels, onRowClick }: CatalogTableProps) {
  const isEmpty = kits.length === 0;

  return (
    <div className="overflow-x-auto" data-testid="catalog-table">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-left text-xs font-medium uppercase tracking-wide text-ink-faint">
            <th className="w-10 px-s-3 py-s-2" scope="col" aria-label="thumbnail" />
            <th className="px-s-3 py-s-2" scope="col">
              {labels.sku}
            </th>
            <th className="px-s-3 py-s-2" scope="col">
              {labels.name}
            </th>
            <th className="hidden px-s-3 py-s-2 md:table-cell" scope="col">
              {labels.category}
            </th>
            <th className="px-s-3 py-s-2" scope="col">
              {labels.status}
            </th>
            <th className="px-s-3 py-s-2" scope="col">
              {labels.compliance}
            </th>
            <th className="hidden px-s-3 py-s-2 lg:table-cell" scope="col">
              {labels.updated}
            </th>
          </tr>
        </thead>
        <tbody>
          {isEmpty ? (
            <tr>
              <td colSpan={7} className="px-s-3 py-s-12 text-center text-sm text-ink-muted">
                {labels.empty}
              </td>
            </tr>
          ) : (
            kits.map((kit) => {
              const kind = statusKind(kit.status);
              const isEn = (kit.locale ?? '').toLowerCase().startsWith('en');
              const thumb = (kit.thumbs ?? []).find(Boolean);
              return (
                <tr
                  key={kit.id}
                  data-testid={`kit-row-${kit.id}`}
                  tabIndex={0}
                  onClick={() => onRowClick?.(kit)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onRowClick?.(kit);
                    }
                  }}
                  className={cn(
                    'cursor-pointer border-b border-border-hair transition-colors duration-fast hover:bg-surface-02 focus:bg-surface-02 focus:outline-none',
                    'group'
                  )}
                >
                  <td className="px-s-3 py-s-2">
                    {thumb ? (
                      <img
                        src={thumb}
                        alt=""
                        className="h-8 w-8 rounded-input object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="block h-8 w-8 rounded-input bg-surface-03"
                      />
                    )}
                  </td>
                  <td className="max-w-[8rem] truncate px-s-3 py-s-2 font-mono text-xs text-ink-secondary">
                    {kit.sku}
                  </td>
                  <td className="max-w-[12rem] truncate px-s-3 py-s-2 font-medium text-ink-primary">
                    <span className="flex items-center gap-s-2">
                      {kit.name}
                      {isEn ? <AdvisoryBadge label={labels.advisory} /> : null}
                    </span>
                  </td>
                  <td className="hidden max-w-[8rem] truncate px-s-3 py-s-2 text-ink-secondary md:table-cell">
                    {kit.category ?? '—'}
                  </td>
                  <td className="px-s-3 py-s-2">
                    <StatusChip status={kind} label={statusLabel(kit.status)} />
                  </td>
                  <td className="px-s-3 py-s-2">
                    {kit.score !== null ? (
                      <span className="font-mono text-xs text-ink-primary">{kit.score}</span>
                    ) : (
                      <span
                        aria-label="Computing"
                        className="inline-block h-4 w-8 animate-pulse rounded-pill bg-surface-03"
                      />
                    )}
                  </td>
                  <td className="hidden px-s-3 py-s-2 text-xs text-ink-muted lg:table-cell">
                    {kit.updated_at ? new Date(kit.updated_at).toLocaleDateString() : '—'}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
