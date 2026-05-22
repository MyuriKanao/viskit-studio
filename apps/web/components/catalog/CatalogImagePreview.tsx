'use client';

import { Download, Send, Trash2 } from 'lucide-react';
import * as React from 'react';

import { buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { KitListItem } from '@/hooks/use-recent-kits';
import { resolveApiImageSrc } from '@/lib/api/images';
import { imageIdForCatalogItem, normalizeKitThumbs } from '@/lib/kits/images';
import { cn } from '@/lib/utils';

export interface CatalogImagePreviewLabels {
  title: string;
  openImage: string;
  downloadImage: string;
  deleteImage: string;
  editImage: string;
}

export interface CatalogImagePreviewProps {
  kit: KitListItem | null;
  imageIndex: number;
  open: boolean;
  labels: CatalogImagePreviewLabels;
  isDeleting?: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectImage: (imageIndex: number) => void;
  onDeleteImage: (imageId: string) => void;
  onEditImage?: (imageId: string) => void;
}

export function CatalogImagePreview({
  kit,
  imageIndex,
  open,
  labels,
  isDeleting = false,
  onOpenChange,
  onSelectImage,
  onDeleteImage,
  onEditImage,
}: CatalogImagePreviewProps) {
  const thumbs = normalizeKitThumbs(kit?.thumbs);
  const selectedSrc = thumbs[imageIndex] ?? null;
  const selectedImageId = kit ? imageIdForCatalogItem(kit, imageIndex) : '';
  const resolvedSrc = resolveApiImageSrc(selectedSrc);
  const availableImages = thumbs
    .map((src, index) => ({ src, index, imageId: kit ? imageIdForCatalogItem(kit, index) : '' }))
    .filter((image): image is { src: string; index: number; imageId: string } =>
      Boolean(image.src)
    );

  if (!kit) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-6xl flex-col overflow-hidden p-s-4">
        <DialogHeader className="pr-s-8 text-left">
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>
            {kit.name} · {kit.sku} · {selectedImageId}
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-s-4 lg:grid-cols-[minmax(0,1fr)_180px]">
          <div className="group/preview relative grid min-h-[320px] place-items-center overflow-hidden rounded-card border border-border-subtle bg-ink-base">
            {selectedSrc ? (
              <img
                src={resolvedSrc}
                alt={`${kit.name} ${selectedImageId}`}
                className="max-h-[68vh] w-full object-contain"
              />
            ) : (
              <div className="flex h-full min-h-[320px] items-center justify-center text-sm text-ink-faint">
                {selectedImageId}
              </div>
            )}

            {selectedSrc ? (
              <div className="pointer-events-none absolute left-s-3 right-s-3 top-s-3 flex justify-end opacity-100 transition-opacity duration-std sm:opacity-0 sm:group-hover/preview:opacity-100 sm:group-focus-within/preview:opacity-100">
                <div className="pointer-events-auto flex flex-wrap items-center gap-s-2 rounded-card border border-border-subtle bg-ink-base/80 p-s-2 shadow-lift backdrop-blur">
                  <a
                    href={resolvedSrc}
                    download={`${kit.sku}-${selectedImageId}.png`}
                    className={buttonVariants({
                      variant: 'secondary',
                      size: 'sm',
                      className: 'h-8 px-s-2 text-xs',
                    })}
                  >
                    <Download aria-hidden="true" className="h-3.5 w-3.5" />
                    {labels.downloadImage}
                  </a>
                  <button
                    type="button"
                    onClick={() => onEditImage?.(selectedImageId)}
                    className={buttonVariants({
                      variant: 'secondary',
                      size: 'sm',
                      className: 'h-8 px-s-2 text-xs',
                    })}
                  >
                    <Send aria-hidden="true" className="h-3.5 w-3.5" />
                    {labels.editImage}
                  </button>
                  <button
                    type="button"
                    disabled={isDeleting}
                    onClick={() => onDeleteImage(selectedImageId)}
                    className={buttonVariants({
                      variant: 'destructive',
                      size: 'sm',
                      className: 'h-8 px-s-2 text-xs',
                    })}
                  >
                    <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                    {labels.deleteImage}
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="grid max-h-[68vh] grid-cols-7 gap-s-2 overflow-y-auto lg:grid-cols-2">
            {availableImages.map((image) => (
              <button
                key={image.imageId}
                type="button"
                aria-label={`${labels.openImage} ${image.imageId}`}
                onClick={() => onSelectImage(image.index)}
                className={cn(
                  'aspect-square overflow-hidden rounded-input border bg-surface-02 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  image.index === imageIndex
                    ? 'border-accent'
                    : 'border-border-hair hover:border-border-strong'
                )}
              >
                <img
                  src={resolveApiImageSrc(image.src)}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </button>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
