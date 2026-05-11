import * as React from 'react';

import { cn } from '@/lib/utils';

type StatusKind = 'ok' | 'warn' | 'error' | 'pending';

const STATUS_STYLES: Record<StatusKind, string> = {
  ok: 'bg-success/15 text-success border-success/40',
  warn: 'bg-warning/15 text-warning border-warning/40',
  error: 'bg-danger/15 text-danger border-danger/40',
  pending: 'bg-neutral/15 text-ink-muted border-neutral/40',
};

const DOT_STYLES: Record<StatusKind, string> = {
  ok: 'bg-success',
  warn: 'bg-warning',
  error: 'bg-danger',
  pending: 'bg-neutral',
};

export interface StatusChipProps {
  status: StatusKind;
  label: string;
  ariaLabel?: string;
  className?: string;
}

export function StatusChip({ status, label, ariaLabel, className }: StatusChipProps) {
  return (
    <output
      aria-label={ariaLabel ?? `${status}: ${label}`}
      className={cn(
        'inline-flex items-center gap-s-2 rounded-pill border px-s-3 py-s-1 text-xs font-medium',
        STATUS_STYLES[status],
        className
      )}
    >
      <span aria-hidden="true" className={cn('h-2 w-2 rounded-full', DOT_STYLES[status])} />
      <span>{label}</span>
    </output>
  );
}
