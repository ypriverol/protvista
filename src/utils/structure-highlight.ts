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
  // Bound the synchronous work up front: a 240k-variant track would
  // otherwise be fully collected and sorted just to keep 500 intervals.
  const inputCap = cap * 40;
  let collected: Interval[] = [];
  let inputTruncated = false;
  for (const trackData of trackDataList) {
    const intervals = collectIntervals(trackData);
    if (collected.length + intervals.length > inputCap) {
      collected = collected.concat(
        intervals.slice(0, inputCap - collected.length)
      );
      inputTruncated = true;
      break;
    }
    collected = collected.concat(intervals);
  }
  const merged = mergeIntervals(collected);
  const truncated = inputTruncated || merged.length > cap;
  const kept = merged.length > cap ? merged.slice(0, cap) : merged;
  return {
    highlight: kept.map(({ start, end }) => `${start}:${end}`).join(','),
    truncated,
  };
};

export type LegendEntry = {
  key: string;
  label: string;
  color: string;
  count: number;
  intervals: Interval[];
};

type LegendCategory = {
  name: string;
  label?: string;
  color?: string;
  tracks?: {
    name: string;
    label?: string;
    color?: string;
  }[];
};

/**
 * Human-readable legend for the tracks currently highlighted on the 3D
 * structure: the structure paint is a single colour (the nightingale
 * highlight channel), so the legend carries each selection's identity and
 * its 1D track colour instead.
 */
export const buildStructureLegend = (
  categories: LegendCategory[] | undefined,
  selectedKeys: Iterable<string>,
  trackData: Record<string, unknown>
): LegendEntry[] => {
  const entries: LegendEntry[] = [];
  for (const key of selectedKeys) {
    const separator = key.indexOf('-');
    const categoryName = key.slice(0, separator);
    const trackName = key.slice(separator + 1);
    const category = categories?.find((c) => c.name === categoryName);
    const track = category?.tracks?.find((t) => t.name === trackName);
    const intervals = mergeIntervals(collectIntervals(trackData[key]));
    entries.push({
      key,
      label: track?.label || trackName || key,
      color: track?.color || category?.color || '#00639a',
      count: intervals.length,
      intervals,
    });
  }
  return entries;
};

/** Parse a structure row's "672-711" coverage string */
export const parseCoverage = (positions?: string): Interval | undefined => {
  const match = positions?.match(/(\d+)\s*-\s*(\d+)/);
  if (!match) return undefined;
  const start = Number(match[1]);
  const end = Number(match[2]);
  return start <= end ? { start, end } : { start: end, end: start };
};

/** Parse a nightingale highlight string ("s:e,s:e") into intervals */
export const parseHighlightString = (highlight?: string): Interval[] =>
  (highlight ?? '')
    .split(',')
    .map((segment) => {
      const [start, end] = segment.split(':').map(Number);
      return { start, end: Number.isFinite(end) ? end : start };
    })
    .filter((i) => Number.isFinite(i.start) && i.start >= 1);

/** Clip intervals to a coverage range (drops non-overlapping ones) */
export const clipIntervalsToRange = (
  intervals: Interval[],
  range: Interval
): Interval[] =>
  intervals
    .map((i) => ({
      start: Math.max(i.start, range.start),
      end: Math.min(i.end, range.end),
    }))
    .filter((i) => i.start <= i.end);

/** Total residues of `intervals` covered by `range` */
export const overlapLength = (intervals: Interval[], range: Interval): number =>
  clipIntervalsToRange(intervals, range).reduce(
    (sum, i) => sum + (i.end - i.start + 1),
    0
  );
