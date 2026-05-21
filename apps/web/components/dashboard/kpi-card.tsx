import * as React from 'react';

import { Sparkline } from '@/components/atoms/sparkline';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
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
        ? 'border-success text-success'
        : 'border-danger text-danger'
      : downward
        ? 'border-danger text-danger'
        : 'border-success text-success';
  return (
    <Card
      aria-label={label}
      className={cn(
        'overflow-hidden transition-colors duration-fast hover:border-border-strong hover:bg-surface-02',
        className
      )}
    >
      <CardContent className="flex min-h-[148px] flex-col gap-s-3 p-s-4">
        <span className="font-mono text-xs uppercase text-ink-faint">{label}</span>
        <div className="flex items-end justify-between gap-s-3">
          <div className="flex items-baseline gap-s-2">
            <span className="font-display text-3xl leading-none text-ink-primary">{value}</span>
            {unit ? <span className="font-mono text-xs text-ink-muted">{unit}</span> : null}
          </div>
          {delta ? (
            <Badge variant="outline" className={cn('font-mono', deltaCls)}>
              {delta}
            </Badge>
          ) : null}
        </div>
        <div className="mt-auto min-h-8">
          {sparkData && sparkData.length > 0 ? (
            <Sparkline data={sparkData} color={color} />
          ) : (
            <span aria-hidden="true" className="block h-px w-full bg-border-hair" />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
