'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

/**
 * EPIC-13 — non-interactive top-left corner indicator for Step-3 retrieval
 * hits whose Milvus PK is in the operator's inspired Vault set.
 *
 * Read-only by construction:
 *   - inline SVG triangle (≤ 24×24 px), `text-warning` Tailwind token
 *   - `pointer-events-none`, no click/keyboard handlers
 *   - no `role="button"`, `tabIndex`, or `aria-pressed`
 *   - zero Radix imports, zero Lucide imports — static-inline only
 *
 * a11y: `aria-label` from `wizard.step_3.inspired_badge_label`, plus a
 * visually-hidden mirror so SR users get the same context as sighted ones.
 */
export default function CornerRibbon() {
  const t = useTranslations();
  const label = t('wizard.step_3.inspired_badge_label');
  return (
    <span
      data-testid="hit-inspired-ribbon"
      aria-label={label}
      className="pointer-events-none absolute left-0 top-0 z-10 text-warning"
    >
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <polygon points="0,0 20,0 0,20" fill="currentColor" />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  );
}
