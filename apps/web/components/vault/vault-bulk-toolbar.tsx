'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { useVaultTags } from '@/hooks/use-vault-tags';
import type { TagApplyResponse } from '@/hooks/use-vault-tags-apply';
import { useVaultTagsApply } from '@/hooks/use-vault-tags-apply';

import { TagCombobox } from './tag-combobox';

/**
 * VaultBulkToolbar — fixed bottom-center toolbar for batch tag operations.
 *
 * Lazy-mounted only when selection.size > 0 (parent controls mount).
 * Owns useVaultTags + useVaultTagsApply in this lazy chunk so neither hook
 * inflates the /vault First Load JS beyond the 170 kB budget.
 *
 * The parent provides selection and an onApply callback that receives the
 * action, tags, and the resolved TagApplyResponse for toast rendering.
 */

export type { TagApplyResponse };

export interface VaultBulkToolbarProps {
  selection: Set<number>;
  onClear: () => void;
  /**
   * Called after a successful mutation. Parent uses the response to render
   * the correct success toast (with noop breakdown or pure insert).
   * Also called with action + tags for test assertions.
   */
  onApply: (action: 'add' | 'remove', tags: string[], resp: TagApplyResponse) => void;
}

export function VaultBulkToolbar({ selection, onClear, onApply }: VaultBulkToolbarProps) {
  const t = useTranslations('vault.bulk');
  const [tags, setTags] = React.useState<string[]>([]);
  const [pending, setPending] = React.useState<'add' | 'remove' | null>(null);

  const tagsQuery = useVaultTags();
  const tagsApply = useVaultTagsApply();

  async function handleApply(action: 'add' | 'remove') {
    if (tags.length === 0) return;
    setPending(action);
    try {
      const resp = await tagsApply.mutateAsync({
        action,
        tags,
        asset_ids: Array.from(selection),
      });
      onApply(action, tags, resp);
      setTags([]);
    } finally {
      setPending(null);
    }
  }

  return (
    <div
      role="toolbar"
      aria-label="Bulk tag actions"
      className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-card border border-border-subtle bg-surface-02 px-4 py-3 shadow-lift"
    >
      <span className="text-sm font-medium text-ink-primary">
        {t('selection_count', { count: selection.size })}
      </span>

      <TagCombobox value={tags} onChange={setTags} suggestions={tagsQuery.data ?? []} />

      <button
        type="button"
        disabled={tags.length === 0 || pending !== null}
        onClick={() => void handleApply('add')}
        className="rounded-input bg-accent px-3 py-1.5 text-sm text-ink-on-accent disabled:opacity-40"
      >
        {pending === 'add' ? '…' : t('action_add')}
      </button>

      <button
        type="button"
        disabled={tags.length === 0 || pending !== null}
        onClick={() => void handleApply('remove')}
        className="rounded-input border border-border-subtle bg-surface-01 px-3 py-1.5 text-sm text-ink-primary disabled:opacity-40"
      >
        {pending === 'remove' ? '…' : t('action_remove')}
      </button>

      <button
        type="button"
        onClick={onClear}
        className="rounded-input border border-border-subtle bg-surface-01 px-3 py-1.5 text-sm text-ink-muted"
      >
        {t('clear_selection')}
      </button>
    </div>
  );
}
