'use client';

import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { CanvasStageProps } from '@/components/editor/CanvasStage';
import { HistoryTimeline } from '@/components/editor/HistoryTimeline';
import { TextLayerOverlay } from '@/components/editor/TextLayerOverlay';
import { ToolRail } from '@/components/editor/ToolRail';
import { useInpaint } from '@/hooks/use-inpaint';
import type { OcrBox } from '@/hooks/use-ocr';
import {
  type ImageSaveMode,
  createEditResultFromDataUrl,
  imageBytesUrl,
  saveEditedImage,
} from '@/lib/api/images';
import { useCommandStack } from '@/lib/editor/command-stack';
import type { CanvasStageHandle, MaskBox } from '@/lib/editor/types';
import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';

// CanvasStage uses fabric.js which touches `document` at module init —
// must be dynamically imported with ssr: false. The dynamic() typing in
// Next 14 doesn't natively expose ref-forwarding even though the runtime
// supports it (v13+), so we cast to a ForwardRef component shape.
const CanvasStage = dynamic(
  () => import('@/components/editor/CanvasStage').then((m) => m.CanvasStage),
  {
    ssr: false,
    loading: () => (
      <div
        data-testid="canvas-skeleton"
        className="size-full animate-pulse rounded-card bg-surface-02"
      />
    ),
  }
) as unknown as React.ForwardRefExoticComponent<
  CanvasStageProps & React.RefAttributes<CanvasStageHandle>
>;

const CANVAS_WIDTH = 1024;
const CANVAS_HEIGHT = 1536;

