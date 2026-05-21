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
