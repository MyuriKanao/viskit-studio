'use client';

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

/**
 * TextLayerOverlay — renders OCR bounding boxes as an absolutely-positioned
 * SVG over the canvas. Each box is keyboard-focusable and dispatches
 * `onBoxClick` on click or Enter/Space.
 *
 * - Loading: 3 skeleton rects with `animate-pulse`.
 * - Error / empty: renders nothing (OCR is best-effort per spec §R3).
 */
export function TextLayerOverlay({
  imageId,
  canvasWidth,
  canvasHeight,
  onBoxClick,
  className,
}: TextLayerOverlayProps) {
  const { data, isLoading, isError } = useOcr(imageId);

  if (isLoading) {
    return (
      <div
        aria-busy="true"
        aria-label="Loading OCR regions"
        className={cn('pointer-events-none absolute inset-0', className)}
      >
        <SkeletonOverlay width={canvasWidth} height={canvasHeight} />
      </div>
    );
  }

  if (isError || !data || data.boxes.length === 0) {
    return null;
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
