'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import { DiffPane } from './diff-pane';

export interface ConflictResolutionDialogProps {
  open: boolean;
  onClose: () => void;
  yourEdit: string;
  onDiskYaml: string;
  onAcceptOnDisk: () => void;
  onForceWrite: () => void;
  onSaveMerged: (merged: string) => void;
}

/**
 * Three-pane conflict-resolution dialog for ADR-010 v2 checksum mismatches.
 *
 * Layout: yours / on-disk / proposed-merged (editable).  Three actions in
 * the footer dispatch to the parent — the parent owns the actual save +
 * checksum refresh.
 */
export function ConflictResolutionDialog({
  open,
  onClose,
  yourEdit,
  onDiskYaml,
  onAcceptOnDisk,
  onForceWrite,
  onSaveMerged,
}: ConflictResolutionDialogProps) {
  const t = useTranslations('providersDialog');
  const [merged, setMerged] = React.useState<string>(yourEdit);

  React.useEffect(() => {
    setMerged(yourEdit);
  }, [yourEdit]);

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent aria-label={t('drift_title')} className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{t('drift_title')}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-s-3 md:grid-cols-3">
          <DiffPane title={t('your_edit_label')} yaml={yourEdit} />
          <DiffPane title={t('on_disk_label')} yaml={onDiskYaml} compareTo={yourEdit} />
          <DiffPane title={t('proposed_label')} yaml={merged} editable onChange={setMerged} />
        </div>
        <footer className="flex flex-wrap items-center justify-end gap-s-2 pt-s-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t('use_on_disk_button')}
            onClick={onAcceptOnDisk}
          >
            {t('use_on_disk_button')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={t('force_your_edit_button')}
            onClick={onForceWrite}
          >
            {t('force_your_edit_button')}
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            aria-label={t('save_merged_button')}
            onClick={() => onSaveMerged(merged)}
          >
            {t('save_merged_button')}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
