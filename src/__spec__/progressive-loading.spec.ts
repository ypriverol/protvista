import { afterEach, describe, expect, it, vi } from 'vitest';

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

const featuresPayload = {
  features: [
    { type: 'DOMAIN', begin: '10', end: '50', description: 'fast feature' },
  ],
};

const config = {
  categories: [
    {
      name: 'FAST_CATEGORY',
      label: 'Fast',
      trackType: 'nightingale-track-canvas',
      tracks: [
        {
          name: 'fast-track',
          trackType: 'nightingale-track-canvas',
          tooltip: '',
          data: [
            {
              url: 'https://example.org/fast/{accession}',
              adapter: 'feature-adapter',
            },
          ],
        },
      ],
    },
    {
      name: 'SLOW_CATEGORY',
      label: 'Slow',
      trackType: 'nightingale-track-canvas',
      tracks: [
        {
          name: 'slow-track',
          trackType: 'nightingale-track-canvas',
          tooltip: '',
          data: [
            {
              url: 'https://example.org/slow/{accession}',
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
  config?: unknown;
  data: Record<string, unknown>;
  hasData: boolean;
  loading: boolean;
  _loadData(): Promise<void>;
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('progressive data loading', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders fast categories while a slow endpoint is still pending', async () => {
    let resolveSlow!: (value: unknown) => void;
    const slowBody = new Promise((resolve) => {
      resolveSlow = resolve;
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        json: () =>
          url.includes('/slow/') ? slowBody : Promise.resolve(featuresPayload),
      }))
    );

    const instance = new ProtvistaUniprot() as unknown as TestableInstance;
    instance.accession = 'Q8WZ42';
    instance.config = config;

    const done = instance._loadData();
    await flush();

    // The slow endpoint has NOT resolved, yet the fast category is already
    // processed, the loader dismissed, and data flagged as available.
    expect(instance.data['FAST_CATEGORY']).toBeTruthy();
    expect(instance.hasData).toBe(true);
    expect(instance.loading).toBe(false);
    expect(instance.data['SLOW_CATEGORY']).toBeUndefined();

    resolveSlow(featuresPayload);
    await done;
    expect(instance.data['SLOW_CATEGORY']).toBeTruthy();
  });

  it('still completes when one endpoint fails entirely', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/slow/')) throw new Error('network down');
        return { ok: true, json: () => Promise.resolve(featuresPayload) };
      })
    );

    const instance = new ProtvistaUniprot() as unknown as TestableInstance;
    instance.accession = 'Q8WZ42';
    instance.config = config;
    await instance._loadData();

    expect(instance.hasData).toBe(true);
    expect(instance.loading).toBe(false);
    expect(instance.data['FAST_CATEGORY']).toBeTruthy();
  });
});
