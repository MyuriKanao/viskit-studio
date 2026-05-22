import type { ViskitEditorDocument } from '@/lib/editor/document';
import {
  createSerializedEditorProject,
  deserializeEditorDocument,
} from '@/lib/editor/serialization';
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
  asset_id: string | null;
  replaced: boolean;
}

export interface CreateEditResultResponse {
  edit_result_ref: string;
  result_url: string;
  status: string;
}

export interface ImportedSourceImage extends SourceImageRef {
  data_url: string;
}

export interface EditorProjectResponse {
  image_id: string;
  project_id: string;
  source_image_ref?: string | null;
  document_schema_version: number;
  revision: number;
  checksum: string;
  document: Record<string, unknown>;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface EditorProjectSaveOptions {
  sourceImageRef?: string | null;
  expectedRevision?: number | null;
}

export interface ExportedEditorProject {
  document: ViskitEditorDocument;
  filename: string;
  revision: number | null;
  checksum: string | null;
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
  if (/\/api\/assets\/(?:None|null|undefined)(?:[/?#]|$)/.test(src)) return '';
  if (/\/api\/images\/asset%3A(?:None|null|undefined)(?:[/?#]|$)/i.test(src)) return '';
  if (src.startsWith('/api/')) return `${baseUrl}${src}`;
  return src;
}

async function readErrorDetail(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === 'string') return body.detail;
    if (
      body.detail &&
      typeof body.detail === 'object' &&
      'code' in body.detail &&
      typeof body.detail.code === 'string'
    ) {
      return body.detail.code;
    }
  } catch {
    // Keep status fallback for non-JSON responses.
  }
  return fallback;
}

export async function importSourceImageFromImageId(imageId: string): Promise<ImportedSourceImage> {
  const response = await fetch(`${baseUrl}/api/source-images/from-image`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ image_id: imageId }),
  });
  if (!response.ok) {
    const detail = await readErrorDetail(
      response,
      `Import source image failed (${response.status})`
    );
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
    const detail = await readErrorDetail(response, `Save image failed (${response.status})`);
    throw new Error(detail);
  }
  return (await response.json()) as SaveEditedImageResponse;
}

export async function createEditResultFromDataUrl(
  imageId: string,
  resultDataUrl: string,
  metadata: Record<string, unknown> = {}
): Promise<CreateEditResultResponse> {
  const response = await fetch(
    `${baseUrl}/api/images/${encodeURIComponent(imageId)}/edit-results`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        result_data_url: resultDataUrl,
        source_image_ref: imageId,
        metadata,
      }),
    }
  );
  if (!response.ok) {
    const detail = await readErrorDetail(
      response,
      `Create edit result failed (${response.status})`
    );
    throw new Error(detail);
  }
  return (await response.json()) as CreateEditResultResponse;
}

export async function getEditorProject(imageId: string): Promise<EditorProjectResponse | null> {
  const response = await fetch(`${baseUrl}/api/images/${encodeURIComponent(imageId)}/project`, {
    method: 'GET',
    headers: { accept: 'application/json' },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const detail = await readErrorDetail(response, `Load project failed (${response.status})`);
    throw new Error(detail);
  }
  return (await response.json()) as EditorProjectResponse;
}

export async function saveEditorProject(
  imageId: string,
  document: ViskitEditorDocument,
  options: EditorProjectSaveOptions = {}
): Promise<EditorProjectResponse> {
  const response = await fetch(`${baseUrl}/api/images/${encodeURIComponent(imageId)}/project`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      document: createSerializedEditorProject(document),
      source_image_ref: options.sourceImageRef ?? null,
      expected_revision: options.expectedRevision ?? null,
    }),
  });
  if (!response.ok) {
    const detail = await readErrorDetail(response, `Save project failed (${response.status})`);
    throw new Error(detail);
  }
  return (await response.json()) as EditorProjectResponse;
}

export async function importEditorProject(
  imageId: string,
  document: ViskitEditorDocument,
  options: EditorProjectSaveOptions = {}
): Promise<EditorProjectResponse> {
  const response = await fetch(
    `${baseUrl}/api/images/${encodeURIComponent(imageId)}/project/import`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        document: createSerializedEditorProject(document),
        source_image_ref: options.sourceImageRef ?? null,
        expected_revision: options.expectedRevision ?? null,
      }),
    }
  );
  if (!response.ok) {
    const detail = await readErrorDetail(response, `Import project failed (${response.status})`);
    throw new Error(detail);
  }
  return (await response.json()) as EditorProjectResponse;
}

export async function exportEditorProject(imageId: string): Promise<ExportedEditorProject> {
  const response = await fetch(
    `${baseUrl}/api/images/${encodeURIComponent(imageId)}/project/export`,
    {
      method: 'GET',
      headers: { accept: 'application/json' },
    }
  );
  if (!response.ok) {
    const detail = await readErrorDetail(response, `Export project failed (${response.status})`);
    throw new Error(detail);
  }
  const disposition = response.headers.get('content-disposition') ?? '';
  const filenameMatch = /filename="([^"]+)"/.exec(disposition);
  const payload = await response.json();
  return {
    document: deserializeEditorDocument(JSON.stringify(payload)),
    filename: filenameMatch?.[1] ?? `${imageId.replace(/[^A-Za-z0-9_.-]+/g, '_')}.json`,
    revision: Number(response.headers.get('x-viskit-project-revision')) || null,
    checksum: response.headers.get('etag'),
  };
}
