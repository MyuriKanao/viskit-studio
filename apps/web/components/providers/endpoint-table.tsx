'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { StatusChip } from '@/components/atoms/status-chip';
import type { ProviderHealthRow } from '@/hooks/use-providers-health';
import { cn } from '@/lib/utils';

export interface EndpointRow {
  endpoint_id: string;
  role: string;
  base_url: string | null;
}

export interface EndpointTableProps {
  endpoints: EndpointRow[];
  health: ProviderHealthRow[];
  className?: string;
}

type StatusKind = 'ok' | 'warn' | 'error' | 'pending';

function statusKind(s: ProviderHealthRow['status']): StatusKind {
  if (s === 'ok') return 'ok';
  if (s === 'warn') return 'warn';
  if (s === 'error') return 'error';
  return 'pending';
}

export function EndpointTable({ endpoints, health, className }: EndpointTableProps) {
  const t = useTranslations('providers');
  const healthByRole = React.useMemo(() => {
    const map = new Map<string, ProviderHealthRow>();
    for (const h of health) map.set(h.role, h);
    return map;
  }, [health]);
  const statusLabelFor: Record<StatusKind, string> = {
    ok: t('health_status_healthy'),
    warn: t('health_status_degraded'),
    error: t('health_status_down'),
    pending: t('health_status_unknown'),
  };
  return (
    <table
      aria-label={t('page_title')}
      className={cn('w-full border-collapse text-sm text-ink-secondary', className)}
    >
      <thead>
        <tr className="border-b border-border-subtle text-xs uppercase tracking-wider text-ink-faint">
          <th className="px-s-3 py-s-2 text-left font-medium">{t('table_col_role')}</th>
          <th className="px-s-3 py-s-2 text-left font-medium">{t('table_col_name')}</th>
          <th className="px-s-3 py-s-2 text-left font-medium">URL</th>
          <th className="px-s-3 py-s-2 text-left font-medium">{t('table_col_status')}</th>
          <th className="px-s-3 py-s-2 text-right font-medium">{t('table_col_latency')}</th>
        </tr>
      </thead>
      <tbody>
        {endpoints.map((row) => {
          const h = healthByRole.get(row.role);
          const kind = statusKind(h?.status ?? null);
          return (
            <tr key={`${row.role}-${row.endpoint_id}`} className="border-b border-border-hair">
              <td className="px-s-3 py-s-2 font-mono text-xs text-ink-secondary">{row.role}</td>
              <td className="px-s-3 py-s-2 text-ink-primary">{row.endpoint_id}</td>
              <td className="px-s-3 py-s-2 font-mono text-xs text-ink-muted">
                {row.base_url ?? '—'}
              </td>
              <td className="px-s-3 py-s-2">
                <StatusChip status={kind} label={statusLabelFor[kind]} />
              </td>
              <td className="px-s-3 py-s-2 text-right font-mono text-xs text-ink-muted">
                {h?.latency_ms != null ? `${h.latency_ms} ms` : '—'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
