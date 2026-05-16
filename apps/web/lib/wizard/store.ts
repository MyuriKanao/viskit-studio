'use client';

import { create } from 'zustand';

export type WizardStep = 1 | 2 | 3 | 4;
export type WizardLocale = 'zh' | 'en';

export interface SkuMeta {
  sku: string;
  name: string;
  brand: string;
  category: string;
  product_type: string;
  price: string;
}

export interface RetrievalFilters {
  category: string | null;
  season: string | null;
  min_sales: number | null;
  fallback_locale: WizardLocale | null;
}

export interface RetrievalHitMetadata {
  from_fallback?: boolean;
  [key: string]: unknown;
}

export interface RetrievalHit {
  image_url: string;
  score: number;
  metadata: RetrievalHitMetadata;
  /**
   * EPIC-13 — server-stamped flag indicating the hit's Milvus PK is a member
   * of the operator's inspired Vault set. Required on the wire (backend
   * defaults to false), so the frontend renders the corner ribbon iff true.
   */
  inspired: boolean;
  image_path?: string;
  /** Milvus PK — EPIC-9 Phase 4a. Optional only to keep older mocks working. */
  id?: number;
}

export interface ProgressEvent {
  slot: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  message?: string;
}

export const EMPTY_SKU_META: SkuMeta = {
  sku: '',
  name: '',
  brand: '',
  category: '',
  product_type: '',
  price: '',
};

export const EMPTY_FILTERS: RetrievalFilters = {
  category: null,
  season: null,
  min_sales: null,
  fallback_locale: null,
};

export interface WizardState {
  step: WizardStep;
  skuMeta: SkuMeta;
  brandColor: string;
  locale: WizardLocale;
  image: string | null;
  filters: RetrievalFilters;
  hits: RetrievalHit[];
  selectedHits: RetrievalHit[];
  sellingPoints: string[];
  stylePrompt: string | null;
  kitClientId: string;
  progressEvents: ProgressEvent[];
  /**
   * EPIC-9 Phase 5 — Vault drawer's "用作参考" CTA navigates to
   * /new-kit?ref=<id>; the page consumes the param on mount and pins the
   * id here. Excluded from the back()/Step-1 invalidate-downstream set so
   * the user can edit basics without losing the reference.
   */
  pinnedRefAssetId: number | null;

  setStep: (step: WizardStep) => void;
  next: () => void;
  back: () => void;
  setSkuMeta: (patch: Partial<SkuMeta>) => void;
  setBrandColor: (hex: string) => void;
  setLocale: (locale: WizardLocale) => void;
  setImage: (dataUri: string | null) => void;
  setFilters: (patch: Partial<RetrievalFilters>) => void;
  setHits: (hits: RetrievalHit[]) => void;
  setSelectedHits: (hits: RetrievalHit[]) => void;
  setSellingPoints: (points: string[]) => void;
  setStylePrompt: (prompt: string | null) => void;
  appendProgress: (event: ProgressEvent) => void;
  resetProgress: () => void;
  setPinnedRefAssetId: (id: number | null) => void;
  clearPinnedRef: () => void;
  reset: () => void;
}

function makeKitClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback: time + random suffix (SSR / older runtimes).
  return `kit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const initialState = (): Omit<
  WizardState,
  | 'setStep'
  | 'next'
  | 'back'
  | 'setSkuMeta'
  | 'setBrandColor'
  | 'setLocale'
  | 'setImage'
  | 'setFilters'
  | 'setHits'
  | 'setSelectedHits'
  | 'setSellingPoints'
  | 'setStylePrompt'
  | 'appendProgress'
  | 'resetProgress'
  | 'setPinnedRefAssetId'
  | 'clearPinnedRef'
  | 'reset'
> => ({
  step: 1,
  skuMeta: { ...EMPTY_SKU_META },
  brandColor: '#000000',
  locale: 'zh',
  image: null,
  filters: { ...EMPTY_FILTERS },
  hits: [],
  selectedHits: [],
  sellingPoints: [],
  stylePrompt: null,
  kitClientId: makeKitClientId(),
  progressEvents: [],
  pinnedRefAssetId: null,
});

/**
 * Phase 2.2 WizardStore — single-page 4-step wizard state machine.
 *
 * Back-flow rule: any back-step that lands on Step 1 invalidates downstream
 * retrieval/style-prompt/progress state, since Step 2 will accept a different
 * image or filters and the prior hits/style become stale.
 *
 * EPIC-9 ADR-EPIC9-002: ``pinnedRefAssetId`` is EXCLUDED from the
 * invalidate-downstream set below — the Vault deep-link must survive Step-1
 * backnav. Adding it to the reset payload would silently break the contract
 * tested by tests/web/new-kit-ref-handoff.spec.ts.
 */
export const useWizardStore = create<WizardState>((set) => ({
  ...initialState(),

  setStep: (step) => set({ step }),
  next: () => set((s) => (s.step < 4 ? { step: (s.step + 1) as WizardStep } : {})),
  back: () =>
    set((s) => {
      if (s.step <= 1) return {};
      const nextStep = (s.step - 1) as WizardStep;
      if (nextStep === 1) {
        // EPIC-9 ADR-EPIC9-002: do NOT add `pinnedRefAssetId` here.
        return {
          step: nextStep,
          hits: [],
          selectedHits: [],
          stylePrompt: null,
          progressEvents: [],
        };
      }
      return { step: nextStep };
    }),
  setSkuMeta: (patch) => set((s) => ({ skuMeta: { ...s.skuMeta, ...patch } })),
  setBrandColor: (hex) => set({ brandColor: hex }),
  setLocale: (locale) => set({ locale }),
  setImage: (dataUri) => set({ image: dataUri }),
  setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
  setHits: (hits) => set({ hits }),
  setSelectedHits: (selectedHits) => set({ selectedHits }),
  setSellingPoints: (sellingPoints) => set({ sellingPoints }),
  setStylePrompt: (stylePrompt) => set({ stylePrompt }),
  appendProgress: (event) => set((s) => ({ progressEvents: [...s.progressEvents, event] })),
  resetProgress: () => set({ progressEvents: [] }),
  setPinnedRefAssetId: (pinnedRefAssetId) => set({ pinnedRefAssetId }),
  clearPinnedRef: () => set({ pinnedRefAssetId: null }),
  reset: () => set({ ...initialState() }),
}));

// Expose the store on `window` so Playwright specs can seed/inspect wizard
// state via `page.evaluate`. The wizard state carries no secrets — sku,
// brand, locale, retrieval hits — so exposing it is safe for our
// single-tenant internal tool.
if (typeof window !== 'undefined') {
  (window as unknown as { __wizardStore?: typeof useWizardStore }).__wizardStore = useWizardStore;
}
