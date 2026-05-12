'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { Button } from '@/components/ui/button';
import { Step1Form } from '@/components/wizard/Step1Form';
import { Step2Upload } from '@/components/wizard/Step2Upload';
import { Step3Retrieval } from '@/components/wizard/Step3Retrieval';
import { Step4Review } from '@/components/wizard/Step4Review';
import { type WizardStep, useWizardStore } from '@/lib/wizard/store';

const TOTAL_STEPS = 4 as const;

const STEP_TITLE_KEYS: Record<WizardStep, string> = {
  1: 'step_1_title',
  2: 'step_2_title',
  3: 'step_3_title',
  4: 'step_4_title',
};

function useStepValid(step: WizardStep): boolean {
  const skuMeta = useWizardStore((s) => s.skuMeta);
  const image = useWizardStore((s) => s.image);
  const selectedHits = useWizardStore((s) => s.selectedHits);
  const sellingPoints = useWizardStore((s) => s.sellingPoints);

  if (step === 1) {
    const price = Number.parseFloat(skuMeta.price);
    return (
      skuMeta.sku.trim().length > 0 &&
      skuMeta.name.trim().length > 0 &&
      skuMeta.brand.trim().length > 0 &&
      skuMeta.category.trim().length > 0 &&
      Number.isFinite(price) &&
      price > 0
    );
  }
  if (step === 2) {
    return image !== null && image.length > 0;
  }
  if (step === 3) {
    return selectedHits.length > 0 && sellingPoints.filter((s) => s.trim().length > 0).length > 0;
  }
  return true; // step 4 — Generate button is owned by Step4Review.
}

export default function NewKitPage() {
  const t = useTranslations('wizard');
  const step = useWizardStore((s) => s.step);
  const back = useWizardStore((s) => s.back);
  const next = useWizardStore((s) => s.next);
  const reset = useWizardStore((s) => s.reset);

  const isFirst = step === 1;
  const isLast = step === TOTAL_STEPS;
  const stepValid = useStepValid(step);

  return (
    <div className="grid h-screen grid-cols-[240px_1fr] grid-rows-[64px_1fr] bg-ink-base">
      <div className="row-span-2">
        <Sidebar />
      </div>
      <div className="col-start-2">
        <Topbar />
      </div>
      <main
        className="col-start-2 row-start-2 flex flex-col gap-s-6 overflow-auto p-s-6"
        data-testid="wizard-root"
        data-debug-step-valid={String(stepValid)}
      >
        <header className="flex items-center justify-between">
          <h1 className="font-display text-xl text-ink-primary">{t('page_title')}</h1>
          <span className="text-xs text-ink-muted" data-testid="wizard-step-label">
            {t('step_label', { current: step, total: TOTAL_STEPS })}
          </span>
        </header>

        <ol
          aria-label={t('page_title')}
          className="flex items-center gap-s-2 text-xs text-ink-muted"
          data-testid="wizard-stepper"
        >
          {([1, 2, 3, 4] as WizardStep[]).map((n) => {
            const active = n === step;
            const done = n < step;
            return (
              <li
                key={n}
                aria-current={active ? 'step' : undefined}
                data-step={n}
                data-state={active ? 'active' : done ? 'done' : 'pending'}
                className={
                  active
                    ? 'rounded-input bg-surface-02 px-s-2 py-s-1 text-accent'
                    : done
                      ? 'rounded-input px-s-2 py-s-1 text-ink-secondary'
                      : 'rounded-input px-s-2 py-s-1 text-ink-faint'
                }
              >
                {n}. {t(STEP_TITLE_KEYS[n])}
              </li>
            );
          })}
        </ol>

        <section
          aria-labelledby="wizard-step-heading"
          className="rounded-card border border-border-subtle bg-surface-01 p-s-6"
          data-testid={`wizard-step-${step}`}
        >
          <h2 id="wizard-step-heading" className="mb-s-4 font-display text-lg text-ink-primary">
            {t(STEP_TITLE_KEYS[step])}
          </h2>
          {step === 1 ? <Step1Form /> : null}
          {step === 2 ? <Step2Upload /> : null}
          {step === 3 ? <Step3Retrieval /> : null}
          {step === 4 ? <Step4Review /> : null}
        </section>

        <footer className="mt-auto flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={back}
            disabled={isFirst}
            data-testid="wizard-back"
          >
            {t('back_button')}
          </Button>
          <Button variant="ghost" size="sm" onClick={reset} data-testid="wizard-reset">
            {t('reset_button')}
          </Button>
          {isLast ? (
            <span aria-hidden className="w-[88px]" />
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={next}
              disabled={!stepValid}
              data-testid="wizard-next"
            >
              {t('next_button')}
            </Button>
          )}
        </footer>
      </main>
    </div>
  );
}
