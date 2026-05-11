import * as React from 'react';

import { cn } from '@/lib/utils';

import type { QueueStageStatus } from '@/hooks/use-queue-active';

const STAGE_CLS: Record<QueueStageStatus, string> = {
  done: 'bg-success',
  active: 'bg-accent',
  queued: 'bg-surface-03',
};

export interface QueueProgressProps {
  stages: QueueStageStatus[];
  ariaLabel?: string;
  className?: string;
}

/**
 * Five-step stage stepper.  Each bar renders 4px tall with 2px gaps so a row
 * of 5 fits inside a queue row without overpowering the name column.
 */
export function QueueProgress({ stages, ariaLabel, className }: QueueProgressProps) {
  return (
    <output
      aria-label={ariaLabel ?? 'Queue progress'}
      className={cn('inline-flex h-2 items-center gap-s-1', className)}
    >
      {stages.map((stage, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: positional stage bars
          key={i}
          aria-hidden="true"
          className={cn('h-1.5 w-6 rounded-pill', STAGE_CLS[stage])}
        />
      ))}
    </output>
  );
}
