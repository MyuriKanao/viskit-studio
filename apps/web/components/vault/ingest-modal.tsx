'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { type VaultIngestResponse, useVaultIngest } from '@/hooks/use-vault-ingest';

interface IngestModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (report: VaultIngestResponse) => void;
  onError: (err: Error) => void;
}

export function IngestModal({ open, onOpenChange, onSuccess, onError }: IngestModalProps) {
  const t = useTranslations('vault');
  const mutation = useVaultIngest();
  const formRef = React.useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);

    mutation.mutate(formData, {
      onSuccess: (report) => {
        onOpenChange(false);
        onSuccess(report);
        form.reset();
      },
      onError: (err) => {
        onError(err);
      },
    });
  }

  function handleCancel() {
    onOpenChange(false);
    formRef.current?.reset();
    mutation.reset();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('ingest_modal_title')}</DialogTitle>
          <DialogDescription>{t('ingest_file_label')}</DialogDescription>
        </DialogHeader>

        <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-s-4">
          <div className="flex flex-col gap-s-1">
            <label htmlFor="vault-ingest-file" className="text-sm text-ink-secondary">
              {t('ingest_file_label')}
            </label>
            <input
              id="vault-ingest-file"
              type="file"
              name="file"
              accept=".csv,text/csv"
              required
              aria-label={t('ingest_file_label')}
              className="text-sm text-ink-primary file:mr-s-2 file:rounded-input file:border-0 file:bg-surface-02 file:px-s-2 file:py-s-1 file:text-sm"
            />
          </div>

          <div className="flex flex-col gap-s-1">
            <label htmlFor="vault-ingest-mode" className="text-sm text-ink-secondary">
              {t('ingest_mode_label')}
            </label>
            <select
              id="vault-ingest-mode"
              name="mode"
              defaultValue="upsert"
              aria-label={t('ingest_mode_label')}
              className="rounded-input border border-border-subtle bg-surface-01 px-s-2 py-s-1 text-sm text-ink-primary"
            >
              <option value="upsert">{t('ingest_mode_upsert')}</option>
              <option value="append">{t('ingest_mode_append')}</option>
              <option value="replace">{t('ingest_mode_replace')}</option>
            </select>
          </div>

          <div className="flex justify-end gap-s-2">
            <button
              type="button"
              aria-label={t('ingest_cancel')}
              onClick={handleCancel}
              className="rounded-input border border-border-subtle bg-surface-01 px-s-3 py-s-1 text-sm text-ink-muted hover:text-ink-primary"
            >
              {t('ingest_cancel')}
            </button>
            <button
              type="submit"
              aria-label={mutation.isPending ? t('ingest_pending') : t('ingest_submit')}
              disabled={mutation.isPending}
              className="rounded-input bg-accent px-s-3 py-s-1 text-sm text-ink-on-accent disabled:opacity-50"
            >
              {mutation.isPending ? t('ingest_pending') : t('ingest_submit')}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
