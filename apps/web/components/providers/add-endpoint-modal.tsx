'use client';

import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useProviderProbe } from '@/hooks/use-provider-probe';

export interface AddEndpointModalProps {
  open: boolean;
  onClose: () => void;
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

const ROLES = ['vision', 'llm', 'image', 'compliance_screen'];

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

function roleDescriptionKey(role: string): string {
  if (role === 'vision') return 'role_description_vision';
  if (role === 'llm') return 'role_description_llm';
  if (role === 'image') return 'role_description_image';
  if (role === 'compliance_screen') return 'role_description_compliance_screen';
  return 'role_description_custom';
}

interface EndpointStanza {
  protocol: Protocol;
  base_url: string;
  api_key_env: string;
  model: string;
}

async function fetchEndpoint(role: string, signal?: AbortSignal): Promise<EndpointStanza> {
  const response = await fetch(`${baseUrl}/api/providers/endpoints/${encodeURIComponent(role)}`, {
    cache: 'no-store',
    signal,
  });
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

async function postEndpoint(role: string, body: object): Promise<void> {
  const response = await fetch(`${baseUrl}/api/providers/endpoints/${encodeURIComponent(role)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let detail = `Create failed (${response.status})`;
    try {
      const payload = (await response.json()) as { detail?: unknown };
      if (typeof payload.detail === 'string') detail = payload.detail;
    } catch {
      // Keep the status-code fallback for non-JSON responses.
    }
    throw new Error(detail);
  }
}

export function AddEndpointModal({ open, onClose, editingRole }: AddEndpointModalProps) {
  const t = useTranslations('providers');
  const [form, setForm] = React.useState<FormState>(EMPTY);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const probe = useProviderProbe();
  const queryClient = useQueryClient();
  const isEdit = Boolean(editingRole);

  const probeReset = probe.reset;
  React.useEffect(() => {
    if (!open) {
      setForm(EMPTY);
      setSubmitError(null);
      setIsSubmitting(false);
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
    setIsSubmitting(true);
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
      } finally {
        setIsSubmitting(false);
      }
      return;
    }
    try {
      await postEndpoint(form.role, {
        protocol: form.protocol,
        base_url: form.base_url,
        model: form.model,
        name: form.name || form.role,
        api_key: form.api_key,
      });
      await queryClient.invalidateQueries({ queryKey: ['providers', 'health'] });
      onClose();
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setIsSubmitting(false);
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
            <span className="leading-relaxed text-ink-faint">
              {t(roleDescriptionKey(form.role))}
            </span>
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
          <div className="flex items-center justify-end gap-s-2 pt-s-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose} aria-label="Cancel">
              Cancel
            </Button>
            <Button
              type="submit"
              variant="default"
              size="sm"
              disabled={isSubmitting}
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
