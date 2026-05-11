import * as React from 'react';

import { Sparkline } from '@/components/atoms/sparkline';
import { cn } from '@/lib/utils';

export interface KPICardProps {
  label: string;
  value: number | string;
  unit?: string;
  delta?: string;
  sparkData?: number[];
  color?: string;
  downward?: boolean;
  className?: string;
}

/**
 * KPICard — Dashboard weekly-pulse strip cell.
 *
 * Color is left to Tailwind tokens via the sparkline color prop; "downward"
 * deltas (e.g. cost going down is good) flip the accent semantic from
 * `text-success` to `text-warning` based on the `downward` hint.
 */
export function KPICard({
  label,
  value,
  unit,
  delta,
  sparkData,
  color,
  downward,
  className,
}: KPICardProps) {
  // Treat downward as "good" semantically when the metric should fall (cost,
  // edit time); positive when delta starts with '+', negative when '-'.
  const deltaCls =
    delta?.startsWith('-') || delta?.startsWith('−')
      ? downward
        ? 'text-success'
        : 'text-danger'
      : downward
        ? 'text-danger'
        : 'text-success';
  return (
    <section
      aria-label={label}
      className={cn(
        'flex flex-col gap-s-2 rounded-card border border-border-subtle bg-surface-01 p-s-4',
        className
      )}
    >
      <span className="font-mono text-xs uppercase tracking-wider text-ink-faint">{label}</span>
      <div className="flex items-baseline gap-s-2">
        <span className="font-display text-3xl text-ink-primary">{value}</span>
        {unit ? <span className="font-mono text-xs text-ink-muted">{unit}</span> : null}
      </div>
      {delta ? <span className={cn('font-mono text-xs', deltaCls)}>{delta}</span> : null}
      {sparkData && sparkData.length > 0 ? (
        <Sparkline data={sparkData} color={color} className="mt-s-1" />
      ) : null}
    </section>
  );
}
