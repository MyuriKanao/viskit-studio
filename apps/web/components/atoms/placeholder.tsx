import * as React from 'react';

import { cn } from '@/lib/utils';

export interface PlaceholderProps {
  label: string;
  targetEpic?: number;
  className?: string;
}

export function Placeholder({ label, targetEpic, className }: PlaceholderProps) {
  return (
    <section
      aria-label={`Placeholder for ${label}`}
      className={cn(
        'flex h-full w-full flex-col items-center justify-center gap-s-3 rounded-card border border-dashed border-border-strong bg-surface-01 p-s-7 text-center',
        className
      )}
    >
      <p className="text-lg font-medium text-ink-primary">{label}</p>
      {targetEpic ? <p className="text-sm text-ink-muted">Coming in EPIC-{targetEpic}</p> : null}
    </section>
  );
}
