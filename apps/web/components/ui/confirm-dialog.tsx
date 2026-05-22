'use client';

import { AlertTriangle } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  cancelLabel: string;
  confirmLabel: string;
  pending?: boolean;
  destructive?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  cancelLabel,
  confirmLabel,
  pending = false,
  destructive = true,
  onOpenChange,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!pending) onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="w-[calc(100vw-2rem)] max-w-lg p-s-5">
        <DialogHeader className="pr-s-8 text-left">
          <div className="flex items-start gap-s-3">
            <span
              className={cn(
                'mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-input border',
                destructive
                  ? 'border-danger/30 bg-danger/10 text-danger'
                  : 'border-accent/30 bg-accent/10 text-accent'
              )}
              aria-hidden="true"
            >
              <AlertTriangle className="h-4 w-4" />
            </span>
            <span className="flex min-w-0 flex-col gap-s-1">
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription className="break-words leading-6">
                {description}
              </DialogDescription>
            </span>
          </div>
        </DialogHeader>
        <div className="flex flex-col-reverse flex-wrap gap-s-2 border-border-subtle border-t pt-s-4 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => onOpenChange(false)}
            className="min-w-0"
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            disabled={pending}
            onClick={onConfirm}
            className="min-w-0"
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
