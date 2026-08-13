export const renameProperties = (
  features: { begin?: string | number; [key: string]: unknown }[]
) =>
  features.map((ft) => ({
    ...ft,
    start: ft.begin || undefined,
  }));

export const loadComponent = (
  name: string,
  elementConstructor: CustomElementConstructor
) => {
  if (!customElements.get(name)) {
    customElements.define(name, elementConstructor);
  }
};

export type FetchProgress = (loadedBytes: number, totalBytes?: number) => void;

// Fetches and parses a single url; resolves to null on any failure so that
// one slow or broken endpoint never rejects a whole batch. When onProgress
// is provided the body is streamed so large payloads (e.g. 85MB of TITIN
// variants) report download progress instead of appearing stalled.
export const fetchOne = async (
  url: string,
  onProgress?: FetchProgress
): Promise<unknown> => {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      // TODO handle this better based on error code
      // Fail silently for now
      console.warn(`HTTP error status: ${response.status} at ${url}`);
      return null;
    }
    if (!onProgress || !response.body) {
      return await response.json();
    }
    // NOTE: content-length reflects the compressed size while the reader
    // yields decompressed bytes, so the fraction is clamped by callers
    const total = Number(response.headers.get('content-length')) || undefined;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      onProgress(received, total);
    }
    const merged = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(new TextDecoder().decode(merged));
  } catch (error) {
    console.warn(`Failed to fetch or parse JSON from ${url}:`, error);
    return null; // or handle error data as needed
  }
};

// Returns an object of the form url => payload json
// getUrl optional function modifies url string
export const fetchAll = async (
  urls: string[],
  getUrl: ((url: string) => string) | null = null
) =>
  Object.fromEntries(
    await Promise.all(
      urls.map(async (url) => [url, await fetchOne(getUrl ? getUrl(url) : url)])
    )
  );
