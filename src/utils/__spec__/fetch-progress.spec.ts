import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchOne } from '../index';

const encode = (s: string) => new TextEncoder().encode(s);

const streamedResponse = (chunks: Uint8Array[], contentLength?: number) => {
  let i = 0;
  return {
    ok: true,
    headers: {
      get: (name: string) =>
        name === 'content-length' && contentLength
          ? String(contentLength)
          : null,
    },
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length
            ? { done: false, value: chunks[i++] }
            : { done: true, value: undefined },
      }),
    },
    json: async () => {
      throw new Error('json() must not be used when streaming');
    },
  };
};

describe('fetchOne with progress callback', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('streams the body, reports progress, and parses the JSON', async () => {
    const payload = JSON.stringify({ features: [{ type: 'DOMAIN' }] });
    const chunks = [encode(payload.slice(0, 10)), encode(payload.slice(10))];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => streamedResponse(chunks, payload.length))
    );
    const seen: [number, number | undefined][] = [];
    const result = await fetchOne('https://example.org/x', (loaded, total) =>
      seen.push([loaded, total])
    );
    expect(result).toEqual({ features: [{ type: 'DOMAIN' }] });
    expect(seen).toEqual([
      [10, payload.length],
      [payload.length, payload.length],
    ]);
  });

  it('still parses without a content-length header', async () => {
    const payload = JSON.stringify([1, 2, 3]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => streamedResponse([encode(payload)]))
    );
    const seen: (number | undefined)[] = [];
    const result = await fetchOne('https://example.org/x', (_, total) =>
      seen.push(total)
    );
    expect(result).toEqual([1, 2, 3]);
    expect(seen).toEqual([undefined]);
  });

  it('keeps the plain json() path when no callback is given', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ a: 1 }) }))
    );
    await expect(fetchOne('https://example.org/x')).resolves.toEqual({
      a: 1,
    });
  });
});
