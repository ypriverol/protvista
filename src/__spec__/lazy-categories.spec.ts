import { afterEach, describe, expect, it, vi } from 'vitest';

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
import { validateConfig } from '../config-validator';

const featuresPayload = {
  features: [{ type: 'DOMAIN', begin: '10', end: '50' }],
};

const config = {
  categories: [
    {
      name: 'LIGHT',
      label: 'Light',
      trackType: 'nightingale-track-canvas',
      tracks: [
        {
          name: 'light-track',
          trackType: 'nightingale-track-canvas',
          tooltip: '',
          data: [
            {
              url: 'https://example.org/light/{accession}',
              adapter: 'feature-adapter',
            },
          ],
        },
      ],
    },
    {
      name: 'HEAVY',
      label: 'Heavy',
      trackType: 'nightingale-track-canvas',
      lazyThreshold: 100,
      tracks: [
        {
          name: 'heavy-track',
          trackType: 'nightingale-track-canvas',
          tooltip: '',
          data: [
            {
              url: 'https://example.org/heavy/{accession}',
              adapter: 'feature-adapter',
            },
          ],
        },
      ],
    },
  ],
};

type TestableInstance = {
  accession?: string;
  sequence?: string;
  config?: unknown;
  data: Record<string, unknown>;
  _deferredCategories: Set<string>;
  _loadData(): Promise<void>;
  _loadDeferredCategory(name: string): Promise<void>;
};

const createInstance = (sequenceLength: number): TestableInstance => {
  const instance = new ProtvistaUniprot() as unknown as TestableInstance;
  instance.accession = 'P00001';
  instance.sequence = 'M'.repeat(sequenceLength);
  instance.config = config;
  return instance;
};

describe('lazy heavy categories (lazyThreshold)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('defers categories above the threshold and never fetches their urls', async () => {
    const fetched: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        fetched.push(url);
        return { ok: true, json: async () => featuresPayload };
      })
    );
    const instance = createInstance(500); // longer than lazyThreshold 100
    await instance._loadData();
    expect(fetched.some((u) => u.includes('/light/'))).toBe(true);
    expect(fetched.some((u) => u.includes('/heavy/'))).toBe(false);
    expect(instance.data['LIGHT']).toBeTruthy();
    expect(instance.data['HEAVY']).toBeUndefined();
    expect(instance._deferredCategories.has('HEAVY')).toBe(true);
  });

  it('loads the deferred category on demand', async () => {
    const fetched: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        fetched.push(url);
        return { ok: true, json: async () => featuresPayload };
      })
    );
    const instance = createInstance(500);
    await instance._loadData();
    await instance._loadDeferredCategory('HEAVY');
    expect(fetched.some((u) => u.includes('/heavy/'))).toBe(true);
    expect(instance.data['HEAVY']).toBeTruthy();
    expect(instance._deferredCategories.has('HEAVY')).toBe(false);
  });

  it('loads everything eagerly for short proteins', async () => {
    const fetched: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        fetched.push(url);
        return { ok: true, json: async () => featuresPayload };
      })
    );
    const instance = createInstance(50); // below the threshold
    await instance._loadData();
    expect(fetched.some((u) => u.includes('/heavy/'))).toBe(true);
    expect(instance.data['HEAVY']).toBeTruthy();
    expect(instance._deferredCategories.size).toBe(0);
  });
});

describe('validateConfig lazyThreshold', () => {
  it('accepts a positive integer', () => {
    expect(
      validateConfig({
        categories: [
          {
            name: 'A',
            label: 'A',
            trackType: 'nightingale-track-canvas',
            tracks: [],
            lazyThreshold: 3000,
          },
        ],
      }).valid
    ).toBe(true);
  });

  it('rejects non-integers and non-positives', () => {
    for (const bad of ['3000', 0, -5, 2.5]) {
      const result = validateConfig({
        categories: [
          {
            name: 'A',
            label: 'A',
            trackType: 'nightingale-track-canvas',
            tracks: [],
            lazyThreshold: bad,
          },
        ],
      });
      expect(result.valid).toBe(false);
    }
  });
});
