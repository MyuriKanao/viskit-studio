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

/**
 * Footgun guard: mode="replace" drops the entire Milvus aishop_bestsellers
 * collection — the same corpus the Wizard's Step-3 retrieval reads from.
 * Require the operator to type this literal token before enabling submit.
 */
const REPLACE_CONFIRM_TOKEN = 'replace';

export function IngestModal({ open, onOpenChange, onSuccess, onError }: IngestModalProps) {
  const t = useTranslations('vault');
  const mutation = useVaultIngest();
  const formRef = React.useRef<HTMLFormElement>(null);
  const [mode, setMode] = React.useState<'upsert' | 'append' | 'replace'>('upsert');
  const [replaceConfirm, setReplaceConfirm] = React.useState('');

  const isReplaceGated = mode === 'replace' && replaceConfirm !== REPLACE_CONFIRM_TOKEN;
  const submitDisabled = mutation.isPending || isReplaceGated;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isReplaceGated) {
      return;
    }
    const form = e.currentTarget;
    const formData = new FormData(form);
    formData.delete('replace_confirm');

    mutation.mutate(formData, {
      onSuccess: (report) => {
        onOpenChange(false);
        onSuccess(report);
        form.reset();
        setMode('upsert');
        setReplaceConfirm('');
      },
      onError: (err) => {
        onError(err);
      },
    });
  }

  function handleCancel() {
    onOpenChange(false);
    formRef.current?.reset();
    setMode('upsert');
    setReplaceConfirm('');
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
              value={mode}
              onChange={(e) => {
                setMode(e.target.value as 'upsert' | 'append' | 'replace');
                setReplaceConfirm('');
              }}
              aria-label={t('ingest_mode_label')}
              className="rounded-input border border-border-subtle bg-surface-01 px-s-2 py-s-1 text-sm text-ink-primary"
            >
              <option value="upsert">{t('ingest_mode_upsert')}</option>
              <option value="append">{t('ingest_mode_append')}</option>
              <option value="replace">{t('ingest_mode_replace')}</option>
            </select>
          </div>

          {mode === 'replace' ? (
            <div
              data-testid="vault-ingest-replace-gate"
              className="flex flex-col gap-s-2 rounded-input border border-danger bg-surface-02 p-s-3"
            >
              <p className="text-sm text-danger">{t('ingest_replace_warning')}</p>
              <label htmlFor="vault-ingest-replace-confirm" className="text-sm text-ink-secondary">
                {t('ingest_replace_confirm_label', { token: REPLACE_CONFIRM_TOKEN })}
              </label>
              <input
                id="vault-ingest-replace-confirm"
                type="text"
                name="replace_confirm"
                value={replaceConfirm}
                onChange={(e) => setReplaceConfirm(e.target.value)}
                autoComplete="off"
                aria-label={t('ingest_replace_confirm_label', { token: REPLACE_CONFIRM_TOKEN })}
                className="rounded-input border border-border-subtle bg-surface-01 px-s-2 py-s-1 text-sm text-ink-primary"
              />
            </div>
          ) : null}

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
              disabled={submitDisabled}
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
