'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

export interface FilterOption<T extends string = string> {
  value: T;
  label: string;
}

export interface CatalogFiltersProps {
  /** Status filter — mutually exclusive (or "all") */
  status: string | null;
  statusOptions: FilterOption[];
  onStatusChange: (value: string | null) => void;
  /** Locale filter — mutually exclusive (or "all") */
  locale: string | null;
  localeOptions: FilterOption[];
  onLocaleChange: (value: string | null) => void;
  /** Compliance threshold slider value (0–100) */
  minScore: number | null;
  onMinScoreChange: (value: number | null) => void;
  /** "Clear all" resets every filter */
  hasActiveFilters: boolean;
  onClear: () => void;
  labels: {
    statusLabel: string;
    localeLabel: string;
    minScoreLabel: string;
    allLabel: string;
    clearLabel: string;
  };
}

/** Generate evenly-spaced compliance thresholds in steps-of-10, plus the raw
 *  custom value if already set. */
function scoreOptions(minScore: number | null): number[] {
  const built = [70, 80, 90];
  if (minScore !== null && !built.includes(minScore)) built.push(minScore);
  return built.sort((a, b) => a - b);
}

export function CatalogFilters({
  status,
  statusOptions,
  onStatusChange,
  locale,
  localeOptions,
  onLocaleChange,
  minScore,
  onMinScoreChange,
  hasActiveFilters,
  onClear,
  labels,
}: CatalogFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-s-3" data-testid="catalog-filters">
      {/* Status chips */}
      <fieldset className="flex items-center gap-s-2">
        <legend className="text-xs font-medium text-ink-muted">{labels.statusLabel}</legend>
        <div className="flex flex-wrap gap-s-1">
          <FilterChip
            label={labels.allLabel}
            active={status === null}
            onClick={() => onStatusChange(null)}
          />
          {statusOptions.map((opt) => (
            <FilterChip
              key={opt.value}
              label={opt.label}
              active={status === opt.value}
              onClick={() => onStatusChange(status === opt.value ? null : opt.value)}
            />
          ))}
        </div>
      </fieldset>

      {/* Locale chips */}
      <fieldset className="flex items-center gap-s-2">
        <legend className="text-xs font-medium text-ink-muted">{labels.localeLabel}</legend>
        <div className="flex flex-wrap gap-s-1">
          <FilterChip
            label={labels.allLabel}
            active={locale === null}
            onClick={() => onLocaleChange(null)}
          />
          {localeOptions.map((opt) => (
            <FilterChip
              key={opt.value}
              label={opt.label}
              active={locale === opt.value}
              onClick={() => onLocaleChange(locale === opt.value ? null : opt.value)}
            />
          ))}
        </div>
      </fieldset>

      {/* Compliance score threshold chips */}
      <fieldset className="flex items-center gap-s-2">
        <legend className="text-xs font-medium text-ink-muted">{labels.minScoreLabel}</legend>
        <div className="flex flex-wrap gap-s-1">
          <FilterChip
            label={labels.allLabel}
            active={minScore === null}
            onClick={() => onMinScoreChange(null)}
          />
          {scoreOptions(minScore).map((s) => (
            <FilterChip
              key={s}
              label={`≥${s}`}
              active={minScore === s}
              onClick={() => onMinScoreChange(minScore === s ? null : s)}
            />
          ))}
        </div>
      </fieldset>

      {/* Clear all */}
      {hasActiveFilters ? (
        <button
          type="button"
          onClick={onClear}
          data-testid="clear-filters"
          className="text-xs text-accent underline-offset-2 hover:underline"
        >
          {labels.clearLabel}
        </button>
      ) : null}
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-active={active}
      className={cn(
        'inline-flex items-center rounded-pill border px-s-3 py-s-1 text-xs font-medium transition-colors duration-fast',
        active
          ? 'border-accent bg-accent/10 text-accent'
          : 'border-border-subtle bg-surface-01 text-ink-muted hover:border-border-strong hover:text-ink-primary'
      )}
    >
      {label}
    </button>
  );
}
