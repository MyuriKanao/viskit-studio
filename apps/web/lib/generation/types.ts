import type { Locale } from '@/lib/chat/types';

export type OutputPlanSource = 'explicit' | 'recommended' | 'fallback' | 'manual';
export type OutputDestinationType = 'kit_slot' | 'asset';

export interface SourceImageRef {
  source_image_ref: string;
  preview_url: string | null;
  mime: string | null;
}

export interface ProductProfilePayload {
  name?: string | null;
  brand: string;
  category: string;
  product_type: string;
  price?: number | null;
  brand_color_hex: string;
  selling_points: string[];
}

export interface GenerationPlanItem {
  id: string;
  output_kind: string;
  title: string;
  reason: string | null;
  template_ref: string | null;
  template_name: string | null;
  aspect_ratio: string | null;
  destination_type: OutputDestinationType;
  slot_id: string | null;
  enabled: boolean;
}

export interface GenerationPlan {
  plan_id: string | null;
  source_image_ref: string;
  plan_source: OutputPlanSource;
  requires_confirmation: boolean;
  items: GenerationPlanItem[];
  user_prompt: string | null;
}

export type GenerationJobStatus =
  | 'draft'
  | 'planned'
  | 'queued'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'succeeded'
  | 'partial'
  | 'ready'
  | 'failed'
  | 'needs_review'
  | 'interrupted';

export type GenerationOutputStatus =
  | 'queued'
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'success'
  | 'ready'
  | 'failed'
  | 'stopped'
  | 'cancelled'
  | 'needs_review';

export interface GenerationOutput {
  id: string;
  output_id: string;
  output_key: string;
  output_kind: string;
  title: string;
  reason: string | null;
  template_ref: string | null;
  template_name: string | null;
  aspect_ratio: string | null;
  destination_type: OutputDestinationType;
  slot_id: string | null;
  asset_id: string | null;
  image_id: string;
  image_url: string | null;
  download_url: string | null;
  png_path: string | null;
  status: GenerationOutputStatus;
  error_message: string | null;
  sort_order: number;
}

export interface GenerationJobSnapshot {
  job_id: string;
  client_job_id: string | null;
  status: GenerationJobStatus;
  source_image_ref: string | null;
  user_prompt: string | null;
  locale: Locale | string | null;
  marketing_kit_id: number | null;
  planner_payload: Record<string, unknown>;
  outputs: GenerationOutput[];
  error_message: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
}

export interface GenerationPlanRequest {
  kit_client_id: string;
  source_image_ref: string;
  user_prompt: string | null;
  locale: Locale;
  product: ProductProfilePayload;
  explicit_template_refs?: string[];
}

export interface GenerationJobOutputCreateRequest {
  output_key: string;
  output_kind: string;
  template_ref: string;
  template_name?: string | null;
  aspect_ratio?: string | null;
  width: number;
  height: number;
  prompt: string;
  destination_type: OutputDestinationType;
  marketing_kit_id?: number | null;
  slot_id?: string | null;
}

export interface GenerationJobCreateRequest {
  source_image_ref: string;
  user_prompt: string;
  locale: Locale;
  client_job_id?: string | null;
  marketing_kit_id?: number | null;
  planner_payload: Record<string, unknown>;
  outputs: GenerationJobOutputCreateRequest[];
}

export function canonicalJobOutputImageId(jobId: string, outputId: string): string {
  return `job-output:${jobId}:${outputId}`;
}

export function canonicalAssetImageId(assetId: string): string {
  return `asset:${assetId}`;
}

export function canonicalKitSlotImageId(marketingKitId: number | string, slotId: string): string {
  return `kit-slot:${marketingKitId}:${slotId}`;
}
