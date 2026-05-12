'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { type WizardLocale, useWizardStore } from '@/lib/wizard/store';

const FIELD_LABEL_CLS = 'flex flex-col gap-s-1 text-xs text-ink-muted';
const FIELD_HEAD_CLS = 'font-mono uppercase tracking-wider text-ink-faint';
const FIELD_INPUT_CLS =
  'rounded-input border border-border-subtle bg-surface-02 px-s-3 py-s-2 text-sm text-ink-primary';

function readAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'));
    reader.onload = () => {
      const v = reader.result;
      resolve(typeof v === 'string' ? v : '');
    };
    reader.readAsDataURL(file);
  });
}

export function Step2Upload() {
  const t = useTranslations('wizard');
  const image = useWizardStore((s) => s.image);
  const setImage = useWizardStore((s) => s.setImage);
  const filters = useWizardStore((s) => s.filters);
  const setFilters = useWizardStore((s) => s.setFilters);
  const locale = useWizardStore((s) => s.locale);
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  const onPick = React.useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const uri = await readAsDataUri(file);
      setImage(uri);
    },
    [setImage]
  );

  const otherLocale: WizardLocale = locale === 'zh' ? 'en' : 'zh';
  const fallbackEnabled = filters.fallback_locale === otherLocale;

  return (
    <div className="flex flex-col gap-s-5" data-testid="wizard-step2-form">
      <section className="flex flex-col gap-s-3">
        <span className={FIELD_HEAD_CLS}>{t('step_2.image_label')}</span>
        {image ? (
          <div className="flex items-start gap-s-3">
            <img
              src={image}
              alt={t('step_2.image_preview_alt')}
              className="h-32 w-32 rounded-card border border-border-subtle bg-surface-02 object-cover"
              data-testid="wizard-step2-image-preview"
            />
            <div className="flex flex-col gap-s-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
              >
                {t('step_2.image_replace_cta')}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setImage(null)}>
                {t('step_2.image_remove_cta')}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => fileRef.current?.click()}
            data-testid="wizard-step2-upload-cta"
          >
            {t('step_2.image_upload_cta')}
          </Button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label={t('step_2.image_label')}
          className="sr-only"
          onChange={onPick}
        />
        {!image ? (
          <p className="text-[11px] text-ink-faint">{t('step_2.image_required_hint')}</p>
        ) : null}
      </section>

      <section className="flex flex-col gap-s-3">
        <h3 className="font-display text-sm text-ink-primary">{t('step_2.filters_title')}</h3>
        <div className="grid grid-cols-1 gap-s-3 md:grid-cols-2">
          <label className={FIELD_LABEL_CLS} htmlFor="wizard-filter-category">
            <span className={FIELD_HEAD_CLS}>{t('step_2.filter_category_label')}</span>
            <input
              id="wizard-filter-category"
              type="text"
              aria-label={t('step_2.filter_category_label')}
              value={filters.category ?? ''}
              onChange={(e) =>
                setFilters({ category: e.target.value.trim() ? e.target.value : null })
              }
              className={FIELD_INPUT_CLS}
            />
          </label>
          <label className={FIELD_LABEL_CLS} htmlFor="wizard-filter-season">
            <span className={FIELD_HEAD_CLS}>{t('step_2.filter_season_label')}</span>
            <input
              id="wizard-filter-season"
              type="text"
              aria-label={t('step_2.filter_season_label')}
              value={filters.season ?? ''}
              onChange={(e) =>
                setFilters({ season: e.target.value.trim() ? e.target.value : null })
              }
              className={FIELD_INPUT_CLS}
            />
          </label>
          <label className={FIELD_LABEL_CLS} htmlFor="wizard-filter-min-sales">
            <span className={FIELD_HEAD_CLS}>{t('step_2.filter_min_sales_label')}</span>
            <input
              id="wizard-filter-min-sales"
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
              aria-label={t('step_2.filter_min_sales_label')}
              value={filters.min_sales === null ? '' : String(filters.min_sales)}
              onChange={(e) => {
                const v = e.target.value;
                setFilters({ min_sales: v === '' ? null : Number(v) });
              }}
              className={FIELD_INPUT_CLS}
            />
          </label>
          <label
            className="flex items-start gap-s-2 text-xs text-ink-muted"
            htmlFor="wizard-filter-fallback"
          >
            <input
              id="wizard-filter-fallback"
              type="checkbox"
              checked={fallbackEnabled}
              onChange={(e) =>
                setFilters({ fallback_locale: e.target.checked ? otherLocale : null })
              }
              className="mt-1 h-4 w-4 rounded border-border-subtle bg-surface-02"
            />
            <span className="flex flex-col gap-s-1">
              <span className={FIELD_HEAD_CLS}>{t('step_2.filter_fallback_locale_label')}</span>
              <span className="text-[11px] text-ink-faint">
                {t('step_2.filter_fallback_locale_hint')}
              </span>
            </span>
          </label>
        </div>
      </section>
    </div>
  );
}
