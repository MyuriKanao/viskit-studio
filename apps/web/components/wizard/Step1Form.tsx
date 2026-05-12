'use client';

import { useTranslations } from 'next-intl';

import { type WizardLocale, useWizardStore } from '@/lib/wizard/store';

const FIELD_LABEL_CLS = 'flex flex-col gap-s-1 text-xs text-ink-muted';
const FIELD_HEAD_CLS = 'font-mono uppercase tracking-wider text-ink-faint';
const FIELD_INPUT_CLS =
  'rounded-input border border-border-subtle bg-surface-02 px-s-3 py-s-2 text-sm text-ink-primary';

const PRODUCT_TYPES = ['blue_hat', 'sports', 'general_food', 'other'] as const;
const PRODUCT_TYPE_LABEL_KEY: Record<(typeof PRODUCT_TYPES)[number], string> = {
  blue_hat: 'step_1.product_type_blue_hat',
  sports: 'step_1.product_type_sports',
  general_food: 'step_1.product_type_general_food',
  other: 'step_1.product_type_other',
};

export function Step1Form() {
  const t = useTranslations('wizard');
  const skuMeta = useWizardStore((s) => s.skuMeta);
  const setSkuMeta = useWizardStore((s) => s.setSkuMeta);
  const brandColor = useWizardStore((s) => s.brandColor);
  const setBrandColor = useWizardStore((s) => s.setBrandColor);
  const locale = useWizardStore((s) => s.locale);
  const setLocale = useWizardStore((s) => s.setLocale);

  return (
    <div className="grid grid-cols-1 gap-s-4 md:grid-cols-2" data-testid="wizard-step1-form">
      <label className={FIELD_LABEL_CLS} htmlFor="wizard-sku">
        <span className={FIELD_HEAD_CLS}>{t('step_1.sku_label')}</span>
        <input
          id="wizard-sku"
          type="text"
          aria-label={t('step_1.sku_label')}
          value={skuMeta.sku}
          onChange={(e) => setSkuMeta({ sku: e.target.value })}
          className={FIELD_INPUT_CLS}
        />
      </label>
      <label className={FIELD_LABEL_CLS} htmlFor="wizard-name">
        <span className={FIELD_HEAD_CLS}>{t('step_1.name_label')}</span>
        <input
          id="wizard-name"
          type="text"
          aria-label={t('step_1.name_label')}
          value={skuMeta.name}
          onChange={(e) => setSkuMeta({ name: e.target.value })}
          className={FIELD_INPUT_CLS}
        />
      </label>
      <label className={FIELD_LABEL_CLS} htmlFor="wizard-brand">
        <span className={FIELD_HEAD_CLS}>{t('step_1.brand_label')}</span>
        <input
          id="wizard-brand"
          type="text"
          aria-label={t('step_1.brand_label')}
          value={skuMeta.brand}
          onChange={(e) => setSkuMeta({ brand: e.target.value })}
          className={FIELD_INPUT_CLS}
        />
      </label>
      <label className={FIELD_LABEL_CLS} htmlFor="wizard-category">
        <span className={FIELD_HEAD_CLS}>{t('step_1.category_label')}</span>
        <input
          id="wizard-category"
          type="text"
          aria-label={t('step_1.category_label')}
          value={skuMeta.category}
          onChange={(e) => setSkuMeta({ category: e.target.value })}
          className={FIELD_INPUT_CLS}
        />
      </label>
      <label className={FIELD_LABEL_CLS} htmlFor="wizard-product-type">
        <span className={FIELD_HEAD_CLS}>{t('step_1.product_type_label')}</span>
        <select
          id="wizard-product-type"
          aria-label={t('step_1.product_type_label')}
          value={skuMeta.product_type || 'other'}
          onChange={(e) => setSkuMeta({ product_type: e.target.value })}
          className={FIELD_INPUT_CLS}
        >
          {PRODUCT_TYPES.map((pt) => (
            <option key={pt} value={pt}>
              {t(PRODUCT_TYPE_LABEL_KEY[pt])}
            </option>
          ))}
        </select>
      </label>
      <label className={FIELD_LABEL_CLS} htmlFor="wizard-price">
        <span className={FIELD_HEAD_CLS}>{t('step_1.price_label')}</span>
        <input
          id="wizard-price"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          aria-label={t('step_1.price_label')}
          value={skuMeta.price}
          onChange={(e) => setSkuMeta({ price: e.target.value })}
          className={FIELD_INPUT_CLS}
        />
        <span className="text-[10px] text-ink-faint">{t('step_1.price_hint')}</span>
      </label>
      <label className={FIELD_LABEL_CLS} htmlFor="wizard-brand-color">
        <span className={FIELD_HEAD_CLS}>{t('step_1.brand_color_label')}</span>
        <span className="flex items-center gap-s-2">
          <input
            id="wizard-brand-color"
            type="color"
            aria-label={t('step_1.brand_color_label')}
            value={brandColor}
            onChange={(e) => setBrandColor(e.target.value)}
            className="h-9 w-12 cursor-pointer rounded-input border border-border-subtle bg-surface-02 p-s-1"
          />
          <span className="font-mono text-sm text-ink-secondary">{brandColor}</span>
        </span>
      </label>
      <fieldset className={FIELD_LABEL_CLS}>
        <legend className={FIELD_HEAD_CLS}>{t('step_1.locale_label')}</legend>
        <div className="flex gap-s-2" role="radiogroup" aria-label={t('step_1.locale_label')}>
          {(['zh', 'en'] as WizardLocale[]).map((loc) => (
            <button
              key={loc}
              type="button"
              // biome-ignore lint/a11y/useSemanticElements: styled toggle group — visual buttons with radio semantics, not a real <input type="radio">
              role="radio"
              aria-checked={locale === loc}
              onClick={() => setLocale(loc)}
              data-testid={`wizard-locale-${loc}`}
              className={
                locale === loc
                  ? 'rounded-input border border-accent bg-surface-02 px-s-3 py-s-2 text-sm text-accent'
                  : 'rounded-input border border-border-subtle bg-surface-01 px-s-3 py-s-2 text-sm text-ink-secondary hover:text-ink-primary'
              }
            >
              {t(loc === 'zh' ? 'step_1.locale_zh' : 'step_1.locale_en')}
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
