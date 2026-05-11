'use client';

import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useState } from 'react';

import { HistoryTimeline } from '@/components/editor/HistoryTimeline';
import { TextLayerOverlay } from '@/components/editor/TextLayerOverlay';
import { ToolRail } from '@/components/editor/ToolRail';
import { useInpaint } from '@/hooks/use-inpaint';

// CanvasStage uses fabric.js which touches `document` at module init —
// must be dynamically imported with ssr: false.
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
);

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
  // hasMask stays false in v1 — mask UI ships in a follow-on story.
  // TODO(EPIC-5 follow-up): mask UI ships in a follow-on story
  const [hasMask] = useState(false);
  const inpaint = useInpaint();

  const imageUrl = `${BASE_URL}/api/images/${encodeURIComponent(imageId)}/bytes`;

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
          onInpaintStart={() => {
            // TODO(EPIC-5 follow-up): mask UI ships in a follow-on story; no-op until then
          }}
          onInpaintAbort={inpaint.abort}
          inpaintStatus={inpaint.status}
          hasMask={hasMask}
          className="shrink-0 m-s-3"
        />

        {/* Canvas region */}
        <div className="flex flex-1 items-center justify-center overflow-auto p-s-5">
          <div className="relative" style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}>
            <CanvasStage
              imageId={imageId}
              imageUrl={imageUrl}
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
            />
            {/* TextLayerOverlay stacked absolute over canvas */}
            <TextLayerOverlay
              imageId={imageId}
              canvasWidth={CANVAS_WIDTH}
              canvasHeight={CANVAS_HEIGHT}
              onBoxClick={(_index, _box) => {
                // TODO(EPIC-5 follow-up): selection wiring requires a CanvasStage imperative
                // ref which was deferred in US-007 (AC#6 — no forwardRef).
              }}
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
