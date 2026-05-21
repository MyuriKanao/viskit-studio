'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { StatusChip } from '@/components/atoms/status-chip';
import { providerRoleDescriptionKey } from '@/components/providers/role-descriptions';
import { Button } from '@/components/ui/button';
import type { ProviderHealthRow } from '@/hooks/use-providers-health';
import { cn } from '@/lib/utils';

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

// Mirrors REQUIRED_ROLES in services/providers/registry.py — these cannot be
// deleted because the registry refuses to boot if any is absent (ADR-005).
const REQUIRED_ROLES = new Set(['vision', 'llm', 'image', 'compliance_screen']);

export interface EndpointRow {
  endpoint_id: string;
  role: string;
  base_url: string | null;
}

export interface EndpointTableProps {
  endpoints: EndpointRow[];
  health: ProviderHealthRow[];
  onEdit?: (role: string) => void;
  className?: string;
}

type StatusKind = 'ok' | 'warn' | 'error' | 'pending';

type ProbeRow = {
  role: string;
  ok: boolean;
  latency_ms: number;
  models: string[];
  error: string | null;
};

async function probeRole(role: string): Promise<ProbeRow> {
  const response = await fetch(`${baseUrl}/api/providers/models?role=${encodeURIComponent(role)}`, {
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Test call failed (${response.status})`);
  const body = (await response.json()) as { rows: ProbeRow[] };
  const row = body.rows[0];
  if (!row) throw new Error('Test call returned no result');
  return row;
}

function statusKind(s: ProviderHealthRow['status']): StatusKind {
  if (s === 'ok') return 'ok';
  if (s === 'warn') return 'warn';
  if (s === 'error') return 'error';
  return 'pending';
}

export function EndpointTable({ endpoints, health, onEdit, className }: EndpointTableProps) {
  const t = useTranslations('providers');
  const queryClient = useQueryClient();
  const [pendingRole, setPendingRole] = React.useState<string | null>(null);
  const [probeByRole, setProbeByRole] = React.useState<Map<string, ProbeRow>>(() => new Map());
  const probe = useMutation({
    mutationFn: probeRole,
    onSuccess: (row) => {
      setProbeByRole((previous) => {
        const next = new Map(previous);
        next.set(row.role, row);
        return next;
      });
    },
  });
  const healthByRole = React.useMemo(() => {
    const map = new Map<string, ProviderHealthRow>();
    for (const h of health) map.set(h.role, h);
    return map;
  }, [health]);
  const statusLabelFor: Record<StatusKind, string> = {
    ok: t('health_status_healthy'),
    warn: t('health_status_degraded'),
    error: t('health_status_down'),
    pending: t('health_status_unknown'),
  };

  const [error, setError] = React.useState<string | null>(null);
  const handleDelete = async (role: string) => {
    if (!window.confirm(`删除 ${role} 端点？`)) return;
    setPendingRole(role);
    setError(null);
    try {
      const response = await fetch(
        `${baseUrl}/api/providers/endpoints/${encodeURIComponent(role)}`,
        { method: 'DELETE' }
      );
      if (!response.ok) {
        let detail = `Delete failed (${response.status})`;
        try {
          const body = (await response.json()) as { detail?: unknown };
          if (typeof body.detail === 'string') detail = body.detail;
        } catch {
          // non-JSON body — keep the status-code fallback
        }
        throw new Error(detail);
      }
      const body = (await response.json()) as { registry_rebooted?: boolean; warning?: string };
      if (body.registry_rebooted === false && body.warning) {
        setError(`已保存但 registry 未刷新: ${body.warning}`);
      }
      await queryClient.invalidateQueries({ queryKey: ['providers', 'health'] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPendingRole(null);
    }
  };

  return (
    <>
      {error ? (
        <p className="mb-s-2 font-mono text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <table
          aria-label={t('page_title')}
          className={cn(
            'min-w-[760px] w-full border-collapse text-sm text-ink-secondary',
            className
          )}
        >
          <thead>
            <tr className="border-b border-border-subtle text-xs uppercase tracking-wider text-ink-faint">
              <th className="px-s-3 py-s-2 text-left font-medium">{t('table_col_role')}</th>
              <th className="px-s-3 py-s-2 text-left font-medium">{t('table_col_name')}</th>
              <th className="px-s-3 py-s-2 text-left font-medium">URL</th>
              <th className="px-s-3 py-s-2 text-left font-medium">{t('table_col_status')}</th>
              <th className="px-s-3 py-s-2 text-right font-medium">{t('table_col_latency')}</th>
              <th className="px-s-3 py-s-2 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {endpoints.map((row) => {
              const h = healthByRole.get(row.role);
              const probeRow = probeByRole.get(row.role);
              const isTesting = probe.isPending && probe.variables === row.role;
              const testError =
                probe.isError && probe.variables === row.role ? probe.error.message : null;
              const kind = testError
                ? 'error'
                : probeRow
                  ? probeRow.ok
                    ? 'ok'
                    : 'error'
                  : statusKind(h?.status ?? null);
              const latencyMs = probeRow ? probeRow.latency_ms : h?.latency_ms;
              const isUnbound = (h?.unbound?.length ?? 0) > 0;
              const isRequired = REQUIRED_ROLES.has(row.role);
              return (
                <tr key={`${row.role}-${row.endpoint_id}`} className="border-b border-border-hair">
                  <td className="px-s-3 py-s-2">
                    <div className="flex max-w-[240px] flex-col gap-1">
                      <span className="font-mono text-xs text-ink-secondary">{row.role}</span>
                      <span className="text-xs leading-relaxed text-ink-faint">
                        {t(providerRoleDescriptionKey(row.role))}
                      </span>
                    </div>
                  </td>
                  <td className="px-s-3 py-s-2 text-ink-primary">{row.endpoint_id}</td>
                  <td className="px-s-3 py-s-2 font-mono text-xs text-ink-muted">
                    {row.base_url ?? '—'}
                  </td>
                  <td className="px-s-3 py-s-2">
                    <div className="flex flex-col items-start gap-s-1">
                      <StatusChip
                        status={kind}
                        label={isTesting ? '测试中' : statusLabelFor[kind]}
                      />
                      {testError || (probeRow && !probeRow.ok) ? (
                        <span className="font-mono text-xs text-danger">
                          {testError ?? probeRow?.error ?? 'unknown'}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-s-3 py-s-2 text-right font-mono text-xs text-ink-muted">
                    {latencyMs != null ? `${latencyMs} ms` : '—'}
                  </td>
                  <td className="px-s-3 py-s-2 text-right">
                    {isUnbound ? (
                      <span className="font-mono text-xs text-ink-faint">未绑定</span>
                    ) : (
                      <div className="flex justify-end gap-s-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={isTesting}
                          onClick={() => probe.mutate(row.role)}
                          aria-label={`Test ${row.role}`}
                        >
                          {isTesting ? '测试中…' : '测试调用'}
                        </Button>
                        {onEdit ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => onEdit(row.role)}
                            aria-label={`Edit ${row.role}`}
                          >
                            编辑
                          </Button>
                        ) : null}
                        {!isRequired ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={pendingRole === row.role}
                            onClick={() => handleDelete(row.role)}
                            aria-label={`Delete ${row.role}`}
                          >
                            {pendingRole === row.role ? '删除中…' : '删除'}
                          </Button>
                        ) : null}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
