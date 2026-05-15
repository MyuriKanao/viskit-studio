'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { useRetrievalSearch } from '@/hooks/use-wizard';
import { type RetrievalHit, useWizardStore } from '@/lib/wizard/store';

const FIELD_INPUT_CLS =
  'rounded-input border border-border-subtle bg-surface-02 px-s-3 py-s-2 text-sm text-ink-primary';

function hitKey(h: RetrievalHit): string {
  return h.image_url;
}

export function Step3Retrieval() {
  const t = useTranslations('wizard');
  const tNewKit = useTranslations('newKit');
  const image = useWizardStore((s) => s.image);
  const filters = useWizardStore((s) => s.filters);
  const hits = useWizardStore((s) => s.hits);
  const selectedHits = useWizardStore((s) => s.selectedHits);
  const sellingPoints = useWizardStore((s) => s.sellingPoints);
  const setHits = useWizardStore((s) => s.setHits);
  const setSelectedHits = useWizardStore((s) => s.setSelectedHits);
  const setSellingPoints = useWizardStore((s) => s.setSellingPoints);
  const pinnedRefAssetId = useWizardStore((s) => s.pinnedRefAssetId);
  const clearPinnedRef = useWizardStore((s) => s.clearPinnedRef);

  const search = useRetrievalSearch();

  const onSearch = React.useCallback(async () => {
    if (!image) return;
    const res = await search.mutateAsync({ image, filters, top_k: 12 });
    setHits(res.hits);
    setSelectedHits([]);
  }, [image, filters, search, setHits, setSelectedHits]);

  const toggleHit = React.useCallback(
    (hit: RetrievalHit) => {
      const k = hitKey(hit);
      const isSelected = selectedHits.some((h) => hitKey(h) === k);
      setSelectedHits(
        isSelected ? selectedHits.filter((h) => hitKey(h) !== k) : [...selectedHits, hit]
      );
    },
    [selectedHits, setSelectedHits]
  );

  const showFallbackBanner = hits.some((h) => h.metadata && h.metadata.from_fallback === true);

  const updateSp = (idx: number, value: string) => {
    const next = sellingPoints.slice();
    next[idx] = value;
    setSellingPoints(next);
  };
  const addSp = () => setSellingPoints([...sellingPoints, '']);
  const removeSp = (idx: number) => setSellingPoints(sellingPoints.filter((_, i) => i !== idx));

  return (
    <div className="flex flex-col gap-s-5" data-testid="wizard-step3-form">
      <header className="flex items-center justify-between">
        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={onSearch}
          disabled={!image || search.isPending}
          data-testid="wizard-step3-search"
        >
          {search.isPending ? t('step_3.searching') : t('step_3.search_cta')}
        </Button>
        {hits.length > 0 ? (
          <span className="text-xs text-ink-muted" data-testid="wizard-step3-selected-count">
            {t('step_3.selected_count', { count: selectedHits.length })}
          </span>
        ) : null}
      </header>

      {pinnedRefAssetId !== null ? (
        <div
          data-testid="wizard-step3-pinned-ref"
          className="flex items-center justify-between gap-s-3 rounded-card border-2 border-warning bg-warning/10 px-s-3 py-s-2 text-xs text-ink-primary"
        >
          <span data-testid="wizard-step3-pinned-ref-label">
            {tNewKit('ref_pinned_chip', { id: pinnedRefAssetId })}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearPinnedRef}
            data-testid="wizard-step3-pinned-ref-clear"
          >
            {tNewKit('ref_clear_cta')}
          </Button>
        </div>
      ) : null}

      {showFallbackBanner ? (
        <div
          role="alert"
          className="rounded-card border border-warning bg-warning/10 px-s-3 py-s-2 text-xs text-warning"
          data-testid="wizard-step3-fallback-banner"
        >
          {t('step_3.en_degraded_banner')}
        </div>
      ) : null}

      {search.isError ? (
        <p className="text-xs text-danger" role="alert" data-testid="wizard-step3-error">
          {t('step_3.search_error')}
        </p>
      ) : null}

      {hits.length === 0 && !search.isPending && !search.isError ? (
        <p className="text-xs text-ink-faint">{t('step_3.no_hits')}</p>
      ) : null}

      {hits.length > 0 ? (
        <ul
          className="grid grid-cols-2 gap-s-3 md:grid-cols-4"
          aria-label="retrieval results"
          data-testid="wizard-step3-hits"
        >
          {hits.map((hit) => {
            const selected = selectedHits.some((h) => hitKey(h) === hitKey(hit));
            return (
              <li key={hitKey(hit)}>
                <button
                  type="button"
                  onClick={() => toggleHit(hit)}
                  aria-pressed={selected}
                  data-state={selected ? 'on' : 'off'}
                  className={
                    selected
                      ? 'flex w-full flex-col gap-s-1 rounded-card border-2 border-accent bg-surface-02 p-s-2 text-left'
                      : 'flex w-full flex-col gap-s-1 rounded-card border border-border-subtle bg-surface-01 p-s-2 text-left hover:border-border-strong'
                  }
                >
                  <img
                    src={hit.image_url}
                    alt=""
                    className="aspect-square w-full rounded-input bg-surface-02 object-cover"
                  />
                  <span className="text-[11px] text-ink-muted">
                    {t('step_3.hit_score', { score: hit.score.toFixed(2) })}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      <section className="flex flex-col gap-s-2">
        <h3 className="font-display text-sm text-ink-primary">
          {t('step_3.selling_points_title')}
        </h3>
        <ul className="flex flex-col gap-s-2">
          {sellingPoints.map((sp, idx) => (
            <li key={`sp-${idx.toString()}`} className="flex items-center gap-s-2">
              <input
                type="text"
                aria-label={`${t('step_3.selling_points_title')} ${idx + 1}`}
                placeholder={t('step_3.selling_point_placeholder')}
                value={sp}
                onChange={(e) => updateSp(idx, e.target.value)}
                className={`flex-1 ${FIELD_INPUT_CLS}`}
                data-testid={`wizard-step3-sp-${idx}`}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeSp(idx)}
                aria-label={t('step_3.selling_point_remove')}
              >
                {t('step_3.selling_point_remove')}
              </Button>
            </li>
          ))}
        </ul>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addSp}
          data-testid="wizard-step3-sp-add"
        >
          {t('step_3.selling_point_add')}
        </Button>
        {sellingPoints.filter((s) => s.trim().length > 0).length === 0 ? (
          <p className="text-[11px] text-ink-faint">{t('step_3.min_selling_points_hint')}</p>
        ) : null}
        {hits.length > 0 && selectedHits.length === 0 ? (
          <p className="text-[11px] text-ink-faint">{t('step_3.min_selection_hint')}</p>
        ) : null}
      </section>
    </div>
  );
}
