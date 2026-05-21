'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { AddEndpointModal } from '@/components/providers/add-endpoint-modal';
import { ConflictResolutionDialog } from '@/components/providers/conflict-resolution-dialog';
import { type EndpointRow, EndpointTable } from '@/components/providers/endpoint-table';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { Button } from '@/components/ui/button';
import { useProvidersHealth } from '@/hooks/use-providers-health';

interface ConflictEventDetail {
  yourEdit: string;
  onDiskYaml: string;
}

/**
 * Providers page — endpoint table + Add modal + conflict dialog. Listens for
 * `'provider-conflict'` window events dispatched by `AddEndpointModal` on 409
 * and opens the resolution dialog.
 */
export default function ProvidersPage() {
  const t = useTranslations('providers');
  const health = useProvidersHealth();
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
  const boundRoles = React.useMemo(() => {
    return (health.data ?? [])
      .filter((h) => h.base_url && (h.unbound?.length ?? 0) === 0)
      .map((h) => h.role);
  }, [health.data]);
  const canAddEndpoint = boundRoles.length < 4;

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
            <div className="flex max-w-3xl flex-col gap-s-1">
              <h1 className="font-display text-2xl text-ink-primary">{t('page_title')}</h1>
              <p className="text-sm leading-relaxed text-ink-muted">{t('role_routing_note')}</p>
            </div>
            <div className="flex items-center gap-s-2">
              <Button
                type="button"
                variant="default"
                size="sm"
                aria-label={t('add_endpoint_button')}
                title={canAddEndpoint ? undefined : '核心角色都已绑定；要替换请点击表格里的编辑。'}
                disabled={!canAddEndpoint}
                onClick={() => setModalOpen(true)}
              >
                <Plus aria-hidden="true" className="h-4 w-4" />
                {t('add_endpoint_button')}
              </Button>
            </div>
          </header>

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
        </div>
      </main>

      <AddEndpointModal
        open={modalOpen}
        editingRole={editingRole}
        existingRoles={boundRoles}
        onClose={() => {
          setModalOpen(false);
          setEditingRole(null);
        }}
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
