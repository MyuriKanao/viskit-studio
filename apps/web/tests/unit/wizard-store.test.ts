import { beforeEach, describe, expect, it } from 'vitest';

import { type RetrievalHit, useWizardStore } from '../../lib/wizard/store';

/**
 * Phase 2.2: WizardStore contract — step transitions, back-flow invalidation,
 * reset. The store backs the /new-kit 4-step flow; Step 4→Step 1 back must
 * clear retrieval/style/progress so Step 2 can accept a different image
 * without leaking stale hits forward.
 */

const HIT_A: RetrievalHit = {
  image_url: 'https://example.test/a.png',
  score: 0.9,
  metadata: { from_fallback: false },
};

beforeEach(() => {
  useWizardStore.getState().reset();
});

describe('WizardStore — step transitions', () => {
  it('starts at step 1 with empty downstream state', () => {
    const s = useWizardStore.getState();
    expect(s.step).toBe(1);
    expect(s.hits).toEqual([]);
    expect(s.selectedHits).toEqual([]);
    expect(s.stylePrompt).toBeNull();
    expect(s.progressEvents).toEqual([]);
  });

  it('next() advances 1→2→3→4 then clamps at 4', () => {
    const { next } = useWizardStore.getState();
    next();
    expect(useWizardStore.getState().step).toBe(2);
    next();
    expect(useWizardStore.getState().step).toBe(3);
    next();
    expect(useWizardStore.getState().step).toBe(4);
    next();
    expect(useWizardStore.getState().step).toBe(4);
  });

  it('back() walks 4→3→2 without touching downstream state', () => {
    useWizardStore.setState({
      step: 4,
      hits: [HIT_A],
      selectedHits: [HIT_A],
      stylePrompt: 'style xyz',
      progressEvents: [{ slot: '1', status: 'success' }],
    });
    useWizardStore.getState().back();
    expect(useWizardStore.getState().step).toBe(3);
    expect(useWizardStore.getState().hits).toEqual([HIT_A]);
    expect(useWizardStore.getState().selectedHits).toEqual([HIT_A]);
    expect(useWizardStore.getState().stylePrompt).toBe('style xyz');
    useWizardStore.getState().back();
    expect(useWizardStore.getState().step).toBe(2);
    expect(useWizardStore.getState().hits).toEqual([HIT_A]);
  });

  it('back() clamps at step 1', () => {
    const { back } = useWizardStore.getState();
    back();
    expect(useWizardStore.getState().step).toBe(1);
  });
});

describe('WizardStore — back-flow invalidation rule', () => {
  it('back() landing on step 1 clears hits/selectedHits/stylePrompt/progress', () => {
    useWizardStore.setState({
      step: 2,
      hits: [HIT_A],
      selectedHits: [HIT_A],
      stylePrompt: 'style xyz',
      progressEvents: [{ slot: '1', status: 'success' }],
    });
    useWizardStore.getState().back();
    const s = useWizardStore.getState();
    expect(s.step).toBe(1);
    expect(s.hits).toEqual([]);
    expect(s.selectedHits).toEqual([]);
    expect(s.stylePrompt).toBeNull();
    expect(s.progressEvents).toEqual([]);
  });

  it('back-to-1 preserves skuMeta/brandColor/locale/image/filters/sellingPoints', () => {
    useWizardStore.setState({
      step: 2,
      skuMeta: {
        sku: 'SKU-1',
        name: 'Item',
        brand: 'Brand',
        category: 'cat',
        product_type: 'type',
        price: '9.9',
      },
      brandColor: '#abcdef',
      locale: 'en',
      image: 'data:image/png;base64,xxx',
      filters: {
        category: 'cat',
        season: 'fall',
        min_sales: 100,
        fallback_locale: 'zh',
      },
      sellingPoints: ['point-1'],
      hits: [HIT_A],
    });
    useWizardStore.getState().back();
    const s = useWizardStore.getState();
    expect(s.step).toBe(1);
    expect(s.skuMeta.sku).toBe('SKU-1');
    expect(s.brandColor).toBe('#abcdef');
    expect(s.locale).toBe('en');
    expect(s.image).toBe('data:image/png;base64,xxx');
    expect(s.filters.season).toBe('fall');
    expect(s.sellingPoints).toEqual(['point-1']);
    expect(s.hits).toEqual([]);
  });
});

describe('WizardStore — setters', () => {
  it('setSkuMeta merges partials', () => {
    useWizardStore.getState().setSkuMeta({ sku: 'A1' });
    useWizardStore.getState().setSkuMeta({ brand: 'Acme' });
    const { skuMeta } = useWizardStore.getState();
    expect(skuMeta.sku).toBe('A1');
    expect(skuMeta.brand).toBe('Acme');
    expect(skuMeta.name).toBe('');
  });

  it('setFilters merges partials', () => {
    useWizardStore.getState().setFilters({ season: 'spring' });
    useWizardStore.getState().setFilters({ min_sales: 50 });
    const { filters } = useWizardStore.getState();
    expect(filters.season).toBe('spring');
    expect(filters.min_sales).toBe(50);
    expect(filters.category).toBeNull();
  });

  it('appendProgress accumulates events; resetProgress clears them', () => {
    useWizardStore.getState().appendProgress({ slot: '1', status: 'running' });
    useWizardStore.getState().appendProgress({ slot: '2', status: 'success' });
    expect(useWizardStore.getState().progressEvents).toHaveLength(2);
    useWizardStore.getState().resetProgress();
    expect(useWizardStore.getState().progressEvents).toEqual([]);
  });
});

describe('WizardStore — reset', () => {
  it('reset() restores every field to its initial value (with a fresh kitClientId)', () => {
    const original = useWizardStore.getState().kitClientId;
    useWizardStore.setState({
      step: 4,
      skuMeta: {
        sku: 'X',
        name: 'X',
        brand: 'X',
        category: 'X',
        product_type: 'X',
        price: 'X',
      },
      brandColor: '#ffffff',
      locale: 'en',
      image: 'data:image/png;base64,xxx',
      hits: [HIT_A],
      sellingPoints: ['p'],
      stylePrompt: 'style',
      progressEvents: [{ slot: '1', status: 'success' }],
    });
    useWizardStore.getState().reset();
    const s = useWizardStore.getState();
    expect(s.step).toBe(1);
    expect(s.skuMeta.sku).toBe('');
    expect(s.brandColor).toBe('#000000');
    expect(s.locale).toBe('zh');
    expect(s.image).toBeNull();
    expect(s.hits).toEqual([]);
    expect(s.sellingPoints).toEqual([]);
    expect(s.stylePrompt).toBeNull();
    expect(s.progressEvents).toEqual([]);
    // Fresh kitClientId on reset.
    expect(s.kitClientId).not.toBe(original);
    expect(s.kitClientId.length).toBeGreaterThan(0);
  });
});
