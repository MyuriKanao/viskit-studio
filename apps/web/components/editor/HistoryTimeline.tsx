'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { HISTORY_CAP, useCommandStack } from '@/lib/editor/command-stack';
import { cn } from '@/lib/utils';

function formatHmsLocal(ts: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(ts));
}

export function HistoryTimeline() {
  const t = useTranslations('editor');
  const undoStack = useCommandStack((s) => s.undoStack);
  const redoStack = useCommandStack((s) => s.redoStack);
  const jumpTo = useCommandStack((s) => s.jumpTo);

  const total = undoStack.length + redoStack.length;

  if (total === 0) {
    return (
      <div
        data-testid="history-timeline"
        className="flex items-center gap-2 overflow-x-auto rounded-card border border-border-subtle bg-surface-02 px-3 py-2"
      >
        <p className="text-xs text-ink-faint">{t('history.empty')}</p>
      </div>
    );
  }

  // Visual order: undoStack (oldest→newest) then redoStack reversed (next-redo first)
  const visualEntries = [...undoStack, ...redoStack.slice().reverse()];
  const undoCount = undoStack.length;

  return (
    <div
      data-testid="history-timeline"
      className="flex items-center gap-2 overflow-x-auto rounded-card border border-border-subtle bg-surface-02 px-3 py-2"
    >
      {undoStack.length >= HISTORY_CAP && (
        <span className="text-xs text-ink-faint">{t('history.cap')}</span>
      )}
      {visualEntries.map((cmd, i) => {
        const isApplied = i < undoCount;
        const isCurrent = i === undoCount - 1;

        return (
          <React.Fragment key={cmd.id}>
            <button
              type="button"
              data-testid={`history-entry-${i}`}
              data-state={isApplied ? 'applied' : 'pending'}
              data-op-type={cmd.op_type}
              className={cn(
                'flex shrink-0 flex-col items-start rounded-input border border-border-subtle px-2 py-1 text-xs transition-colors',
                isApplied
                  ? 'bg-surface-03 text-ink-primary'
                  : 'bg-surface-01 text-ink-muted opacity-70',
                isCurrent && 'ring-1 ring-accent'
              )}
              onClick={() => jumpTo(i)}
            >
              <span className="font-mono text-ink-secondary">{cmd.op_type}</span>
              <time dateTime={new Date(cmd.ts).toISOString()} className="text-ink-faint">
                {formatHmsLocal(cmd.ts)}
              </time>
            </button>
            {i === undoCount - 1 && (
              <div className="h-8 w-px bg-accent" data-testid="history-cursor" />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
