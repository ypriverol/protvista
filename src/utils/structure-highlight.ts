/**
 * Turning groups of 1D features into a residue-interval highlight that can
 * be broadcast to the 3D structure (and every other track) through
 * nightingale-manager. See docs/design/feature-to-structure-mapping.md.
 */

export type Interval = { start: number; end: number };

/** Keep Mol* responsive: beyond this many merged intervals we truncate */
export const MAX_HIGHLIGHT_INTERVALS = 500;

type FeatureLike = {
  start?: number | string;
  begin?: number | string;
  end?: number | string;
};

/** Extract residue intervals from one track's transformed data */
export const collectIntervals = (trackData: unknown): Interval[] => {
  const features: FeatureLike[] = Array.isArray(trackData)
    ? (trackData as FeatureLike[])
    : trackData &&
        typeof trackData === 'object' &&
        Array.isArray((trackData as { variants?: FeatureLike[] }).variants)
      ? (trackData as { variants: FeatureLike[] }).variants
      : [];
  const intervals: Interval[] = [];
  for (const feature of features) {
    const start = Math.trunc(Number(feature.start ?? feature.begin));
    const end = Math.trunc(Number(feature.end ?? start));
    if (!Number.isFinite(start) || start < 1) continue;
    intervals.push({
      start,
      end: Number.isFinite(end) ? Math.max(start, end) : start,
    });
  }
  return intervals;
};

/** Merge overlapping/adjacent intervals into a minimal sorted set */
export const mergeIntervals = (intervals: Interval[]): Interval[] => {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: Interval[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i += 1) {
    const last = merged[merged.length - 1];
    const next = sorted[i];
    if (next.start <= last.end + 1) {
      if (next.end > last.end) last.end = next.end;
    } else {
      merged.push({ ...next });
    }
  }
  return merged;
};

/**
 * Build the nightingale highlight string ("s:e,s:e,…") for a set of tracks.
 * Returns the empty string when nothing is selected (which clears the
 * highlight when broadcast).
 */
export const buildHighlight = (
  trackDataList: unknown[],
  cap: number = MAX_HIGHLIGHT_INTERVALS
): { highlight: string; truncated: boolean } => {
  const merged = mergeIntervals(trackDataList.flatMap(collectIntervals));
  const truncated = merged.length > cap;
  const kept = truncated ? merged.slice(0, cap) : merged;
  return {
    highlight: kept.map(({ start, end }) => `${start}:${end}`).join(','),
    truncated,
  };
};
