'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { type ConfigSaveError, useConfigSave } from '@/hooks/use-config-save';

export interface AddEndpointModalProps {
  open: boolean;
  onClose: () => void;
  currentYaml: string;
  currentSha: string;
}

interface FormState {
  role: string;
  name: string;
  base_url: string;
  api_key_env_var: string;
  model: string;
}

const EMPTY: FormState = {
  role: 'llm',
  name: '',
  base_url: '',
  api_key_env_var: '',
  model: '',
};

const ROLES = ['vision', 'llm', 'image_gen', 'image_edit', 'embedding', 'compliance_screen'];

/**
 * Append a new provider stanza to the current YAML body and POST to
 * /api/providers/endpoints. On 409, dispatches a window 'provider-conflict'
 * event carrying the typed error so the parent page can open the
 * ConflictResolutionDialog.
 */
function buildNextYaml(currentYaml: string, form: FormState): string {
  const stanza = [
    `  ${form.role}:`,
    '    protocol: openai_compatible',
    `    base_url: ${form.base_url}`,
    `    api_key_env: ${form.api_key_env_var}`,
    `    model: ${form.model}`,
  ].join('\n');
  // Ensure single trailing newline before appending.
  const trimmed = currentYaml.replace(/\n*$/, '\n');
  return `${trimmed}\n# Added via UI: ${form.name}\n${stanza}\n`;
}

export function AddEndpointModal({
  open,
  onClose,
  currentYaml,
  currentSha,
}: AddEndpointModalProps) {
  const t = useTranslations('providers');
  const [form, setForm] = React.useState<FormState>(EMPTY);
  const save = useConfigSave();

  React.useEffect(() => {
    if (!open) setForm(EMPTY);
  }, [open]);

  const setField =
    <K extends keyof FormState>(k: K) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((s) => ({ ...s, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const next = buildNextYaml(currentYaml, form);
    try {
      await save.mutateAsync({ new_yaml: next, expected_sha256: currentSha });
      onClose();
    } catch (err) {
      const ce = err as ConfigSaveError;
      if (ce.code === 'CHECKSUM_MISMATCH' || ce.code === 'INODE_CHANGED') {
        window.dispatchEvent(
          new CustomEvent('provider-conflict', {
            detail: {
              yourEdit: next,
              onDiskYaml: ce.currentYaml ?? '',
            },
          })
        );
        onClose();
      }
      // 503 + UNKNOWN remain visible via save.error / save.isError on UI.
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent aria-label={t('modal_title')} className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('modal_title')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-s-3">
          <label className="flex flex-col gap-s-1 text-xs text-ink-muted" htmlFor="endpoint-role">
            <span className="font-mono uppercase tracking-wider text-ink-faint">
              {t('table_col_role')}
            </span>
            <select
              id="endpoint-role"
              aria-label={t('table_col_role')}
              value={form.role}
              onChange={setField('role')}
              className="rounded-input border border-border-subtle bg-surface-02 px-s-3 py-s-2 text-sm text-ink-primary"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-s-1 text-xs text-ink-muted" htmlFor="endpoint-name">
            <span className="font-mono uppercase tracking-wider text-ink-faint">
              {t('table_col_name')}
            </span>
            <input
              id="endpoint-name"
              type="text"
              aria-label={t('table_col_name')}
              value={form.name}
              onChange={setField('name')}
              required
              className="rounded-input border border-border-subtle bg-surface-02 px-s-3 py-s-2 text-sm text-ink-primary"
            />
          </label>
          <label className="flex flex-col gap-s-1 text-xs text-ink-muted" htmlFor="endpoint-url">
            <span className="font-mono uppercase tracking-wider text-ink-faint">URL</span>
            <input
              id="endpoint-url"
              type="url"
              aria-label="Base URL"
              value={form.base_url}
              onChange={setField('base_url')}
              required
              className="rounded-input border border-border-subtle bg-surface-02 px-s-3 py-s-2 font-mono text-sm text-ink-primary"
            />
          </label>
          <label
            className="flex flex-col gap-s-1 text-xs text-ink-muted"
            htmlFor="endpoint-api-key"
          >
            <span className="font-mono uppercase tracking-wider text-ink-faint">
              API key env var
            </span>
            <input
              id="endpoint-api-key"
              type="text"
              aria-label="API key environment variable name"
              value={form.api_key_env_var}
              onChange={setField('api_key_env_var')}
              required
              className="rounded-input border border-border-subtle bg-surface-02 px-s-3 py-s-2 font-mono text-sm text-ink-primary"
            />
          </label>
          <label className="flex flex-col gap-s-1 text-xs text-ink-muted" htmlFor="endpoint-model">
            <span className="font-mono uppercase tracking-wider text-ink-faint">
              {t('table_col_model')}
            </span>
            <input
              id="endpoint-model"
              type="text"
              aria-label={t('table_col_model')}
              value={form.model}
              onChange={setField('model')}
              required
              className="rounded-input border border-border-subtle bg-surface-02 px-s-3 py-s-2 font-mono text-sm text-ink-primary"
            />
          </label>
          {save.isError ? (
            <p className="font-mono text-xs text-danger" role="alert">
              {save.error?.code === 'CONFIG_LOCKED'
                ? `${t('page_title')}: locked · retry in ${save.error.retryAfterS ?? 2}s`
                : (save.error?.message ?? 'Save failed')}
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-s-2 pt-s-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose} aria-label="Cancel">
              Cancel
            </Button>
            <Button
              type="submit"
              variant="default"
              size="sm"
              disabled={save.isPending}
              aria-label={t('save_endpoint_button')}
            >
              {t('save_endpoint_button')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
