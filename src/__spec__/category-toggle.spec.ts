import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// jsdom lacks browser observers that the Nightingale elements imported by
// protvista-uniprot register at module load time.
vi.hoisted(() => {
  class ObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  Object.assign(globalThis, {
    ResizeObserver: ObserverStub,
    IntersectionObserver: ObserverStub,
    MutationObserver: globalThis.MutationObserver ?? ObserverStub,
  });
});

import ProtvistaUniprot from '../protvista-uniprot';

type TestableInstance = {
  openCategories: string[];
  everOpenedCategories: Set<string>;
  handleCategoryClick(e: MouseEvent): void;
  data: Record<string, unknown>;
  hasData: boolean;
  loading: boolean;
  accession?: string;
  sequence?: string;
  _resetViewerState(): void;
};

const makeLabel = (toggle: string) => {
  const el = document.createElement('div');
  el.setAttribute('data-category-toggle', toggle);
  el.className = 'category-label';
  return el;
};

const click = (target: Element) => ({ target }) as unknown as MouseEvent;

describe('deferred category expansion', () => {
  beforeEach(() => {
    // Make the rAF + setTimeout deferral synchronous-ish and controllable
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('opens a category after the deferral', () => {
    const instance = new ProtvistaUniprot() as unknown as TestableInstance;
    const label = makeLabel('DOMAINS');
    instance.handleCategoryClick(click(label));
    expect(label.classList.contains('open')).toBe(true);
    expect(instance.openCategories).toEqual([]);
    vi.runAllTimers();
    expect(instance.openCategories).toEqual(['DOMAINS']);
    expect(instance.everOpenedCategories.has('DOMAINS')).toBe(true);
  });

  it('a close click before the deferral fires cancels the expansion', () => {
    const instance = new ProtvistaUniprot() as unknown as TestableInstance;
    const label = makeLabel('DOMAINS');
    instance.handleCategoryClick(click(label)); // open (deferred)
    instance.handleCategoryClick(click(label)); // close before timer fires
    vi.runAllTimers();
    // The stale deferred open must NOT force the category back open
    expect(instance.openCategories).toEqual([]);
    expect(label.classList.contains('open')).toBe(false);
  });

  it('does not duplicate an already-open category', () => {
    const instance = new ProtvistaUniprot() as unknown as TestableInstance;
    const label = makeLabel('DOMAINS');
    instance.handleCategoryClick(click(label));
    vi.runAllTimers();
    label.classList.remove('open'); // simulate divergent classList
    instance.handleCategoryClick(click(label));
    vi.runAllTimers();
    expect(instance.openCategories).toEqual(['DOMAINS']);
  });
});

describe('_resetViewerState', () => {
  it('clears all per-protein state', () => {
    const instance = new ProtvistaUniprot() as unknown as TestableInstance;
    instance.data = { X: [1] };
    instance.hasData = true;
    instance.loading = false;
    instance.sequence = 'MAAA';
    instance.openCategories = ['DOMAINS'];
    instance.everOpenedCategories.add('DOMAINS');
    instance._resetViewerState();
    expect(instance.data).toEqual({});
    expect(instance.hasData).toBe(false);
    expect(instance.loading).toBe(true);
    expect(instance.sequence).toBe(undefined);
    expect(instance.openCategories).toEqual([]);
    expect(instance.everOpenedCategories.size).toBe(0);
  });
});
