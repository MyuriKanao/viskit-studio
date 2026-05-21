'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import * as React from 'react';

import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { Button, buttonVariants } from '@/components/ui/button';
import { type Settings, useSettings, useSettingsSave } from '@/hooks/use-settings';

const FIELD_LABEL_CLS = 'flex flex-col gap-s-1 text-xs text-ink-muted';
const FIELD_HEAD_CLS = 'font-mono uppercase tracking-wider text-ink-faint';
const FIELD_INPUT_CLS =
  'rounded-input border border-border-subtle bg-surface-02 px-s-3 py-s-2 text-sm text-ink-primary';

type LocaleOpt = 'zh' | 'en';
type PresetOpt = 'taobao_v2' | 'tmall' | 'generic_v1';

interface FormState {
  brand_color: string;
  default_locale: LocaleOpt;
  monthly_cap_usd: string;
  export_preset: PresetOpt;
}

const DEFAULT_FORM: FormState = {
  brand_color: '#000000',
  default_locale: 'zh',
  monthly_cap_usd: '0',
  export_preset: 'taobao_v2',
};

function settingsToForm(
  s:
    | Pick<Settings, 'brand_color' | 'default_locale' | 'monthly_cap_usd' | 'export_preset'>
    | undefined
): FormState {
  if (!s) return DEFAULT_FORM;
  const locale: LocaleOpt = s.default_locale === 'en' ? 'en' : 'zh';
  const preset: PresetOpt =
    s.export_preset === 'tmall' || s.export_preset === 'generic_v1' ? s.export_preset : 'taobao_v2';
  return {
    brand_color: s.brand_color ?? DEFAULT_FORM.brand_color,
    default_locale: locale,
    monthly_cap_usd:
      s.monthly_cap_usd === null || s.monthly_cap_usd === undefined
        ? DEFAULT_FORM.monthly_cap_usd
        : String(s.monthly_cap_usd),
    export_preset: preset,
  };
}

