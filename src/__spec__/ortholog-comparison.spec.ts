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

type DiffDatum = {
  start: number;
  end: number;
  type: string;
  tooltipContent: string;
};

type TestableInstance = {
  accession?: string;
  sequence?: string;
  config?: { categories: { name: string; label: string }[] };
  data: Record<string, unknown>;
  openCategories: string[];
  _comparison?: {
    identity: number;
    organism: string;
    diffCounts: { shared: number; referenceOnly: number; orthologOnly: number };
  };
  _comparisonError?: string;
  _startComparison(acc: string): Promise<void>;
  _clearComparison(): void;
};

const createInstance = (): TestableInstance => {
  const instance = new ProtvistaUniprot() as unknown as TestableInstance;
  instance.accession = 'P00001';
  instance.sequence = 'MKLVWAGHRT';
  instance.config = { categories: [] };
  // Reference protein annotations (track-level keys, as _loadData stores):
  instance.data['PTM-mod_res'] = [
    // phospho at 6: ortholog has the same site (its 4 maps here to 6)
    { start: 6, end: 6, type: 'MOD_RES', description: 'Phosphoserine' },
    // phospho at 3: falls in the region deleted from the ortholog
    { start: 3, end: 3, type: 'MOD_RES', description: 'Phosphothreonine' },
  ];
  return instance;
};

describe('ortholog comparison', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('diffs annotations into shared / reference-only / ortholog-only tracks', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/proteins/api/proteins/')) {
          return {
            ok: true,
            json: async () => ({
              // ortholog: LV deleted, otherwise identical
              sequence: { sequence: 'MKWAGHRT' },
              organism: {
                names: [{ type: 'scientific', value: 'Mus musculus' }],
              },
            }),
          };
        }
        if (url.includes('/proteins/api/features/')) {
          return {
            ok: true,
            json: async () => ({
              features: [
                // = reference phospho 6 (ortholog 4 -> reference 6)
                {
                  type: 'MOD_RES',
                  begin: '4',
                  end: '4',
                  description: 'Phosphoserine',
                },
                // ortholog-only site (maps to reference 5-6)
                {
                  type: 'ACT_SITE',
                  begin: '3',
                  end: '4',
                  description: 'catalytic',
                },
                // undiffable noise: must be ignored
                { type: 'VARIANT', begin: '2', end: '2' },
              ],
            }),
          };
        }
        throw new Error('unexpected url ' + url);
      })
    );
    const instance = createInstance();
    await instance._startComparison('P99999');

    expect(instance._comparisonError).toBe(undefined);
    expect(instance._comparison?.organism).toBe('Mus musculus');
    expect(instance._comparison?.identity).toBe(1); // aligned part identical
    // Category injected + auto-expanded
    expect(
      instance.config?.categories.some((c) => c.name === 'ORTHOLOG_COMPARISON')
    ).toBe(true);
    expect(instance.openCategories).toContain('ORTHOLOG_COMPARISON');

    const conservation = instance.data['ORTHOLOG_COMPARISON-conservation'] as {
      start: number;
      end: number;
    }[];
    // runs: 1-2 identical, 3-4 gap (deleted LV), 5-10 identical
    expect(conservation.map((r) => [r.start, r.end])).toEqual([
      [1, 2],
      [3, 4],
      [5, 10],
    ]);

    const shared = instance.data['ORTHOLOG_COMPARISON-shared'] as DiffDatum[];
    expect(shared).toHaveLength(1);
    expect(shared[0]).toMatchObject({ start: 6, end: 6, type: 'MOD_RES' });
    expect(shared[0].tooltipContent).toContain('both');

    const refOnly = instance.data[
      'ORTHOLOG_COMPARISON-reference_only'
    ] as DiffDatum[];
    // the phospho in the deleted region has no mouse counterpart
    expect(refOnly).toHaveLength(1);
    expect(refOnly[0]).toMatchObject({ start: 3, type: 'MOD_RES' });

    const orthoOnly = instance.data[
      'ORTHOLOG_COMPARISON-ortholog_only'
    ] as DiffDatum[];
    // ACT_SITE 3-4 (W,A) maps to reference 5-6; VARIANT is filtered out
    expect(orthoOnly).toHaveLength(1);
    expect(orthoOnly[0]).toMatchObject({ start: 5, end: 6, type: 'ACT_SITE' });
    expect(orthoOnly[0].tooltipContent).toContain('P99999 3–4');

    expect(instance._comparison?.diffCounts).toEqual({
      shared: 1,
      referenceOnly: 1,
      orthologOnly: 1,
    });

    instance._clearComparison();
    expect(instance.data['ORTHOLOG_COMPARISON-shared']).toBe(undefined);
    expect(instance.openCategories).not.toContain('ORTHOLOG_COMPARISON');
    expect(
      instance.config?.categories.some((c) => c.name === 'ORTHOLOG_COMPARISON')
    ).toBe(false);
  });

  it('a slow earlier pick cannot overwrite a later one', async () => {
    let releaseSlow: (() => void) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const slow = url.includes('/SLOW');
        if (slow && url.includes('/proteins/api/proteins/')) {
          await new Promise<void>((resolve) => {
            releaseSlow = resolve;
          });
        }
        if (url.includes('/proteins/api/proteins/')) {
          return {
            ok: true,
            json: async () => ({
              sequence: { sequence: slow ? 'MKLVWAGHRT' : 'MKWAGHRT' },
              organism: {
                names: [
                  { type: 'scientific', value: slow ? 'Slowus' : 'Fastus' },
                ],
              },
            }),
          };
        }
        return { ok: true, json: async () => ({ features: [] }) };
      })
    );
    const instance = createInstance();
    const first = instance._startComparison('SLOW1'); // hangs on entry fetch
    await instance._startComparison('FAST2');
    expect(instance._comparison?.organism).toBe('Fastus');
    releaseSlow?.();
    await first;
    // the stale run must not have replaced the newer comparison
    expect(instance._comparison?.organism).toBe('Fastus');
  });

  it('surfaces errors without breaking state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404 }))
    );
    const instance = createInstance();
    await instance._startComparison('BAD');
    expect(instance._comparison).toBe(undefined);
    expect(instance._comparisonError).toContain('404');
  });
});
