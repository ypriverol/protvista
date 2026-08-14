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

type TestableInstance = {
  accession?: string;
  sequence?: string;
  config?: { categories: { name: string; label: string }[] };
  data: Record<string, unknown>;
  _comparison?: { identity: number; organism: string };
  _comparisonError?: string;
  _startComparison(acc: string): Promise<void>;
  _clearComparison(): void;
};

const createInstance = (): TestableInstance => {
  const instance = new ProtvistaUniprot() as unknown as TestableInstance;
  instance.accession = 'P00001';
  instance.sequence = 'MKLVWAGHRT';
  instance.config = { categories: [] };
  return instance;
};

describe('ortholog comparison', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('injects the conservation category and projects ortholog features', async () => {
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
                {
                  type: 'ACT_SITE',
                  begin: '3',
                  end: '4',
                  description: 'catalytic',
                },
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
    expect(
      instance.config?.categories.some((c) => c.name === 'ORTHOLOG_COMPARISON')
    ).toBe(true);

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

    const projected = instance.data[
      'ORTHOLOG_COMPARISON-ortholog_features'
    ] as { start: number; end: number; tooltipContent: string }[];
    // ortholog ACT_SITE 3-4 = W,A which map to reference 5-6
    expect(projected).toHaveLength(1);
    expect(projected[0].start).toBe(5);
    expect(projected[0].end).toBe(6);
    expect(projected[0].tooltipContent).toContain('P99999 3–4');

    instance._clearComparison();
    expect(instance.data['ORTHOLOG_COMPARISON-conservation']).toBe(undefined);
    expect(
      instance.config?.categories.some((c) => c.name === 'ORTHOLOG_COMPARISON')
    ).toBe(false);
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
