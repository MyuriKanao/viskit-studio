'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { providerRoleDescriptionKey } from '@/components/providers/role-descriptions';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useProviderProbe } from '@/hooks/use-provider-probe';

export interface AddEndpointModalProps {
  open: boolean;
  onClose: () => void;
  /** When set, modal opens in edit mode and pre-fills from GET /endpoints/{role}. */
  editingRole?: string | null;
  existingRoles?: string[];
}

const PROTOCOLS = ['openai_compatible', 'anthropic_compatible', 'image_generation'] as const;
type Protocol = (typeof PROTOCOLS)[number];
const ROLES = ['vision', 'llm', 'image', 'compliance_screen'] as const;
const IMAGE_ADAPTERS = [
  {
    value: 'gemini',
    label: 'Gemini 原生',
    description: 'Google Gemini 原生生图接口，适合直接接 Gemini 图片模型。',
  },
  {
    value: 'gemini_openai',
    label: 'Gemini OpenAI 兼容',
    description: '用 OpenAI 兼容格式调用 Gemini，适合中转网关或兼容服务。',
  },
  {
    value: 'openai',
    label: 'OpenAI Images',
    description: 'OpenAI 图片接口，适合 DALL·E / GPT Image 类模型。',
  },
  {
    value: 'chatgpt2api',
    label: 'chatgpt2api',
    description: 'chatgpt2api 图片接口，适合自建或第三方转发服务。',
  },
  {
    value: 'volcengine_ark',
    label: '火山方舟 Seedream',
    description: '火山方舟图片接口，适合 Seedream 系列模型。',
  },
  {
    value: 'z_image_gitee',
    label: 'Gitee AI Z-Image',
    description: 'Gitee AI 的 Z-Image 生图接口，当前按文生图接入。',
  },
  {
    value: 'jimeng2api',
    label: 'jimeng2api',
    description: '即梦兼容接口，适合 jimeng-api 服务。',
  },
  {
    value: 'grok',
    label: 'xAI Grok Images',
    description: 'xAI 图片接口，适合 Grok Imagine 图片模型。',
  },
  {
    value: 'siliconflow_adapter',
    label: 'SiliconFlow',
    description: '硅基流动图片接口，适合 Kolors、Qwen-Image、Z-Image 等模型。',
  },
] as const;

interface FormState {
  role: string;
  protocol: Protocol;
  adapter: string;
  api_key_env: string;
  name: string;
  base_url: string;
  api_key: string;
  model: string;
}

const EMPTY: FormState = {
  role: 'llm',
  protocol: 'openai_compatible',
  adapter: 'openai',
  api_key_env: '',
  name: '',
  base_url: '',
  api_key: '',
  model: '',
};

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

function imageAdapterInfo(adapter: string): (typeof IMAGE_ADAPTERS)[number] {
  return IMAGE_ADAPTERS.find((item) => item.value === adapter) ?? IMAGE_ADAPTERS[2];
}

function protocolOptionsForRole(role: string): Protocol[] {
  if (role === 'image') return ['image_generation', 'openai_compatible'];
  if (role === 'vision' || role === 'llm' || role === 'compliance_screen') {
    return ['openai_compatible', 'anthropic_compatible'];
  }
  return [...PROTOCOLS];
}

function defaultProtocolForRole(role: string): Protocol {
  return protocolOptionsForRole(role)[0];
}

function normaliseProviderBaseUrl(protocol: Protocol, adapter: string, value: string): string {
  const base = value.trim().replace(/\/+$/, '');
  const lower = base.toLowerCase();
  if (
    (protocol === 'openai_compatible' || protocol === 'anthropic_compatible') &&
    lower.endsWith('/v1')
  ) {
    return base.slice(0, -3);
  }
  if (protocol === 'image_generation') {
    if (adapter === 'gemini' && lower.endsWith('/v1beta')) {
      return base.slice(0, -7);
    }
    if (adapter === 'volcengine_ark') {
      if (lower.endsWith('/api/v3/images/generations')) {
        return base.slice(0, -'/api/v3/images/generations'.length);
      }
      if (lower.endsWith('/api/v3')) {
        return base.slice(0, -'/api/v3'.length);
      }
    }
    if (adapter !== 'gemini' && lower.endsWith('/v1')) {
      return base.slice(0, -3);
    }
  }
  return base;
}

