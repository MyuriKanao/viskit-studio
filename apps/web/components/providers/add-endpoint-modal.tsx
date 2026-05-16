'use client';

import { RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { type ConfigSaveError, useConfigSave } from '@/hooks/use-config-save';
import { useProviderProbe } from '@/hooks/use-provider-probe';

export interface AddEndpointModalProps {
  open: boolean;
  onClose: () => void;
  currentYaml: string;
  currentSha: string;
  /** When set, modal opens in edit mode and pre-fills from GET /endpoints/{role}. */
  editingRole?: string | null;
}

const PROTOCOLS = ['openai_compatible', 'anthropic_compatible'] as const;
type Protocol = (typeof PROTOCOLS)[number];

interface FormState {
  role: string;
  protocol: Protocol;
  name: string;
  base_url: string;
  api_key: string;
  model: string;
}

const EMPTY: FormState = {
  role: 'llm',
  protocol: 'openai_compatible',
  name: '',
  base_url: '',
  api_key: '',
  model: '',
};

const ROLES = ['vision', 'llm', 'image', 'embedding', 'compliance_screen'];

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

async function persistSecret(form: FormState): Promise<string> {
  const response = await fetch(`${baseUrl}/api/providers/secrets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: form.role, name: form.name, api_key: form.api_key }),
  });
  if (!response.ok) throw new Error(`Save secret failed (${response.status})`);
  const body = (await response.json()) as { api_key_env: string };
  return body.api_key_env;
}

async function fetchConfigState(): Promise<{ yaml: string; sha256: string }> {
  const response = await fetch(`${baseUrl}/api/providers/config-state`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Read config failed (${response.status})`);
  return (await response.json()) as { yaml: string; sha256: string };
}

interface EndpointStanza {
  protocol: Protocol;
  base_url: string;
  api_key_env: string;
  model: string;
}

async function fetchEndpoint(role: string, signal?: AbortSignal): Promise<EndpointStanza> {
  const response = await fetch(
    `${baseUrl}/api/providers/endpoints/${encodeURIComponent(role)}`,
    { cache: 'no-store', signal }
  );
  if (!response.ok) throw new Error(`Read endpoint failed (${response.status})`);
  return (await response.json()) as EndpointStanza;
}

async function putEndpoint(role: string, body: object): Promise<void> {
  const response = await fetch(`${baseUrl}/api/providers/endpoints/${encodeURIComponent(role)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Update failed (${response.status})`);
}

/**
 * Append a new provider stanza to the current YAML body and POST to
 * /api/providers/endpoints. On 409, dispatches a window 'provider-conflict'
 * event carrying the typed error so the parent page can open the
 * ConflictResolutionDialog.
 */
function buildNextYaml(currentYaml: string, form: FormState, apiKeyEnv: string): string {
  const stanza = [
    `  ${form.role}:`,
    `    protocol: ${form.protocol}`,
    `    base_url: ${form.base_url}`,
    `    api_key_env: ${apiKeyEnv}`,
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
  editingRole,
}: AddEndpointModalProps) {
  const t = useTranslations('providers');
  const [form, setForm] = React.useState<FormState>(EMPTY);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const save = useConfigSave();
  const probe = useProviderProbe();
  const queryClient = useQueryClient();
  const isEdit = Boolean(editingRole);

  const probeReset = probe.reset;
  React.useEffect(() => {
    if (!open) {
      setForm(EMPTY);
      setSubmitError(null);
      probeReset();
      return;
    }
    if (!editingRole) return;
    const controller = new AbortController();
    fetchEndpoint(editingRole, controller.signal)
      .then((stanza) => {
        setForm({
          role: editingRole,
          protocol: stanza.protocol,
          name: editingRole,
          base_url: stanza.base_url,
          api_key: '',
          model: stanza.model,
        });
      })
      .catch((err: unknown) => {
        if ((err as { name?: string }).name === 'AbortError') return;
        setSubmitError((err as Error).message);
      });
    return () => controller.abort();
  }, [open, editingRole, probeReset]);

  const setField =
    <K extends keyof FormState>(k: K) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((s) => {
        // Re-probing is required whenever the probe inputs change.
        if (k === 'protocol' || k === 'base_url' || k === 'api_key') {
          probe.reset();
          return { ...s, [k]: e.target.value, model: '' };
        }
        return { ...s, [k]: e.target.value };
      });

  const handleProbe = async () => {
    const result = await probe.mutateAsync({
      protocol: form.protocol,
      base_url: form.base_url,
      api_key: form.api_key,
    });
    if (result.ok && result.models.length > 0) {
      setForm((s) => ({ ...s, model: result.models[0] }));
    }
  };

  const canProbe = Boolean(form.base_url && form.api_key) && !probe.isPending;
  const probedModels = probe.data?.ok ? probe.data.models : [];

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitError(null);
    if (isEdit && editingRole) {
      try {
        await putEndpoint(editingRole, {
          protocol: form.protocol,
          base_url: form.base_url,
          model: form.model,
          name: form.name || editingRole,
          api_key: form.api_key || null,
        });
        await queryClient.invalidateQueries({ queryKey: ['providers', 'health'] });
        onClose();
      } catch (err) {
        setSubmitError((err as Error).message);
      }
      return;
    }
    // 1. Fetch the current YAML + sha to pass the CAS check.
    // 2. Persist the inline API key to the local secrets store and get back
    //    the auto-derived env-var name. 3. Embed that name into config.yaml.
    let apiKeyEnv: string;
    let state: { yaml: string; sha256: string };
    try {
      state = await fetchConfigState();
      apiKeyEnv = await persistSecret(form);
    } catch (err) {
      setSubmitError((err as Error).message);
      return;
    }
    const next = buildNextYaml(state.yaml, form, apiKeyEnv);
    try {
      await save.mutateAsync({ new_yaml: next, expected_sha256: state.sha256 });
      await queryClient.invalidateQueries({ queryKey: ['providers', 'health'] });
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
          <label
            className="flex flex-col gap-s-1 text-xs text-ink-muted"
            htmlFor="endpoint-protocol"
          >
            <span className="font-mono uppercase tracking-wider text-ink-faint">Protocol</span>
            <select
              id="endpoint-protocol"
              aria-label="Protocol"
              value={form.protocol}
              onChange={setField('protocol')}
              className="rounded-input border border-border-subtle bg-surface-02 px-s-3 py-s-2 font-mono text-sm text-ink-primary"
            >
              {PROTOCOLS.map((p) => (
                <option key={p} value={p}>
                  {p}
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
            <span className="font-mono uppercase tracking-wider text-ink-faint">API Key</span>
            <input
              id="endpoint-api-key"
              type="password"
              aria-label="API Key"
              value={form.api_key}
              onChange={setField('api_key')}
              required={!isEdit}
              autoComplete="off"
              placeholder={isEdit ? '留空保持现有 key' : undefined}
              className="rounded-input border border-border-subtle bg-surface-02 px-s-3 py-s-2 font-mono text-sm text-ink-primary"
            />
          </label>
          <div className="flex flex-col gap-s-1 text-xs text-ink-muted">
            <span className="font-mono uppercase tracking-wider text-ink-faint">
              {t('table_col_model')}
            </span>
            <div className="flex items-stretch gap-s-2">
              <input
                id="endpoint-model"
                type="text"
                aria-label={t('table_col_model')}
                value={form.model}
                onChange={setField('model')}
                required
                list="endpoint-model-suggestions"
                autoComplete="off"
                className="flex-1 rounded-input border border-border-subtle bg-surface-02 px-s-3 py-s-2 font-mono text-sm text-ink-primary"
              />
              <datalist id="endpoint-model-suggestions">
                {probedModels.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={!canProbe}
                onClick={handleProbe}
                aria-label="刷新探测模型"
                title="刷新探测模型"
                className="h-9 w-9 shrink-0"
              >
                <RefreshCw
                  aria-hidden="true"
                  className={`h-4 w-4 ${probe.isPending ? 'animate-spin' : ''}`}
                />
              </Button>
            </div>
            {probe.data && !probe.data.ok ? (
              <p className="font-mono text-xs text-danger" role="alert">
                探测失败: {probe.data.error ?? 'unknown'}
              </p>
            ) : null}
            {probe.data?.ok ? (
              <p className="font-mono text-xs text-ink-faint">
                {probe.data.models.length} 个模型 · {probe.data.latency_ms}ms
              </p>
            ) : null}
            {probe.isError ? (
              <p className="font-mono text-xs text-danger" role="alert">
                {probe.error.message}
              </p>
            ) : null}
          </div>
          {submitError ? (
            <p className="font-mono text-xs text-danger" role="alert">
              {submitError}
            </p>
          ) : null}
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
