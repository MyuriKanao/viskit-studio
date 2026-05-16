'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { useWizardStore } from '@/lib/wizard/store';

const FIELD_HEAD_CLS = 'font-mono uppercase tracking-wider text-ink-faint';

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
    </div>
  );
}
