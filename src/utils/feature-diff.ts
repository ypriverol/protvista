/**
 * Feature-level comparison between the reference protein and an ortholog,
 * in reference coordinates: which annotations (PTMs, sites, motifs...)
 * are shared, which exist only in the reference, and which only in the
 * ortholog. This answers the biologist's actual question - "is this
 * phosphosite present in the other species?" - which a conservation band
 * alone cannot.
 */
import { projectToReference } from './alignment';

export type ComparableFeature = {
  start: number;
  end: number;
  type: string;
  description?: string;
};

export type DiffEntry = ComparableFeature & {
  /** the corresponding position(s) in the counterpart, when shared */
  counterpartStart?: number;
  counterpartEnd?: number;
};

export type FeatureDiff = {
  shared: DiffEntry[];
  referenceOnly: DiffEntry[];
  orthologOnly: DiffEntry[];
};

/** Only compact annotations are meaningfully diffable; large regions are
 * covered by the conservation band instead */
export const DIFF_MAX_SPAN = 30;

/** Residue tolerance when matching features across the alignment */
export const DIFF_TOLERANCE = 2;

/** Type aliases: large-scale and curated PTMs should match each other */
export const normaliseType = (type: string): string => {
  const upper = type.toUpperCase();
  if (upper === 'MOD_RES_LS') return 'MOD_RES';
  return upper;
};

const overlapsWithin = (
  a: { start: number; end: number },
  b: { start: number; end: number },
  tolerance: number
): boolean => a.start <= b.end + tolerance && b.start <= a.end + tolerance;

export const diffFeatures = (
  referenceFeatures: ComparableFeature[],
  orthologFeatures: ComparableFeature[],
  mapping: Int32Array
): FeatureDiff => {
  const reference = referenceFeatures.filter(
    (f) => f.end - f.start <= DIFF_MAX_SPAN
  );
  // Project ortholog features into reference coordinates once
  const projected = orthologFeatures
    .filter((f) => f.end - f.start <= DIFF_MAX_SPAN)
    .map((feature) => ({
      feature,
      target: projectToReference(mapping, feature.start, feature.end),
    }));

  const shared: DiffEntry[] = [];
  const referenceOnly: DiffEntry[] = [];
  const matchedOrtholog = new Set<number>();
  const matchedReference = new Set<number>();

  const describe = (f: ComparableFeature): string =>
    (f.description ?? '').trim().toLowerCase();

  // Two matching passes: same-description pairs first, so e.g. the
  // 'Zinc-binding' REGION pairs with its true counterpart rather than
  // with whichever overlapping REGION happens to come first; then a
  // type-only pass mops up description-less or reworded annotations.
  for (const requireDescription of [true, false]) {
    reference.forEach((ref, refIndex) => {
      if (matchedReference.has(refIndex)) return;
      const type = normaliseType(ref.type);
      for (let i = 0; i < projected.length; i += 1) {
        if (matchedOrtholog.has(i)) continue;
        const candidate = projected[i];
        if (!candidate.target) continue;
        if (normaliseType(candidate.feature.type) !== type) continue;
        if (
          requireDescription &&
          (!describe(ref) || describe(ref) !== describe(candidate.feature))
        ) {
          continue;
        }
        if (overlapsWithin(ref, candidate.target, DIFF_TOLERANCE)) {
          matchedOrtholog.add(i);
          matchedReference.add(refIndex);
          shared.push({
            ...ref,
            counterpartStart: candidate.feature.start,
            counterpartEnd: candidate.feature.end,
          });
          return;
        }
      }
    });
  }
  reference.forEach((ref, refIndex) => {
    if (!matchedReference.has(refIndex)) referenceOnly.push({ ...ref });
  });

  const orthologOnly: DiffEntry[] = [];
  projected.forEach((candidate, i) => {
    if (matchedOrtholog.has(i) || !candidate.target) return;
    orthologOnly.push({
      start: candidate.target.start,
      end: candidate.target.end,
      type: candidate.feature.type,
      description: candidate.feature.description,
      counterpartStart: candidate.feature.start,
      counterpartEnd: candidate.feature.end,
    });
  });

  shared.sort((a, b) => a.start - b.start);
  return { shared, referenceOnly, orthologOnly };
};
