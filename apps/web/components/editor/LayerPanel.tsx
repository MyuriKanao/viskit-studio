'use client';

import { ArrowDown, ArrowUp, Eye, EyeOff, Lock, Trash2, Unlock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { KeyboardEvent } from 'react';

import type { EditorLayerSummary } from '@/lib/editor/types';
import { cn } from '@/lib/utils';

export interface LayerPanelProps {
  layers: EditorLayerSummary[];
  selectedLayerId: string | null;
  onSelectLayer: (layerId: string) => void;
  onToggleVisibility: (layerId: string, visible: boolean) => void;
  onToggleLocked: (layerId: string, locked: boolean) => void;
  onMoveLayer: (layerId: string, direction: 'up' | 'down') => void;
  onDeleteLayer: (layerId: string) => void;
  onChangeOpacity: (layerId: string, opacity: number) => void;
}

const KIND_BADGE_CLASSES: Record<EditorLayerSummary['kind'], string> = {
  'base-image': 'border-border-subtle text-ink-muted',
  'fabric-object': 'border-border-subtle text-ink-secondary',
  'inpaint-mask': 'border-accent/50 text-accent',
  'ocr-text': 'border-success/50 text-success',
};

export function LayerPanel({
  layers,
  selectedLayerId,
  onSelectLayer,
  onToggleVisibility,
  onToggleLocked,
  onMoveLayer,
  onDeleteLayer,
  onChangeOpacity,
}: LayerPanelProps) {
  const t = useTranslations('editor.layers');

  function handleLayerSelectKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    layer: EditorLayerSummary
  ) {
    if (layer.kind === 'base-image') return;

    if ((event.metaKey || event.ctrlKey) && event.key === 'ArrowUp') {
      event.preventDefault();
      onMoveLayer(layer.id, 'up');
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key === 'ArrowDown') {
      event.preventDefault();
      onMoveLayer(layer.id, 'down');
      return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      onDeleteLayer(layer.id);
    }
  }

  return (
    <aside
      data-testid="editor-layer-panel"
      className="flex min-h-0 flex-col rounded-card border border-border-subtle bg-surface-02"
    >
      <div className="border-b border-border-subtle px-s-3 py-s-2">
        <h2 className="font-display text-sm text-ink-primary">{t('title')}</h2>
        <p className="text-xs text-ink-faint">{t('subtitle', { count: layers.length })}</p>
      </div>
      <div aria-label={t('title')} className="min-h-0 flex-1 space-y-1 overflow-y-auto p-s-2">
        {layers.map((layer) => {
          const isBase = layer.kind === 'base-image';
          const isSelected = selectedLayerId === layer.id || layer.selected;
          const handleLayerKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
            if (isBase || event.target !== event.currentTarget) return;
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onSelectLayer(layer.id);
              return;
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              onMoveLayer(layer.id, 'up');
              return;
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              onMoveLayer(layer.id, 'down');
              return;
            }
            if (event.key === 'Delete' || event.key === 'Backspace') {
              event.preventDefault();
              onDeleteLayer(layer.id);
            }
          };
          return (
            <div
              key={layer.id}
              data-testid={`editor-layer-${layer.id}`}
              data-state={isSelected ? 'selected' : 'idle'}
              className={cn(
                'w-full rounded-input border px-s-2 py-s-2 text-left transition-colors',
                isSelected
                  ? 'border-accent bg-accent-wash'
                  : 'border-border-subtle bg-surface-01 hover:border-border-strong',
                isBase && 'cursor-default opacity-80'
              )}
            >
              <div className="flex items-center justify-between gap-s-2">
                <button
                  type="button"
                  data-testid={`editor-layer-${layer.id}-select`}
                  disabled={isBase}
                  aria-pressed={isSelected}
                  onClick={() => onSelectLayer(layer.id)}
                  onKeyDown={(event) => handleLayerSelectKeyDown(event, layer)}
                  className="min-w-0 flex-1 rounded-sm text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default"
                >
                  <p className="truncate text-xs font-medium text-ink-primary">{layer.label}</p>
                  <span
                    className={cn(
                      'mt-1 inline-flex rounded-full border px-1.5 py-0.5 text-[10px]',
                      KIND_BADGE_CLASSES[layer.kind]
                    )}
                  >
                    {t(`kind.${layer.kind}`)}
                  </span>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="text-[10px] text-ink-faint">
                    {Math.round(layer.opacity * 100)}%
                  </span>
                  <button
                    type="button"
                    data-testid={`editor-layer-${layer.id}-visibility`}
                    className="rounded-sm p-1 text-ink-muted transition-colors hover:bg-surface-03 hover:text-ink-primary disabled:pointer-events-none disabled:opacity-40"
                    aria-label={layer.visible ? t('hide') : t('show')}
                    disabled={isBase}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleVisibility(layer.id, !layer.visible);
                    }}
                  >
                    {layer.visible ? (
                      <Eye className="h-3.5 w-3.5" />
                    ) : (
                      <EyeOff className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    data-testid={`editor-layer-${layer.id}-lock`}
                    className="rounded-sm p-1 text-ink-muted transition-colors hover:bg-surface-03 hover:text-ink-primary disabled:pointer-events-none disabled:opacity-40"
                    aria-label={layer.locked ? t('unlock') : t('lock')}
                    disabled={isBase}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleLocked(layer.id, !layer.locked);
                    }}
                  >
                    {layer.locked ? (
                      <Lock className="h-3.5 w-3.5" />
                    ) : (
                      <Unlock className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    data-testid={`editor-layer-${layer.id}-move-up`}
                    className="rounded-sm p-1 text-ink-muted transition-colors hover:bg-surface-03 hover:text-ink-primary disabled:pointer-events-none disabled:opacity-40"
                    aria-label={t('moveUp')}
                    disabled={isBase}
                    onClick={(event) => {
                      event.stopPropagation();
                      onMoveLayer(layer.id, 'up');
                    }}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    data-testid={`editor-layer-${layer.id}-move-down`}
                    className="rounded-sm p-1 text-ink-muted transition-colors hover:bg-surface-03 hover:text-ink-primary disabled:pointer-events-none disabled:opacity-40"
                    aria-label={t('moveDown')}
                    disabled={isBase}
                    onClick={(event) => {
                      event.stopPropagation();
                      onMoveLayer(layer.id, 'down');
                    }}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    data-testid={`editor-layer-${layer.id}-delete`}
                    className="rounded-sm p-1 text-danger transition-colors hover:bg-danger/10 disabled:pointer-events-none disabled:opacity-40"
                    aria-label={t('delete')}
                    disabled={isBase}
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteLayer(layer.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <label className="mt-s-2 flex items-center gap-s-2 text-[10px] text-ink-faint">
                <span>{t('opacity')}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(layer.opacity * 100)}
                  disabled={isBase}
                  aria-label={t('opacity')}
                  data-testid={`editor-layer-${layer.id}-opacity`}
                  className="min-w-0 flex-1 accent-[var(--color-accent)] disabled:opacity-40"
                  onChange={(event) => {
                    onChangeOpacity(layer.id, Number(event.currentTarget.value) / 100);
                  }}
                />
              </label>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
