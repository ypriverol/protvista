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

import {
  buildRegionChunks,
  withLocationParam,
  mergeChunkPayloads,
} from '../utils/region-chunks';
import ProtvistaUniprot from '../protvista-uniprot';

describe('buildRegionChunks', () => {
  it('splits the sequence into inclusive windows', () => {
    expect(buildRegionChunks(10, 4)).toEqual([
      { start: 1, end: 4 },
      { start: 5, end: 8 },
      { start: 9, end: 10 },
    ]);
  });

  it('single window when the sequence fits', () => {
    expect(buildRegionChunks(3, 10)).toEqual([{ start: 1, end: 3 }]);
  });
});

describe('withLocationParam', () => {
  it('appends with ? or & as appropriate', () => {
    expect(
      withLocationParam('https://x/api/v/{accession}', { start: 1, end: 4 })
    ).toBe('https://x/api/v/{accession}?location=1-4');
    expect(withLocationParam('https://x/api?f=1', { start: 5, end: 8 })).toBe(
      'https://x/api?f=1&location=5-8'
    );
  });
});

describe('mergeChunkPayloads', () => {
  it('merges features in chunk order and keeps metadata', () => {
    const merged = mergeChunkPayloads([
      { sequence: 'MKLV', features: [{ begin: '1', end: '1' }] },
      { sequence: 'MKLV', features: [{ begin: '3', end: '3' }] },
    ])!;
    expect(merged.sequence).toBe('MKLV');
    expect(merged.features).toHaveLength(2);
  });

  it('drops duplicates returned by neighbouring windows', () => {
    const spanning = { begin: '4', end: '6', ftId: 'VAR_1' };
    const merged = mergeChunkPayloads([
      { features: [{ begin: '1', end: '1' }, spanning] },
      { features: [{ ...spanning }, { begin: '7', end: '7' }] },
    ])!;
    expect(merged.features).toHaveLength(3);
  });

  it('tolerates missing (not yet arrived) chunks', () => {
    const merged = mergeChunkPayloads([
      null,
      { features: [{ begin: '5', end: '5' }] },
      undefined,
    ])!;
    expect(merged.features).toHaveLength(1);
    expect(mergeChunkPayloads([null, undefined])).toBe(null);
  });
});

describe('region-chunked category loading', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const config = {
    categories: [
      {
        name: 'HEAVY',
        label: 'Heavy',
        trackType: 'nightingale-track-canvas',
        regionChunkSize: 10,
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
  };

  it('fetches windows automatically and assembles the category', async () => {
    const fetched: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        fetched.push(url);
        const location = url.match(/location=(\d+)-(\d+)/);
        return {
          ok: true,
          json: async () => ({
            features: [
              { type: 'DOMAIN', begin: location![1], end: location![1] },
            ],
          }),
        };
      })
    );
    const instance = new ProtvistaUniprot() as unknown as TestableInstance;
    instance.accession = 'P00001';
    instance.sequence = 'M'.repeat(25); // 25 residues, chunk size 10
    instance.config = config;
    await instance._loadData();

    const locations = fetched
      .map((u) => u.match(/location=([\d-]+)/)?.[1])
      .filter(Boolean);
    expect(locations).toEqual(['1-10', '11-20', '21-25']);
    // NOT deferred - loads automatically, no click required
    expect(instance._deferredCategories.size).toBe(0);
    const assembled = instance.data['HEAVY'] as unknown[];
    expect(assembled).toHaveLength(3); // one feature per window
  });

  it('uses a single plain request below the threshold', async () => {
    const fetched: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        fetched.push(url);
        return {
          ok: true,
          json: async () => ({
            features: [{ type: 'DOMAIN', begin: '1', end: '2' }],
          }),
        };
      })
    );
    const instance = new ProtvistaUniprot() as unknown as TestableInstance;
    instance.accession = 'P00001';
    instance.sequence = 'M'.repeat(5); // below chunk size
    instance.config = config;
    await instance._loadData();
    expect(fetched).toHaveLength(1);
    expect(fetched[0]).not.toContain('location=');
  });
});
