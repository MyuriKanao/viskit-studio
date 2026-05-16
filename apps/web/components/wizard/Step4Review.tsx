'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { type WizardProductType, useGenerateKit, useKitSpec } from '@/hooks/use-wizard';
import { useWizardStore } from '@/lib/wizard/store';

type Phase = 'idle' | 'spec' | 'generating' | 'success' | 'error';

function parseSellingPoints(raw: string, fallback: string): { title: string; evidence: string; priority: 'high' }[] {
  const lines = raw
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const source = lines.length > 0 ? lines : [fallback].filter((s) => s.length > 0);
  return source.map((s) => ({ title: s, evidence: s, priority: 'high' as const }));
}

export function Step4Review() {
  const t = useTranslations('wizard');
  const uiLocale = useLocale();
  const router = useRouter();

  const skuMeta = useWizardStore((s) => s.skuMeta);
  const brandColor = useWizardStore((s) => s.brandColor);
  const locale = useWizardStore((s) => s.locale);
  const sellingPoints = useWizardStore((s) => s.sellingPoints);
  const setSellingPoints = useWizardStore((s) => s.setSellingPoints);
  const kitClientId = useWizardStore((s) => s.kitClientId);

  const specMut = useKitSpec();
  const gen = useGenerateKit();

  const [phase, setPhase] = React.useState<Phase>('idle');
  const [error, setError] = React.useState<string | null>(null);
  const [sellingPointsDraft, setSellingPointsDraft] = React.useState<string>(
    () => sellingPoints.join('\n'),
  );

  const start = React.useCallback(async () => {
    if (phase !== 'idle' && phase !== 'error') return;
    setError(null);

    const points = parseSellingPoints(sellingPointsDraft, skuMeta.name.trim());
    if (points.length === 0) {
      setPhase('error');
      setError(t('step_4.no_selling_points'));
      return;
    }
    setSellingPoints(points.map((p) => p.title));

    setPhase('spec');
    let specRes: { spec: unknown };
    try {
      specRes = await specMut.mutateAsync({
        kit_id: kitClientId,
        locale,
        sku_meta: {
          sku: skuMeta.sku.trim(),
          name: skuMeta.name.trim(),
          brand: skuMeta.brand.trim(),
          category: skuMeta.category.trim(),
          product_type: (skuMeta.product_type || 'other') as WizardProductType,
          price: Number.parseFloat(skuMeta.price) || 0,
        },
        selling_points: points,
      });
    } catch (err) {
      setPhase('error');
      setError((err as Error).message);
      return;
    }

    setPhase('generating');
    const result = await gen.start({
      kit_id: kitClientId,
      brand_color_hex: brandColor,
      locale,
      spec: specRes.spec,
      style_prompt: '',
    });

    if (!result) {
      setPhase('error');
      setError(gen.errorMessage ?? 'generation failed');
      return;
    }

    setPhase('success');
    const prefix = uiLocale === 'zh' ? '' : `/${uiLocale}`;
    router.push(`${prefix}/kits/${result.db_kit_id}`);
  }, [
    phase,
    sellingPointsDraft,
    skuMeta,
    setSellingPoints,
    specMut,
    kitClientId,
    locale,
    gen,
    brandColor,
    uiLocale,
    router,
    t,
  ]);

  const busy = phase === 'spec' || phase === 'generating';

  return (
    <div className="flex flex-col gap-s-5" data-testid="wizard-step4-review">
      <section className="grid grid-cols-1 gap-s-3 md:grid-cols-2">
        <dl className="flex flex-col gap-s-2 text-sm text-ink-secondary">
          <div className="flex justify-between">
            <dt className="text-ink-muted">{t('step_4.review_sku')}</dt>
            <dd className="font-mono">{skuMeta.sku || '—'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-muted">{t('step_4.review_brand')}</dt>
            <dd>{skuMeta.brand || '—'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-muted">{t('step_4.review_locale')}</dt>
            <dd>{locale}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-muted">{t('step_4.review_brand_color')}</dt>
            <dd className="flex items-center gap-s-2 font-mono">
              <span
                aria-hidden
                className="inline-block h-4 w-4 rounded-full border border-border-subtle"
                style={{ backgroundColor: brandColor }}
              />
              {brandColor}
            </dd>
          </div>
        </dl>
      </section>

      <label className="flex flex-col gap-s-1 text-xs text-ink-muted" htmlFor="wizard-selling-points">
        <span className="font-mono uppercase tracking-wider text-ink-faint">
          {t('step_4.selling_points_label')}
        </span>
        <textarea
          id="wizard-selling-points"
          rows={4}
          value={sellingPointsDraft}
          onChange={(e) => setSellingPointsDraft(e.target.value)}
          placeholder={t('step_4.selling_points_placeholder')}
          className="rounded-input border border-border-subtle bg-surface-02 px-s-3 py-s-2 text-sm text-ink-primary"
          data-testid="wizard-step4-selling-points"
        />
      </label>

      <Button
        type="button"
        variant="default"
        size="sm"
        onClick={start}
        disabled={busy}
        data-testid="wizard-step4-generate"
      >
        {t('generate_button')}
      </Button>

      {phase === 'idle' ? <p className="text-xs text-ink-faint">{t('step_4.idle_hint')}</p> : null}

      {busy ? (
        <p className="text-xs text-ink-muted" data-testid="wizard-step4-phase">
          {phase === 'spec' ? t('step_4.phase_spec') : t('step_4.phase_generate')}
        </p>
      ) : null}

      {phase === 'error' && error ? (
        <p className="text-xs text-danger" role="alert" data-testid="wizard-step4-error">
          {t('step_4.generate_error', { message: error })}
        </p>
      ) : null}

      {gen.events.length > 0 ? (
        <section
          aria-label={t('step_4.progress_title')}
          className="flex flex-col gap-s-1"
          data-testid="wizard-step4-progress"
        >
          <h3 className="font-display text-sm text-ink-primary">{t('step_4.progress_title')}</h3>
          <ul className="flex flex-wrap gap-s-2">
            {gen.events.map((e, idx) => (
              <li
                key={`${e.slot}-${idx.toString()}`}
                data-status={e.status}
                className="rounded-input border border-border-subtle bg-surface-02 px-s-2 py-s-1 font-mono text-[11px] text-ink-secondary"
              >
                {e.slot} ·{' '}
                {e.status === 'success'
                  ? t('step_4.progress_success')
                  : e.status === 'failed'
                    ? t('step_4.progress_failed')
                    : e.status === 'running'
                      ? t('step_4.progress_running')
                      : t('step_4.progress_pending')}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
