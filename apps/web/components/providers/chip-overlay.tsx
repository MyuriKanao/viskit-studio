'use client';

import { AlertTriangle } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

export interface ChipOverlayProps {
  role: string;
  severity?: 'warn' | 'error';
  x: number;
  y: number;
  onClickFixUrl?: string;
  className?: string;
}

const SEVERITY_CLS: Record<'warn' | 'error', string> = {
  warn: 'border-warning/40 bg-warning/15 text-warning',
  error: 'border-danger/40 bg-danger/15 text-danger',
};

/**
 * SVG-positioned warning badge for unbound role bands on the Sankey diagram.
 *
 * The chip itself is HTML rendered absolutely over the SVG using `x`/`y` from
 * the SVG viewport.  Click opens the click-to-fix CTA in a new tab.
 */
export function ChipOverlay({
  role,
  severity = 'warn',
  x,
  y,
  onClickFixUrl,
  className,
}: ChipOverlayProps) {
  const label = `${role}_unbound — click for forensic context`;
  const content = (
    <span
      className={cn(
        'inline-flex items-center gap-s-1 rounded-pill border px-s-2 py-0.5 text-xs font-medium',
        SEVERITY_CLS[severity],
        className
      )}
    >
      <AlertTriangle aria-hidden="true" className="h-3 w-3" />
      <span>{role}</span>
    </span>
  );
  return (
    <foreignObject x={x} y={y} width={180} height={28}>
      {onClickFixUrl ? (
        <a
          href={onClickFixUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={label}
          className="no-underline"
        >
          {content}
        </a>
      ) : (
        <span aria-label={label}>{content}</span>
      )}
    </foreignObject>
  );
}