export default function SettingsPage() {
  const t = useTranslations('settings');
  const query = useSettings();
  const save = useSettingsSave();

  const [form, setForm] = React.useState<FormState>(DEFAULT_FORM);
  const [baseline, setBaseline] = React.useState<FormState>(DEFAULT_FORM);
  const [toast, setToast] = React.useState<{ kind: 'success' | 'error'; text: string } | null>(
    null
  );

  // Seed form + baseline whenever the upstream query lands.
  React.useEffect(() => {
    if (query.data) {
      const next = settingsToForm(query.data);
      setForm(next);
      setBaseline(next);
    }
  }, [query.data]);

  const dirty = React.useMemo(() => {
    return (
      form.brand_color !== baseline.brand_color ||
      form.default_locale !== baseline.default_locale ||
      form.monthly_cap_usd !== baseline.monthly_cap_usd ||
      form.export_preset !== baseline.export_preset
    );
  }, [form, baseline]);

  const onSave = React.useCallback(async () => {
    const patch: Partial<Settings> = {};
    if (form.brand_color !== baseline.brand_color) patch.brand_color = form.brand_color;
    if (form.default_locale !== baseline.default_locale) patch.default_locale = form.default_locale;
    if (form.export_preset !== baseline.export_preset) patch.export_preset = form.export_preset;
    if (form.monthly_cap_usd !== baseline.monthly_cap_usd) {
      const parsed = Number.parseFloat(form.monthly_cap_usd);
      patch.monthly_cap_usd = Number.isFinite(parsed) ? parsed : 0;
    }

    try {
      await save.mutateAsync(patch);
      setBaseline(form);
      setToast({ kind: 'success', text: t('save_success') });
    } catch {
      setToast({ kind: 'error', text: t('save_error') });
    }
  }, [form, baseline, save, t]);

  const endpointsCount = query.data?.endpoints_count ?? 0;

  return (
    <div className="grid h-screen grid-cols-[240px_1fr] grid-rows-[64px_1fr] bg-ink-base">
      <div className="row-span-2">
        <Sidebar />
      </div>
      <div className="col-start-2">
        <Topbar />
      </div>
      <main className="col-start-2 row-start-2 overflow-auto p-s-6">
        <div className="flex flex-col gap-s-5">
          <header>
            <h1 className="font-display text-2xl text-ink-primary">{t('page_title')}</h1>
          </header>

          <section
            aria-label={t('form_title')}
            className="rounded-card border border-border-subtle bg-surface-01 p-s-4"
            data-testid="settings-form"
          >
            <header className="pb-s-3">
              <span className="font-display text-lg text-ink-primary">{t('form_title')}</span>
            </header>

            <div className="grid grid-cols-1 gap-s-4 md:grid-cols-2">
              <label className={FIELD_LABEL_CLS} htmlFor="settings-brand-color">
                <span className={FIELD_HEAD_CLS}>{t('brand_color_label')}</span>
                <span className="flex items-center gap-s-2">
                  <input
                    id="settings-brand-color"
                    data-testid="settings-brand-color"
                    type="color"
                    aria-label={t('brand_color_label')}
                    value={form.brand_color}
                    onChange={(e) => setForm((f) => ({ ...f, brand_color: e.target.value }))}
                    className="h-9 w-12 cursor-pointer rounded-input border border-border-subtle bg-surface-02 p-s-1"
                  />
                  <span className="font-mono text-sm text-ink-secondary">{form.brand_color}</span>
                </span>
              </label>

              <fieldset className={FIELD_LABEL_CLS}>
                <legend className={FIELD_HEAD_CLS}>{t('default_locale_label')}</legend>
                <div
                  className="flex gap-s-2"
                  role="radiogroup"
                  aria-label={t('default_locale_label')}
                >
                  {(['zh', 'en'] as LocaleOpt[]).map((loc) => (
                    <button
                      key={loc}
                      type="button"
                      // biome-ignore lint/a11y/useSemanticElements: styled toggle group with radio semantics
                      role="radio"
                      aria-checked={form.default_locale === loc}
                      onClick={() => setForm((f) => ({ ...f, default_locale: loc }))}
                      data-testid={`settings-locale-${loc}`}
                      className={
                        form.default_locale === loc
                          ? 'rounded-input border border-accent bg-surface-02 px-s-3 py-s-2 text-sm text-accent'
                          : 'rounded-input border border-border-subtle bg-surface-01 px-s-3 py-s-2 text-sm text-ink-secondary hover:text-ink-primary'
                      }
                    >
                      {t(loc === 'zh' ? 'locale_zh' : 'locale_en')}
                    </button>
                  ))}
                </div>
              </fieldset>

              <label className={FIELD_LABEL_CLS} htmlFor="settings-cap">
                <span className={FIELD_HEAD_CLS}>{t('monthly_cap_label')}</span>
                <input
                  id="settings-cap"
                  data-testid="settings-cap"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  aria-label={t('monthly_cap_label')}
                  value={form.monthly_cap_usd}
                  onChange={(e) => setForm((f) => ({ ...f, monthly_cap_usd: e.target.value }))}
                  className={FIELD_INPUT_CLS}
                />
                <span className="text-[10px] text-ink-faint">{t('monthly_cap_hint')}</span>
              </label>

              <label className={FIELD_LABEL_CLS} htmlFor="settings-export-preset">
                <span className={FIELD_HEAD_CLS}>{t('export_preset_label')}</span>
                <select
                  id="settings-export-preset"
                  data-testid="settings-export-preset"
                  aria-label={t('export_preset_label')}
                  value={form.export_preset}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, export_preset: e.target.value as PresetOpt }))
                  }
                  className={FIELD_INPUT_CLS}
                >
                  <option value="taobao_v2">{t('preset_taobao_v2')}</option>
                  <option value="tmall">{t('preset_tmall')}</option>
                  <option value="generic_v1">{t('preset_generic_v1')}</option>
                </select>
                <span className="text-[10px] text-ink-faint">{t('export_preset_hint')}</span>
              </label>
            </div>

            <div className="flex items-center gap-s-3 pt-s-4">
              <Button
                type="button"
                variant="default"
                size="sm"
                data-testid="settings-save"
                aria-label={t('save_button')}
                disabled={!dirty || save.isPending}
                onClick={onSave}
              >
                {t('save_button')}
              </Button>
              {toast !== null && (
                <output
                  data-testid="settings-toast"
                  className={
                    toast.kind === 'success' ? 'text-xs text-accent' : 'text-xs text-danger'
                  }
                >
                  {toast.text}
                </output>
              )}
            </div>
          </section>

          <section
            aria-label={t('providers_card_title')}
            data-testid="settings-providers-card"
            className="rounded-card border border-border-subtle bg-surface-01 p-s-4"
          >
            <header className="flex items-center justify-between gap-s-3 pb-s-3">
              <span className="font-display text-lg text-ink-primary">
                {t('providers_card_title')}
              </span>
              <Link
                href="/providers"
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                {t('manage_providers')}
              </Link>
            </header>
            <div className="flex items-baseline gap-s-2">
              <span className="font-mono text-xs uppercase tracking-wider text-ink-faint">
                {t('endpoints_count_label')}
              </span>
              <span className="font-display text-xl text-ink-primary">{endpointsCount}</span>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