export interface EditorRootProps {
  imageId: string;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function EditorRoot({ imageId }: EditorRootProps) {
  const t = useTranslations('editor');
  const locale = useLocale() as 'zh' | 'en';
  const router = useRouter();
  const [activeTool, setActiveTool] = useState<'select' | 'text' | 'move' | 'inpaint' | null>(
    'select'
  );
  const [maskBox, setMaskBox] = useState<MaskBox | null>(null);
  const hasMask = maskBox !== null;
  const canvasRef = useRef<CanvasStageHandle | null>(null);
  const inpaint = useInpaint();
  const [pendingEditResultRef, setPendingEditResultRef] = useState<string | null>(null);
  const [hasLocalCanvasEdits, setHasLocalCanvasEdits] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  const imageUrl = imageBytesUrl(imageId);

  const handleInpaintStart = useCallback(() => {
    if (!maskBox) return;
    void inpaint.start(imageId, { mask_box: maskBox, new_text: '' });
  }, [imageId, inpaint, maskBox]);

  const handleBoxClick = useCallback(
    (index: number, box: OcrBox) => {
      if (activeTool === 'text') {
        canvasRef.current?.upsertTextLayerFromOcr(index, box);
        setHasLocalCanvasEdits(true);
        setSaveStatus('idle');
        setSaveError(null);
        return;
      }
      canvasRef.current?.selectByOcrIndex(index);
    },
    [activeTool]
  );

  const handleUndo = useCallback(() => {
    canvasRef.current?.undo();
    setHasLocalCanvasEdits(useCommandStack.getState().undoStack.length > 0);
    setSaveStatus('idle');
  }, []);

  const handleRedo = useCallback(() => {
    canvasRef.current?.redo();
    setHasLocalCanvasEdits(useCommandStack.getState().undoStack.length > 0);
    setSaveStatus('idle');
  }, []);

  // Surface setMaskBox + setActiveTool on the test hook so EPIC-5b AC#7 can
  // commit a mask without simulating a fabric drag. Single-tenant internal
  // tool — see CanvasStage.tsx for the same justification. No cleanup: the
  // assignment is idempotent and a cleanup-then-remount race with the dynamic
  // CanvasStage child can leave the hook nulled-out exactly when tests poll.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const w = window as Window & { __editorTest?: Record<string, unknown> };
    if (!w.__editorTest) w.__editorTest = {};
    w.__editorTest.setMaskBox = setMaskBox;
    w.__editorTest.setActiveTool = setActiveTool;
  }, []);

  // On inpaint success: snapshot the canvas to history and clear the mask
  // affordance so the operator can draw a new region. The Inpaint button
  // disables again until the next mask is committed (hasMask flips false).
  useEffect(() => {
    if (inpaint.status !== 'success') return;
    const editResultRef =
      inpaint.editResultRef ??
      (typeof inpaint.lastEvent?.data.edit_result_ref === 'string'
        ? inpaint.lastEvent.data.edit_result_ref
        : null);
    const fab =
      typeof window !== 'undefined'
        ? (
            window as Window & {
              __editorTest?: { canvas?: { toObject?: (k: string[]) => unknown } };
            }
          ).__editorTest?.canvas
        : undefined;
    const snapshot = fab?.toObject?.(['customProps']) ?? {};
    useCommandStack.getState().push({
      id: `${imageId}-${Date.now()}`,
      op_type: 'inpaint',
      payload: maskBox,
      snapshot_json: JSON.stringify(snapshot),
      ts: Date.now(),
    });
    canvasRef.current?.clearMaskRect();
    setMaskBox(null);
    if (editResultRef) {
      setPendingEditResultRef(editResultRef);
      setSaveStatus('idle');
      setSaveError(null);
    }
    inpaint.reset();
  }, [inpaint, imageId, maskBox]);

  const handleSaveEdit = useCallback(
    async (mode: ImageSaveMode) => {
      if ((!pendingEditResultRef && !hasLocalCanvasEdits) || saveStatus === 'saving') return;
      setSaveStatus('saving');
      setSaveError(null);
      try {
        let editResultRef = pendingEditResultRef;
        if (!editResultRef) {
          const dataUrl = canvasRef.current?.exportPngDataUrl();
          if (!dataUrl) throw new Error('Canvas export failed');
          const result = await createEditResultFromDataUrl(imageId, dataUrl, {
            op_type: 'canvas_text',
            command_count: useCommandStack.getState().undoStack.length,
          });
          editResultRef = result.edit_result_ref;
        }
        const saved = await saveEditedImage(imageId, {
          edit_result_ref: editResultRef,
          mode,
        });
        setPendingEditResultRef(null);
        setHasLocalCanvasEdits(false);
        useCommandStack.getState().clear();
        setSaveStatus('saved');
        if (saved.image_id !== imageId) {
          const prefix = locale === 'zh' ? '' : `/${locale}`;
          router.replace(`${prefix}/editor/${encodeURIComponent(saved.image_id)}`);
        }
      } catch (err) {
        setSaveError((err as Error).message);
        setSaveStatus('error');
      }
    },
    [hasLocalCanvasEdits, imageId, locale, pendingEditResultRef, router, saveStatus]
  );

  return (
    <div className="flex h-screen flex-col bg-surface-01 text-ink-primary">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-border-subtle bg-surface-02 px-s-5 py-s-3">
        <span className="font-display text-ink-primary">{t('title')}</span>
        <div className="flex items-center gap-s-2 text-xs">
          {pendingEditResultRef || hasLocalCanvasEdits ? (
            <>
              <span className="text-ink-muted">{t('save.pending')}</span>
              <button
                type="button"
                disabled={saveStatus === 'saving'}
                onClick={() => void handleSaveEdit('replace')}
                className="rounded-input border border-border-subtle bg-surface-01 px-s-3 py-s-1 text-ink-secondary transition-colors hover:border-border-strong hover:text-ink-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('save.replace')}
              </button>
              <button
                type="button"
                disabled={saveStatus === 'saving'}
                onClick={() => void handleSaveEdit('copy')}
                className="rounded-input bg-accent px-s-3 py-s-1 text-ink-base-l transition-colors hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('save.copy')}
              </button>
            </>
          ) : saveStatus === 'saved' ? (
            <span className="text-success">{t('save.saved')}</span>
          ) : null}
          {saveStatus === 'error' && saveError ? (
            <span className="text-danger" role="alert">
              {t('save.error')}: {saveError}
            </span>
          ) : null}
        </div>
      </header>

      {/* Middle row: ToolRail + canvas area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Tool rail */}
        <ToolRail
          activeTool={activeTool}
          onToolChange={setActiveTool}
          onInpaintStart={handleInpaintStart}
          onInpaintAbort={inpaint.abort}
          onUndo={handleUndo}
          onRedo={handleRedo}
          inpaintStatus={inpaint.status}
          hasMask={hasMask}
          className="shrink-0 m-s-3"
        />

        {/* Canvas region */}
        <div className="flex flex-1 items-center justify-center overflow-auto p-s-5">
          <div className="relative" style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}>
            <CanvasStage
              ref={canvasRef}
              imageId={imageId}
              imageUrl={imageUrl}
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              activeTool={activeTool}
              onMaskChange={setMaskBox}
              onLocalEdit={() => setHasLocalCanvasEdits(true)}
            />
            {/* TextLayerOverlay stacked absolute over canvas */}
            <TextLayerOverlay
              imageId={imageId}
              canvasWidth={CANVAS_WIDTH}
              canvasHeight={CANVAS_HEIGHT}
              onBoxClick={handleBoxClick}
              className="absolute inset-0"
            />
          </div>
        </div>
      </div>

      {/* Bottom: history timeline */}
      <div className="m-s-3">
        <HistoryTimeline />
      </div>
    </div>
  );
}
