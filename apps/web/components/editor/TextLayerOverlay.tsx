'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import type { OcrBox } from '@/hooks/use-ocr';
import { useOcr } from '@/hooks/use-ocr';
import { cn } from '@/lib/utils';

export interface TextLayerOverlayProps {
  imageId: string;
  canvasWidth: number;
  canvasHeight: number;
  onBoxClick?: (index: number, box: OcrBox) => void;
  className?: string;
}

const SKELETON_RATIOS = [
  { xR: 0.1, yR: 0.15, wR: 0.55, hR: 0.03, id: 'sk-a' },
  { xR: 0.1, yR: 0.35, wR: 0.4, hR: 0.03, id: 'sk-b' },
  { xR: 0.1, yR: 0.55, wR: 0.65, hR: 0.03, id: 'sk-c' },
] as const;

/** Three static skeleton rects shown while OCR is fetching. */
function SkeletonOverlay({ width, height }: { width: number; height: number }) {
  return (
    <svg
      aria-hidden="true"
      width={width}
      height={height}
      className="pointer-events-none absolute inset-0"
      style={{ top: 0, left: 0 }}
    >
      {SKELETON_RATIOS.map(({ xR, yR, wR, hR, id }) => (
        <rect
          key={id}
          x={width * xR}
          y={height * yR}
          width={width * wR}
          height={height * hR}
          rx={4}
          className="animate-pulse fill-surface-03"
        />
      ))}
    </svg>
  );
}

function OcrFeedback({
  message,
  state,
}: {
  message: string;
  state: 'empty' | 'error';
}) {
  return (
    <div
      data-testid={state === 'error' ? 'ocr-error-state' : 'ocr-empty-state'}
      role={state === 'error' ? 'alert' : 'status'}
      aria-live="polite"
      className={cn(
        'pointer-events-none absolute left-1/2 top-4 max-w-[320px] -translate-x-1/2 rounded-input border px-s-3 py-s-2 text-center text-xs shadow-lift',
        state === 'error'
          ? 'border-danger/40 bg-danger/10 text-danger'
          : 'border-border-subtle bg-surface-01/90 text-ink-muted'
      )}
    >
      {message}
    </div>
  );
}

interface OcrRectProps {
  box: OcrBox;
  index: number;
  onBoxClick?: (index: number, box: OcrBox) => void;
}

function OcrRect({ box, index, onBoxClick }: OcrRectProps) {
  const [hovered, setHovered] = React.useState(false);
  const [focused, setFocused] = React.useState(false);

  const isActive = hovered || focused;

  function handleClick() {
    onBoxClick?.(index, box);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onBoxClick?.(index, box);
    }
  }

  return (
    <g>
      <rect
        data-ocr-index={index}
        x={box.x}
        y={box.y}
        width={box.w}
        height={box.h}
        rx={2}
        tabIndex={0}
        aria-label={`OCR region: ${box.text}`}
        className={cn(
          'cursor-pointer outline-none transition-colors duration-fast',
          isActive ? 'fill-accent-wash stroke-accent opacity-80' : 'fill-accent-glow stroke-accent'
        )}
        strokeWidth={1.5}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        <title>{box.text}</title>
      </rect>
      {isActive && (
        <foreignObject
          x={box.x}
          y={Math.max(0, box.y - 24)}
          width={Math.min(box.w + 32, 300)}
          height={22}
          style={{ overflow: 'visible', pointerEvents: 'none' }}
        >
          <div className="max-w-[300px] truncate rounded bg-surface-02 px-s-1 py-[2px] font-mono text-xs text-ink-secondary shadow-lift">
            {box.text}
          </div>
        </foreignObject>
      )}
    </g>
  );
}

function OcrStatusNotice({
  testId,
  tone,
  children,
}: {
  testId: string;
  tone: 'muted' | 'danger';
  children: React.ReactNode;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-start justify-center p-s-4">
      <p
        data-testid={testId}
        role={tone === 'danger' ? 'alert' : 'status'}
        aria-live="polite"
        className={cn(
          'rounded-input border px-s-3 py-s-2 text-xs shadow-lift',
          tone === 'danger'
            ? 'border-danger/40 bg-danger/10 text-danger'
            : 'border-border-subtle bg-surface-02/90 text-ink-muted'
        )}
      >
        {children}
      </p>
    </div>
  );
}

/**
 * TextLayerOverlay — renders OCR bounding boxes as an absolutely-positioned
 * SVG over the canvas. Each box is keyboard-focusable and dispatches
 * `onBoxClick` on click or Enter/Space.
 *
 * - Loading: 3 skeleton rects with `animate-pulse`.
 * - Error / empty: visible operator feedback with accessible live status.
 */
export function TextLayerOverlay({
  imageId,
  canvasWidth,
  canvasHeight,
  onBoxClick,
  className,
}: TextLayerOverlayProps) {
  const t = useTranslations('editor.ocr');
  const { data, isLoading, isError } = useOcr(imageId);

  if (isLoading) {
    return (
      <div
        aria-busy="true"
        aria-label={t('loading')}
        className={cn('pointer-events-none absolute inset-0', className)}
      >
        <SkeletonOverlay width={canvasWidth} height={canvasHeight} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className={cn('pointer-events-none absolute inset-0', className)}>
        <OcrFeedback state="error" message={t('error')} />
      </div>
    );
  }

  if (!data || data.boxes.length === 0) {
    return (
      <div className={cn('pointer-events-none absolute inset-0', className)}>
        <OcrFeedback state="empty" message={t('empty')} />
      </div>
    );
  }

  return (
    <div className={cn('absolute inset-0', className)}>
      <svg
        role="img"
        aria-label="OCR text regions"
        width={canvasWidth}
        height={canvasHeight}
        className="absolute inset-0"
        style={{ top: 0, left: 0 }}
      >
        {data.boxes.map((box, i) => (
          <OcrRect
            // biome-ignore lint/suspicious/noArrayIndexKey: OCR box position index is the stable semantic identity
            key={i}
            box={box}
            index={i}
            onBoxClick={onBoxClick}
          />
        ))}
      </svg>
    </div>
  );
}
