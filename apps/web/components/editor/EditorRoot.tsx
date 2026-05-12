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
import { useCommandStack } from '@/lib/editor/command-stack';
import type { CanvasStageHandle, MaskBox } from '@/lib/editor/types';

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

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

export interface EditorRootProps {
  imageId: string;
}

export function EditorRoot({ imageId }: EditorRootProps) {
  const t = useTranslations('editor');
  const [activeTool, setActiveTool] = useState<'select' | 'text' | 'move' | 'inpaint' | null>(
    'select'
  );
  const [maskBox, setMaskBox] = useState<MaskBox | null>(null);
  const hasMask = maskBox !== null;
  const canvasRef = useRef<CanvasStageHandle | null>(null);
  const inpaint = useInpaint();

  const imageUrl = `${BASE_URL}/api/images/${encodeURIComponent(imageId)}/bytes`;

  const handleInpaintStart = useCallback(() => {
    if (!maskBox) return;
    void inpaint.start(imageId, { mask_box: maskBox, new_text: '' });
  }, [imageId, inpaint, maskBox]);

  const handleBoxClick = useCallback((index: number) => {
    canvasRef.current?.selectByOcrIndex(index);
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
    inpaint.reset();
  }, [inpaint, imageId, maskBox]);

  return (
    <div className="flex h-screen flex-col bg-surface-01 text-ink-primary">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-border-subtle bg-surface-02 px-s-5 py-s-3">
        <span className="font-display text-ink-primary">{t('title')}</span>
      </header>

      {/* Middle row: ToolRail + canvas area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Tool rail */}
        <ToolRail
          activeTool={activeTool}
          onToolChange={setActiveTool}
          onInpaintStart={handleInpaintStart}
          onInpaintAbort={inpaint.abort}
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
