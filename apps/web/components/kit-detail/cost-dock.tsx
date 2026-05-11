'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { cn } from '@/lib/utils';

export interface CostBreakdownRow {
  role: string;
  usd: number;
}

export interface CostDockProps {
  kitId: string;
  total: number | null;
  byRole: CostBreakdownRow[] | null;
  className?: string;
}

export function CostDock({ kitId, total, byRole, className }: CostDockProps) {
  const t = useTranslations('kitDetail');
  return (
    <section
      aria-label={`${t('cost_label')} · ${kitId}`}
      className={cn(
        'flex flex-col gap-s-3 rounded-card border border-border-subtle bg-surface-01 p-s-4',
        className
      )}
    >
      <div className="flex items-baseline justify-between gap-s-2">
        <span className="font-mono text-xs uppercase tracking-wider text-ink-faint">
          {t('cost_label')}
        </span>
        {total === null ? (
          <span
            aria-label={t('pending_state')}
            className="inline-block h-6 w-20 animate-pulse rounded-input bg-surface-03"
          />
        ) : (
          <span className="font-display text-2xl text-ink-primary">${total.toFixed(2)}</span>
        )}
      </div>
      {byRole === null ? (
        <div className="flex flex-col gap-s-2">
          {[0, 1, 2].map((i) => (
            <span
              key={`skeleton-${i}`}
              aria-hidden="true"
              className="h-4 w-full animate-pulse rounded-input bg-surface-02"
            />
          ))}
          <span className="text-xs text-ink-muted">{t('pending_state')}</span>
        </div>
      ) : (
        <ul className="flex flex-col gap-s-1">
          {byRole.map((row) => (
            <li
              key={row.role}
              className="flex items-baseline justify-between gap-s-2 border-b border-border-hair py-s-1"
            >
              <span className="font-mono text-xs text-ink-secondary">{row.role}</span>
              <span className="font-mono text-xs text-ink-primary">${row.usd.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
