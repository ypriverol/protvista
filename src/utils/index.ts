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

// Fetches and parses a single url; resolves to null on any failure so that
// one slow or broken endpoint never rejects a whole batch.
export const fetchOne = async (url: string): Promise<unknown> => {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      // TODO handle this better based on error code
      // Fail silently for now
      console.warn(`HTTP error status: ${response.status} at ${url}`);
      return null;
    }
    return await response.json();
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