interface EndpointStanza {
  protocol: Protocol;
  base_url: string;
  api_key_env: string;
  model: string;
  adapter?: string | null;
}

interface EndpointSecretResponse {
  api_key: string;
}

async function fetchEndpoint(role: string, signal?: AbortSignal): Promise<EndpointStanza> {
  const response = await fetch(`${baseUrl}/api/providers/endpoints/${encodeURIComponent(role)}`, {
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw new Error(`Read endpoint failed (${response.status})`);
  return (await response.json()) as EndpointStanza;
}

async function fetchEndpointSecret(role: string): Promise<EndpointSecretResponse> {
  const response = await fetch(
    `${baseUrl}/api/providers/endpoints/${encodeURIComponent(role)}/secret`,
    { cache: 'no-store' }
  );
  if (!response.ok) throw new Error(`Read saved key failed (${response.status})`);
  return (await response.json()) as EndpointSecretResponse;
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

export function AddEndpointModal({
  open,
  onClose,
  editingRole,
  existingRoles = [],
}: AddEndpointModalProps) {
  const t = useTranslations('providers');
  const [form, setForm] = React.useState<FormState>(EMPTY);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [secretError, setSecretError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isLoadingSecret, setIsLoadingSecret] = React.useState(false);
  const [showApiKey, setShowApiKey] = React.useState(false);
  const probe = useProviderProbe();
  const queryClient = useQueryClient();
  const isEdit = Boolean(editingRole);
  const existingRoleSet = React.useMemo(() => new Set(existingRoles), [existingRoles]);
  const availableRoles = React.useMemo(
    () => (isEdit ? [...ROLES] : ROLES.filter((role) => !existingRoleSet.has(role))),
    [existingRoleSet, isEdit]
  );

  const probeReset = probe.reset;
  React.useEffect(() => {
    if (!open) {
      setForm(EMPTY);
      setSubmitError(null);
      setSecretError(null);
      setIsSubmitting(false);
      setIsLoadingSecret(false);
      setShowApiKey(false);
      probeReset();
      return;
    }
    if (!editingRole) {
      const role = availableRoles[0] ?? 'image';
      setForm({
        ...EMPTY,
        role,
        protocol: defaultProtocolForRole(role),
        name: role,
      });
      setSubmitError(null);
      probeReset();
    }
    setSecretError(null);
    setIsLoadingSecret(false);
    setShowApiKey(false);
    if (!editingRole) return;
    const controller = new AbortController();
    fetchEndpoint(editingRole, controller.signal)
      .then((stanza) => {
        const adapter = stanza.adapter ?? 'openai';
        setForm({
          role: editingRole,
          protocol: stanza.protocol,
          adapter,
          api_key_env: stanza.api_key_env,
          name: editingRole,
          base_url: normaliseProviderBaseUrl(stanza.protocol, adapter, stanza.base_url),
          api_key: '',
          model: stanza.model,
        });
      })
      .catch((err: unknown) => {
        if ((err as { name?: string }).name === 'AbortError') return;
        setSubmitError((err as Error).message);
      });
    return () => controller.abort();
  }, [open, editingRole, availableRoles, probeReset]);

  const handleApiKeyToggle = async () => {
    if (showApiKey) {
      setShowApiKey(false);
      return;
    }
    setSecretError(null);
    if (isEdit && editingRole && !form.api_key && form.api_key_env) {
      setIsLoadingSecret(true);
      try {
        const secret = await fetchEndpointSecret(editingRole);
        setForm((s) => ({ ...s, api_key: secret.api_key }));
      } catch (err) {
        setSecretError((err as Error).message);
        return;
      } finally {
        setIsLoadingSecret(false);
      }
    }
    setShowApiKey(true);
  };

  const setField =
    <K extends keyof FormState>(k: K) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((s) => {
        if (k === 'role') {
          const nextRole = e.target.value;
          const allowed = protocolOptionsForRole(nextRole);
          const nextProtocol = allowed.includes(s.protocol) ? s.protocol : allowed[0];
          probe.reset();
          return {
            ...s,
            role: nextRole,
            protocol: nextProtocol,
            adapter: nextProtocol === 'image_generation' ? s.adapter : 'openai',
            name: !s.name || s.name === s.role ? nextRole : s.name,
            model: '',
          };
        }
        // Re-probing is required whenever the probe inputs change.
        if (k === 'protocol' || k === 'adapter' || k === 'base_url' || k === 'api_key') {
          probe.reset();
          return { ...s, [k]: e.target.value, model: '' };
        }
        return { ...s, [k]: e.target.value };
      });

  const handleProbe = async () => {
    const inlineApiKey = form.api_key.trim();
    const result = await probe.mutateAsync({
      protocol: form.protocol,
      adapter: form.protocol === 'image_generation' ? form.adapter : undefined,
      base_url: normaliseProviderBaseUrl(form.protocol, form.adapter, form.base_url),
      api_key: inlineApiKey || undefined,
      api_key_env: inlineApiKey ? undefined : form.api_key_env || undefined,
    });
    if (result.ok && result.models.length > 0) {
      setForm((s) => ({
        ...s,
        model: result.models.includes(s.model) ? s.model : result.models[0],
      }));
    }
  };

  const canProbe =
    Boolean(form.base_url && (form.api_key.trim() || form.api_key_env)) && !probe.isPending;
  const roleProtocolOptions = protocolOptionsForRole(form.role);
  const isRoleProtocolValid = roleProtocolOptions.includes(form.protocol);
  const roleAlreadyExists = !isEdit && existingRoleSet.has(form.role);
  const hasAvailableRole = isEdit || availableRoles.length > 0;
  const probedModels = probe.data?.ok ? probe.data.models : [];
  const modelOptions = React.useMemo(() => {
    const values = new Set<string>();
    if (form.model) values.add(form.model);
    for (const model of probedModels) values.add(model);
    return Array.from(values);
  }, [form.model, probedModels]);
  const selectedImageAdapter = imageAdapterInfo(form.adapter);
  const apiKeyToggleLabel = isLoadingSecret
    ? '读取 API Key'
    : showApiKey
      ? '隐藏 API Key'
      : '显示 API Key';

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitError(null);
    if (!hasAvailableRole) {
      setSubmitError('核心角色都已绑定。要替换 chatgpt2api，请在表格里编辑 image 角色。');
      return;
    }
    if (roleAlreadyExists) {
      setSubmitError(`角色 ${form.role} 已存在。要替换请在表格里点击该角色的编辑按钮。`);
      return;
    }
    if (!isRoleProtocolValid) {
      setSubmitError(
        form.role === 'image'
          ? 'image 角色只能选择 image_generation 或 openai_compatible。'
          : `${form.role} 角色不能选择 image_generation，请改用 openai_compatible 或 anthropic_compatible。`
      );
      return;
    }
    setIsSubmitting(true);
    if (isEdit && editingRole) {
      try {
        await putEndpoint(editingRole, {
          protocol: form.protocol,
          adapter: form.protocol === 'image_generation' ? form.adapter : undefined,
          base_url: normaliseProviderBaseUrl(form.protocol, form.adapter, form.base_url),
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
        adapter: form.protocol === 'image_generation' ? form.adapter : undefined,
        base_url: normaliseProviderBaseUrl(form.protocol, form.adapter, form.base_url),
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
              disabled={isEdit || !hasAvailableRole}
              className="rounded-input border border-border-subtle bg-surface-02 px-s-3 py-s-2 text-sm text-ink-primary"
            >
              {(hasAvailableRole ? availableRoles : ROLES).map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <span className="leading-relaxed text-ink-faint">
              {hasAvailableRole
                ? t(providerRoleDescriptionKey(form.role))
                : '核心角色都已绑定。要替换 chatgpt2api，请在表格里编辑 image 角色。'}
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
              {roleProtocolOptions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          {form.protocol === 'image_generation' ? (
            <label
              className="flex flex-col gap-s-1 text-xs text-ink-muted"
              htmlFor="endpoint-image-adapter"
            >
              <span className="font-mono uppercase tracking-wider text-ink-faint">
                Image Adapter
              </span>
              <select
                id="endpoint-image-adapter"
                aria-label="Image Adapter"
                value={form.adapter}
                onChange={setField('adapter')}
                className="rounded-input border border-border-subtle bg-surface-02 px-s-3 py-s-2 font-mono text-sm text-ink-primary"
              >
                {IMAGE_ADAPTERS.map((adapter) => (
                  <option key={adapter.value} value={adapter.value}>
                    {adapter.label} · {adapter.value}
                  </option>
                ))}
              </select>
              <span className="leading-relaxed text-ink-faint">
                {selectedImageAdapter.description}
              </span>
            </label>
          ) : null}
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
              onBlur={() =>
                setForm((s) => ({
                  ...s,
                  base_url: normaliseProviderBaseUrl(s.protocol, s.adapter, s.base_url),
                }))
              }
              required
              className="rounded-input border border-border-subtle bg-surface-02 px-s-3 py-s-2 font-mono text-sm text-ink-primary"
            />
          </label>
          <div className="flex flex-col gap-s-1 text-xs text-ink-muted">
            <label
              className="font-mono uppercase tracking-wider text-ink-faint"
              htmlFor="endpoint-api-key"
            >
              API Key
            </label>
            <div className="relative">
              <input
                id="endpoint-api-key"
                type={showApiKey ? 'text' : 'password'}
                aria-label="API Key"
                value={form.api_key}
                onChange={setField('api_key')}
                required={!isEdit}
                autoComplete="off"
                placeholder={isEdit ? '留空保持现有 key' : undefined}
                className="w-full rounded-input border border-border-subtle bg-surface-02 px-s-3 py-s-2 pr-s-8 font-mono text-sm text-ink-primary"
              />
              <button
                type="button"
                aria-label={apiKeyToggleLabel}
                title={apiKeyToggleLabel}
                onClick={handleApiKeyToggle}
                disabled={isLoadingSecret}
                className="absolute right-s-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-input text-ink-faint transition-colors duration-fast hover:text-ink-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                {isLoadingSecret ? (
                  <RefreshCw aria-hidden="true" className="h-4 w-4 animate-spin" />
                ) : showApiKey ? (
                  <EyeOff aria-hidden="true" className="h-4 w-4" />
                ) : (
                  <Eye aria-hidden="true" className="h-4 w-4" />
                )}
              </button>
            </div>
            {isEdit && !form.api_key ? (
              <span className="leading-relaxed text-ink-faint">
                留空使用已保存 key，刷新模型也会使用已保存 key。
              </span>
            ) : null}
            {secretError ? (
              <span className="font-mono text-xs text-danger" role="alert">
                读取保存的 key 失败：{secretError}
              </span>
            ) : null}
          </div>
          <div className="flex flex-col gap-s-1 text-xs text-ink-muted">
            <span className="font-mono uppercase tracking-wider text-ink-faint">
              {t('table_col_model')}
            </span>
            <div className="flex items-stretch gap-s-2">
              {probedModels.length > 0 ? (
                <select
                  id="endpoint-model"
                  aria-label={t('table_col_model')}
                  value={form.model}
                  onChange={setField('model')}
                  required
                  className="flex-1 rounded-input border border-border-subtle bg-surface-02 px-s-3 py-s-2 font-mono text-sm text-ink-primary"
                >
                  {modelOptions.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id="endpoint-model"
                  type="text"
                  aria-label={t('table_col_model')}
                  value={form.model}
                  onChange={setField('model')}
                  required
                  autoComplete="off"
                  className="flex-1 rounded-input border border-border-subtle bg-surface-02 px-s-3 py-s-2 font-mono text-sm text-ink-primary"
                />
              )}
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
              disabled={
                isSubmitting || !hasAvailableRole || roleAlreadyExists || !isRoleProtocolValid
              }
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
