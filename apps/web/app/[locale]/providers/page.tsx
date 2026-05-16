'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { AddEndpointModal } from '@/components/providers/add-endpoint-modal';
import { ConflictResolutionDialog } from '@/components/providers/conflict-resolution-dialog';
import { type EndpointRow, EndpointTable } from '@/components/providers/endpoint-table';
import { type SankeyFlow, SankeyRouting } from '@/components/providers/sankey-routing';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { Button } from '@/components/ui/button';
import { useProvidersHealth } from '@/hooks/use-providers-health';

interface ConflictEventDetail {
  yourEdit: string;
  onDiskYaml: string;
}

/**
 * Providers hero page — Sankey + endpoint table + Add modal + conflict dialog
 * + YAML toggle.  Listens for `'provider-conflict'` window events dispatched
 * by `AddEndpointModal` on 409 and opens the resolution dialog.
 */
export default function ProvidersPage() {
  const t = useTranslations('providers');
  const tab = useTranslations('providersDialog');
  const health = useProvidersHealth();
  const [view, setView] = React.useState<'visual' | 'yaml'>('visual');
  const [modalOpen, setModalOpen] = React.useState(false);
  const [editingRole, setEditingRole] = React.useState<string | null>(null);
  const [conflict, setConflict] = React.useState<ConflictEventDetail | null>(null);

  React.useEffect(() => {
    const handle = (e: Event) => {
      const ce = e as CustomEvent<ConflictEventDetail>;
      if (ce.detail) setConflict(ce.detail);
    };
    window.addEventListener('provider-conflict', handle);
    return () => window.removeEventListener('provider-conflict', handle);
  }, []);

  const endpoints: EndpointRow[] = React.useMemo(() => {
    return (health.data ?? []).map((h) => ({
      endpoint_id: h.endpoint_id,
      role: h.role,
      base_url: h.base_url,
    }));
  }, [health.data]);

  const flows: SankeyFlow[] = React.useMemo(() => {
    return (health.data ?? [])
      .filter((h) => !h.unbound || h.unbound.length === 0)
      .map((h) => ({
        role: h.role,
        endpoint_id: h.endpoint_id,
        latency_ms: h.latency_ms,
      }));
  }, [health.data]);

  const unbound: string[] = React.useMemo(() => {
    const set = new Set<string>();
    for (const h of health.data ?? []) {
      if (h.unbound) {
        for (const r of h.unbound) set.add(r);
      }
    }
    // Allow ?force_unbound=role override (for visual-regression / e2e flag).
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      const force = sp.get('force_unbound');
      if (force) {
        for (const r of force.split(',')) set.add(r.trim());
      }
    }
    return [...set];
  }, [health.data]);

  // Live YAML view — sourced from /api/providers/summary fetch on demand.
  const [yamlText, setYamlText] = React.useState<string>('');
  React.useEffect(() => {
    if (view !== 'yaml') return;
    const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';
    fetch(`${baseUrl}/api/providers/summary`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => setYamlText(JSON.stringify(data, null, 2)))
      .catch(() => setYamlText('# unable to load config.yaml'));
  }, [view]);

  return (
    <div className="grid h-screen grid-cols-[240px_1fr] grid-rows-[64px_1fr] bg-ink-base">
      <div className="row-span-2">
        <Sidebar />
      </div>
      <div className="col-start-2">
        <Topbar />
      </div>
      <main className="col-start-2 row-start-2 overflow-auto p-s-6">
        <div className="flex flex-col gap-s-5">
          <header className="flex items-center justify-between gap-s-3">
            <h1 className="font-display text-2xl text-ink-primary">{t('page_title')}</h1>
            <div className="flex items-center gap-s-2">
              <div
                role="tablist"
                aria-label={t('view_yaml_toggle')}
                className="inline-flex rounded-input border border-border-subtle bg-surface-02"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === 'visual'}
                  aria-label="Visual view"
                  onClick={() => setView('visual')}
                  className={`px-s-3 py-s-1 text-xs ${view === 'visual' ? 'bg-surface-03 text-ink-primary' : 'text-ink-muted'}`}
                >
                  Visual
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === 'yaml'}
                  aria-label={t('view_yaml_toggle')}
                  onClick={() => setView('yaml')}
                  className={`px-s-3 py-s-1 text-xs ${view === 'yaml' ? 'bg-surface-03 text-ink-primary' : 'text-ink-muted'}`}
                >
                  YAML
                </button>
              </div>
              <Button
                type="button"
                variant="default"
                size="sm"
                aria-label={t('add_endpoint_button')}
                onClick={() => setModalOpen(true)}
              >
                <Plus aria-hidden="true" className="h-4 w-4" />
                {t('add_endpoint_button')}
              </Button>
            </div>
          </header>

          {view === 'visual' ? (
            <>
              <section
                aria-label={t('sankey_title')}
                className="rounded-card border border-border-subtle bg-surface-01 p-s-4"
              >
                <header className="flex items-baseline justify-between gap-s-2 pb-s-3">
                  <span className="font-display text-lg text-ink-primary">
                    {t('active_routing_label')}
                  </span>
                  <span className="font-mono text-xs text-ink-faint">role → endpoint</span>
                </header>
                <SankeyRouting flows={flows} unbound={unbound} />
              </section>
              <section
                aria-label="Endpoints"
                className="rounded-card border border-border-subtle bg-surface-01 p-s-4"
              >
                <EndpointTable
                  endpoints={endpoints}
                  health={health.data ?? []}
                  onEdit={(role) => {
                    setEditingRole(role);
                    setModalOpen(true);
                  }}
                />
              </section>
            </>
          ) : (
            <pre
              aria-label={tab('on_disk_label')}
              className="max-h-[640px] overflow-auto rounded-card border border-border-subtle bg-ink-base p-s-4 font-mono text-xs text-ink-secondary"
            >
              {yamlText || '…'}
            </pre>
          )}
        </div>
      </main>

      <AddEndpointModal
        open={modalOpen}
        editingRole={editingRole}
        onClose={() => {
          setModalOpen(false);
          setEditingRole(null);
        }}
        currentYaml={yamlText}
        currentSha=""
      />
      <ConflictResolutionDialog
        open={conflict !== null}
        onClose={() => setConflict(null)}
        yourEdit={conflict?.yourEdit ?? ''}
        onDiskYaml={conflict?.onDiskYaml ?? ''}
        onAcceptOnDisk={() => setConflict(null)}
        onForceWrite={() => setConflict(null)}
        onSaveMerged={() => setConflict(null)}
      />
    </div>
  );
}
