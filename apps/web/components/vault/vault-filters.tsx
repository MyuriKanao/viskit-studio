'use client';

import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import * as React from 'react';

import { VaultInspiredChip } from '@/components/vault/vault-inspired-chip';
import type { VaultFilters } from '@/hooks/use-vault-assets';

// VaultTagChip owns Popover + TagCombobox + useVaultTags — lazy so those
// modules don't inflate /vault First Load JS (loaded only on first chip click).
const VaultTagChip = dynamic(
  () => import('@/components/vault/vault-tag-popover').then((m) => m.VaultTagChip),
  { ssr: false }
);

interface VaultFiltersProps {
  value: VaultFilters;
  onChange: (next: VaultFilters) => void;
}

const CATEGORY_OPTIONS = ['dress', 'shoes', 'bag', 'coat', 'top', 'pants', 'accessory'];
const SEASON_OPTIONS = ['spring', 'summer', 'autumn', 'winter'];
const LOCALE_OPTIONS = ['zh', 'en', 'ja', 'ko', 'other'];

export function VaultFiltersBar({ value, onChange }: VaultFiltersProps) {
  const t = useTranslations('vault');

  // Normalise tag filter to string | undefined for v1 single-tag chip display.
  const activeTag = Array.isArray(value.tag) ? (value.tag[0] ?? undefined) : value.tag;

  function handleTagChange(next: string | undefined) {
    onChange({ ...value, tag: next });
  }

  function handleClear() {
    onChange({});
  }

  return (
    <div className="flex flex-wrap items-center gap-s-2">
      <select
        aria-label={t('filter_category')}
        value={value.category ?? ''}
        onChange={(e) => onChange({ ...value, category: e.target.value || undefined })}
        className="rounded-input border border-border-subtle bg-surface-01 px-s-2 py-s-1 text-sm text-ink-primary"
      >
        <option value="">{t('filter_all')}</option>
        {CATEGORY_OPTIONS.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>

      <select
        aria-label={t('filter_season')}
        value={value.season ?? ''}
        onChange={(e) => onChange({ ...value, season: e.target.value || undefined })}
        className="rounded-input border border-border-subtle bg-surface-01 px-s-2 py-s-1 text-sm text-ink-primary"
      >
        <option value="">{t('filter_all')}</option>
        {SEASON_OPTIONS.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>

      <select
        aria-label={t('filter_locale')}
        value={value.locale ?? ''}
        onChange={(e) => onChange({ ...value, locale: e.target.value || undefined })}
        className="rounded-input border border-border-subtle bg-surface-01 px-s-2 py-s-1 text-sm text-ink-primary"
      >
        <option value="">{t('filter_all')}</option>
        {LOCALE_OPTIONS.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>

      <input
        type="number"
        min={0}
        aria-label={t('filter_min_sales')}
        placeholder={t('filter_min_sales')}
        value={value.min_sales ?? ''}
        onChange={(e) =>
          onChange({
            ...value,
            min_sales: e.target.value ? Number(e.target.value) : undefined,
          })
        }
        className="w-28 rounded-input border border-border-subtle bg-surface-01 px-s-2 py-s-1 text-sm text-ink-primary"
      />

      {/* Tag filter chip — v1 single-tag select. Lazy-loaded to stay within bundle budget. */}
      <VaultTagChip
        activeTag={activeTag}
        labelTag={t('filter_tag')}
        labelAll={t('filter_tag_all')}
        tooltipAnd={t('filter_tag_tooltip_and')}
        onChange={handleTagChange}
      />

      {/* EPIC-12: Inspired-only filter chip — static inline (visible on initial paint). */}
      <VaultInspiredChip
        pressed={value.inspired ?? false}
        onChange={(next) => onChange({ ...value, inspired: next || undefined })}
        label={t('inspired_filter.label')}
        tooltip={t('inspired_filter.tooltip')}
      />

      <button
        type="button"
        aria-label={t('filter_clear')}
        onClick={handleClear}
        className="rounded-input border border-border-subtle bg-surface-01 px-s-2 py-s-1 text-sm text-ink-muted hover:text-ink-primary"
      >
        {t('filter_clear')}
      </button>
    </div>
  );
}
