'use client';

import * as React from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * EPIC-9 SharedDrawerShell — visual chrome shared by Vault & Catalog drawers.
 *
 * Wraps the right-side variant of {@link DialogContent} added in
 * ADR-EPIC9-001.  Consumers own title + body; the shell owns animation, focus
 * trap (Radix Dialog default), ESC + backdrop close, and a sticky header.
 */
export interface SharedDrawerShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  testId?: string;
  /** ARIA label for the dialog root when ``title`` is not a plain string. */
  ariaLabel?: string;
}

export function SharedDrawerShell({
  open,
  onOpenChange,
  title,
  description,
  children,
  testId,
  ariaLabel,
}: SharedDrawerShellProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        side="right"
        data-testid={testId}
        aria-label={ariaLabel}
        className="overflow-hidden"
      >
        <DialogHeader className="border-b border-border-subtle pb-s-3 text-left">
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="flex-1 overflow-y-auto pr-s-1">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
