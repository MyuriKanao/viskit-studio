'use client';

import { LayoutGrid, Table } from 'lucide-react';

import { cn } from '@/lib/utils';

export type CatalogView = 'grid' | 'table';

export interface ViewToggleProps {
  value: CatalogView;
  onChange: (next: CatalogView) => void;
  gridLabel: string;
  tableLabel: string;
}

export function ViewToggle({ value, onChange, gridLabel, tableLabel }: ViewToggleProps) {
  return (
    <div
      role="radiogroup"
      aria-label={`${gridLabel} / ${tableLabel}`}
      className="inline-flex items-center gap-s-1 rounded-input border border-border-subtle bg-surface-01 p-s-1"
    >
      {(
        [
          { id: 'grid' as const, label: gridLabel, Icon: LayoutGrid },
          { id: 'table' as const, label: tableLabel, Icon: Table },
        ] satisfies { id: CatalogView; label: string; Icon: typeof LayoutGrid }[]
      ).map(({ id, label, Icon }) => {
        const active = value === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            data-testid={`view-toggle-${id}`}
            onClick={() => onChange(id)}
            className={cn(
              'inline-flex items-center gap-s-2 rounded-input px-s-3 py-s-1 text-xs transition-colors duration-fast',
              active
                ? 'bg-surface-02 text-ink-primary'
                : 'text-ink-muted hover:bg-surface-02 hover:text-ink-primary'
            )}
          >
            <Icon aria-hidden="true" className="h-3.5 w-3.5" />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
