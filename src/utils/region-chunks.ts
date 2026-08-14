/**
 * Region-chunked fetching for heavy per-residue endpoints. The Proteins
 * API supports `location=begin-end` filtering (verified on the variation
 * endpoint), so instead of one monolithic download (~85MB for TITIN's
 * variants) the sequence is split into residue windows fetched in
 * parallel; the viewer merges features as chunks land and refreshes
 * summaries incrementally.
 */

export type RegionChunk = { start: number; end: number };

export const buildRegionChunks = (
  sequenceLength: number,
  chunkSize: number
): RegionChunk[] => {
  const chunks: RegionChunk[] = [];
  for (let start = 1; start <= sequenceLength; start += chunkSize) {
    chunks.push({
      start,
      end: Math.min(start + chunkSize - 1, sequenceLength),
    });
  }
  return chunks;
};

export const withLocationParam = (url: string, chunk: RegionChunk): string =>
  `${url}${url.includes('?') ? '&' : '?'}location=${chunk.start}-${chunk.end}`;

type FeaturePayload = {
  features?: Record<string, unknown>[];
  [key: string]: unknown;
};

const featureKey = (feature: Record<string, unknown>): string =>
  [
    feature.begin,
    feature.end,
    feature.wildType,
    feature.alternativeSequence,
    feature.ftId,
    Array.isArray(feature.genomicLocation)
      ? feature.genomicLocation.join(',')
      : feature.genomicLocation,
  ].join('|');

/**
 * Merge chunk payloads (in chunk order; missing entries are chunks that
 * have not arrived yet) into one payload shaped like the unchunked
 * response. Features spanning a window boundary can be returned by both
 * neighbouring chunks, so duplicates are dropped.
 */
export const mergeChunkPayloads = (
  payloads: (FeaturePayload | null | undefined)[]
): FeaturePayload | null => {
  const arrived = payloads.filter(
    (p): p is FeaturePayload => Boolean(p) && typeof p === 'object'
  );
  if (arrived.length === 0) return null;
  const seen = new Set<string>();
  const features: Record<string, unknown>[] = [];
  for (const payload of arrived) {
    for (const feature of payload.features ?? []) {
      const key = featureKey(feature);
      if (seen.has(key)) continue;
      seen.add(key);
      features.push(feature);
    }
  }
  // Non-feature metadata (sequence, accession, ...) is identical across
  // chunks; take it from the first arrived payload
  return { ...arrived[0], features };
};
