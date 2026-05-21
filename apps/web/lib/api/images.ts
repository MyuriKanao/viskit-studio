import type { SourceImageRef } from '@/lib/generation/types';

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

export type ImageSaveMode = 'replace' | 'copy';

export interface SaveEditedImageRequest {
  edit_result_ref: string;
  mode: ImageSaveMode;
}

export interface SaveEditedImageResponse {
  mode: ImageSaveMode;
  image_id: string;
  image_url: string;
  asset_id: number | null;
  replaced: boolean;
}

export interface ImportedSourceImage extends SourceImageRef {
  data_url: string;
}

/**
 * Stable editor image id contract.
 *
 * Keep ids URL-segment-safe and slash-free so the same value can move through
 * catalog preview, `/editor/[image_id]`, `/api/images/{image_id}/bytes`, edit
 * jobs, and replace/copy save calls without hidden context.
 */
export function encodeKitSlotImageId(kitId: number, slotId: string): string {
  return `kit-slot:${kitId}:${slotId}`;
}

export function imageBytesUrl(imageId: string): string {
  return `${baseUrl}/api/images/${encodeURIComponent(imageId)}/bytes`;
}

export function resolveApiImageSrc(src: string | null | undefined): string {
  if (!src) return '';
  if (src.startsWith('/api/')) return `${baseUrl}${src}`;
  return src;
}

export async function importSourceImageFromImageId(imageId: string): Promise<ImportedSourceImage> {
  const response = await fetch(`${baseUrl}/api/source-images/from-image`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ image_id: imageId }),
  });
  if (!response.ok) {
    let detail = `Import source image failed (${response.status})`;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === 'string') detail = body.detail;
    } catch {
      // Keep status fallback for non-JSON responses.
    }
    throw new Error(detail);
  }
  const body = (await response.json()) as {
    source_image_ref?: unknown;
    preview_url?: unknown;
    mime_type?: unknown;
    data_url?: unknown;
  };
  if (typeof body.source_image_ref !== 'string' || typeof body.data_url !== 'string') {
    throw new Error('/api/source-images/from-image failed: missing source image payload');
  }
  return {
    source_image_ref: body.source_image_ref,
    preview_url: typeof body.preview_url === 'string' ? body.preview_url : null,
    mime: typeof body.mime_type === 'string' ? body.mime_type : 'image/png',
    data_url: body.data_url,
  };
}

export async function saveEditedImage(
  imageId: string,
  request: SaveEditedImageRequest
): Promise<SaveEditedImageResponse> {
  const response = await fetch(`${baseUrl}/api/images/${encodeURIComponent(imageId)}/save`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    let detail = `Save image failed (${response.status})`;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === 'string') detail = body.detail;
    } catch {
      // Keep status fallback for non-JSON responses.
    }
    throw new Error(detail);
  }
  return (await response.json()) as SaveEditedImageResponse;
}
