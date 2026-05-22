'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { EditorActiveTool, EditorLayerSummary, MaskBox } from '@/lib/editor/types';
import { cn } from '@/lib/utils';

export interface ToolOptionsPanelProps {
  activeTool: EditorActiveTool;
  selectedLayer: EditorLayerSummary | null;
  maskBox: MaskBox | null;
  inpaintStatus: 'idle' | 'streaming' | 'success' | 'error' | 'aborted';
  onInpaintStart: () => void;
  onInpaintAbort: () => void;
}

export function ToolOptionsPanel({
  activeTool,
  selectedLayer,
  maskBox,
  inpaintStatus,
  onInpaintStart,
  onInpaintAbort,
}: ToolOptionsPanelProps) {
  const t = useTranslations('editor.properties');
  const isStreaming = inpaintStatus === 'streaming';
  const canStartInpaint = activeTool === 'inpaint' && maskBox !== null && !isStreaming;

  return (
    <aside
      data-testid="editor-tool-options"
      className="rounded-card border border-border-subtle bg-surface-02"
    >
      <div className="border-b border-border-subtle px-s-3 py-s-2">
        <h2 className="font-display text-sm text-ink-primary">{t('title')}</h2>
        <p className="text-xs text-ink-faint">{t('activeTool', { tool: activeTool ?? 'none' })}</p>
      </div>
      <div className="space-y-s-3 p-s-3 text-xs text-ink-secondary">
        <section className="space-y-1">
          <h3 className="font-medium text-ink-primary">{t('selection.title')}</h3>
          {selectedLayer ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-s-2 gap-y-1">
              <dt className="text-ink-faint">{t('selection.layer')}</dt>
              <dd className="truncate text-ink-secondary">{selectedLayer.label}</dd>
              <dt className="text-ink-faint">{t('selection.kind')}</dt>
              <dd className="text-ink-secondary">{t(`kind.${selectedLayer.kind}`)}</dd>
              <dt className="text-ink-faint">{t('selection.state')}</dt>
              <dd className="text-ink-secondary">
                {selectedLayer.locked ? t('selection.locked') : t('selection.editable')}
              </dd>
            </dl>
          ) : (
            <p className="text-ink-faint">{t('selection.empty')}</p>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="font-medium text-ink-primary">{t('inpaint.title')}</h3>
          <p className="text-ink-faint">
            {maskBox
              ? t('inpaint.maskReady', {
                  width: Math.round(maskBox.w),
                  height: Math.round(maskBox.h),
                })
              : t('inpaint.drawMask')}
          </p>
          {inpaintStatus !== 'idle' && (
            <p
              className={cn(
                'rounded-input px-s-2 py-s-1',
                inpaintStatus === 'error'
                  ? 'bg-danger/10 text-danger'
                  : 'bg-accent-wash text-accent'
              )}
              data-status={inpaintStatus}
            >
              {t(`inpaint.status.${inpaintStatus}`)}
            </p>
          )}
          <div className="flex gap-s-2">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-input bg-accent px-s-3 py-s-1 text-ink-base-l transition-colors hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canStartInpaint}
              onClick={onInpaintStart}
            >
              {isStreaming && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t('inpaint.start')}
            </button>
            <button
              type="button"
              className="rounded-input border border-border-subtle px-s-3 py-s-1 text-ink-secondary transition-colors hover:border-border-strong hover:text-ink-primary disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!isStreaming}
              onClick={onInpaintAbort}
            >
              {t('inpaint.cancel')}
            </button>
          </div>
        </section>
      </div>
    </aside>
  );
}
