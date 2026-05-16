'use client';

import { create } from 'zustand';

export type WizardStep = 1 | 2 | 3;
export type WizardLocale = 'zh' | 'en';

export interface SkuMeta {
  sku: string;
  name: string;
  brand: string;
  category: string;
  product_type: string;
  price: string;
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

export interface WizardState {
  step: WizardStep;
  skuMeta: SkuMeta;
  brandColor: string;
  locale: WizardLocale;
  image: string | null;
  sellingPoints: string[];
  kitClientId: string;

  setStep: (step: WizardStep) => void;
  next: () => void;
  back: () => void;
  setSkuMeta: (patch: Partial<SkuMeta>) => void;
  setBrandColor: (hex: string) => void;
  setLocale: (locale: WizardLocale) => void;
  setImage: (dataUri: string | null) => void;
  setSellingPoints: (points: string[]) => void;
  reset: () => void;
}

function makeKitClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
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
  | 'setSellingPoints'
  | 'reset'
> => ({
  step: 1,
  skuMeta: { ...EMPTY_SKU_META },
  brandColor: '#000000',
  locale: 'zh',
  image: null,
  sellingPoints: [],
  kitClientId: makeKitClientId(),
});

export const useWizardStore = create<WizardState>((set) => ({
  ...initialState(),

  setStep: (step) => set({ step }),
  next: () => set((s) => (s.step < 3 ? { step: (s.step + 1) as WizardStep } : {})),
  back: () =>
    set((s) => {
      if (s.step <= 1) return {};
      return { step: (s.step - 1) as WizardStep };
    }),
  setSkuMeta: (patch) => set((s) => ({ skuMeta: { ...s.skuMeta, ...patch } })),
  setBrandColor: (hex) => set({ brandColor: hex }),
  setLocale: (locale) => set({ locale }),
  setImage: (dataUri) => set({ image: dataUri }),
  setSellingPoints: (sellingPoints) => set({ sellingPoints }),
  reset: () => set({ ...initialState() }),
}));

if (typeof window !== 'undefined') {
  (window as unknown as { __wizardStore?: typeof useWizardStore }).__wizardStore = useWizardStore;
}
