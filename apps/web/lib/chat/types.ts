// Chat-domain types — single source of truth from day one (MED-6).

/** Locale supported by the app. */
export type Locale = 'zh' | 'en';

/** SSE progress event emitted by /api/kits/{id}/events. */
export interface ProgressEvent {
  slot: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  message?: string;
  png_path?: string | null;
}

/** Per-field inference tuple — spec L35 canonical shape ("每字段的"). */
export interface FieldInference<T = unknown> {
  value: T;
  confidence: number;
  reasoning: string;
}

export function coerceFieldInference<T>(
  field: FieldInference<T> | null | undefined,
  fallback: T,
  reasoning = '未推断'
): FieldInference<T> {
  if (!field || typeof field !== 'object' || !('value' in field)) {
    return { value: fallback, confidence: 0, reasoning };
  }
  return {
    value: field.value ?? fallback,
    confidence: Number.isFinite(field.confidence) ? field.confidence : 0,
    reasoning: typeof field.reasoning === 'string' ? field.reasoning : reasoning,
  };
}

export function inferenceText(field: FieldInference<unknown> | null | undefined): string {
  const value = coerceFieldInference(field, '').value;
  return value === null || value === undefined ? '' : String(value).trim();
}

export function inferenceConfidence(field: FieldInference<unknown> | null | undefined): number {
  return coerceFieldInference(field, '').confidence;
}

/** Full inferred spec returned by POST /api/kits/{id}/extract. */
export interface InferredSpec {
  name: FieldInference<string> | null;
  brand: FieldInference<string>;
  category: FieldInference<string>;
  product_type: FieldInference<string>;
  brand_color_hex: FieldInference<string>;
  price: FieldInference<number> | null;
  selling_points: FieldInference<string>[];
  template_scheme_ref?: string | null;
  template_slot_overrides?: Record<string, string>;
}

export function normalizeInferredSpec(spec: InferredSpec): InferredSpec {
  return {
    ...spec,
    name: spec.name ? coerceFieldInference(spec.name, '') : null,
    brand: coerceFieldInference(spec.brand, ''),
    category: coerceFieldInference(spec.category, ''),
    product_type: coerceFieldInference(spec.product_type, ''),
    brand_color_hex: coerceFieldInference(spec.brand_color_hex, ''),
    price: spec.price ? coerceFieldInference(spec.price, 0) : null,
    selling_points: Array.isArray(spec.selling_points)
      ? spec.selling_points.map((point) => coerceFieldInference(point, ''))
      : [],
    template_scheme_ref: spec.template_scheme_ref ?? null,
    template_slot_overrides: spec.template_slot_overrides ?? {},
  };
}

/** Controls which view the ConfirmationCard renders (Phase C). */
export type ConfirmationMode = 'minimal' | 'asking' | 'expanded';

/** A single message in the chat thread. */
export interface ChatMessage {
  id: string;
  role: 'user' | 'ai';
  type: 'text' | 'card' | 'image_ref';
  content: string;
  timestamp: number;
}
