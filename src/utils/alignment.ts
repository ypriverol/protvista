/**
 * Client-side pairwise protein alignment (Needleman-Wunsch, linear gap
 * penalty) for the ortholog comparison feature. Produces a per-residue
 * position mapping between the two sequences plus a conservation status
 * for every reference residue - enough to answer "is this site conserved
 * in the ortholog?" without any server round-trip.
 *
 * Deliberately simple scoring (identity / similarity groups) rather than
 * a full BLOSUM matrix: orthologs are close enough that group-level
 * similarity is what a biologist reads off the track.
 */

const SIMILARITY_GROUPS = [
  'ILMV',
  'FWY',
  'KRH',
  'DE',
  'NQ',
  'ST',
  'AG',
] as const;

const groupOf = (aa: string): number => {
  for (let g = 0; g < SIMILARITY_GROUPS.length; g += 1) {
    if (SIMILARITY_GROUPS[g].includes(aa)) return g;
  }
  return -1;
};

const MATCH = 3;
const SIMILAR = 1;
const MISMATCH = -1;
const GAP = -4;

/** Refuse quadratic blow-ups (e.g. TITIN vs anything) honestly */
export const MAX_ALIGNMENT_CELLS = 25_000_000;

export type ConservationStatus = 'identical' | 'similar' | 'different' | 'gap';

export type PairwiseAlignment = {
  /** 1-based ref position -> 1-based ortholog position (0 = gap) */
  mapping: Int32Array;
  /** per 1-based ref position (index 0 unused) */
  status: ConservationStatus[];
  identity: number; // fraction of aligned reference residues identical
  alignedLength: number;
};

export const alignSequences = (
  reference: string,
  ortholog: string
): PairwiseAlignment => {
  const n = reference.length;
  const m = ortholog.length;
  if (n === 0 || m === 0) throw new Error('Empty sequence');
  if ((n + 1) * (m + 1) <= MAX_ALIGNMENT_CELLS) {
    return alignCore(reference, ortholog);
  }
  // TITIN-scale pairs: full dynamic programming is quadratic, but UniRef50
  // orthologs share long exact stretches, so anchor on those and only run
  // the expensive alignment in the short windows between anchors
  const anchored = alignAnchored(reference, ortholog);
  if (anchored) return anchored;
  throw new Error(
    `Sequences too long to align in the browser (${n} x ${m} residues), ` +
      `and not similar enough for fast anchored alignment`
  );
};

const alignCore = (reference: string, ortholog: string): PairwiseAlignment => {
  const n = reference.length;
  const m = ortholog.length;
  const width = m + 1;
  const score = new Float32Array((n + 1) * width);
  // 0 = diagonal, 1 = up (gap in ortholog), 2 = left (gap in reference)
  const trace = new Uint8Array((n + 1) * width);
  for (let j = 1; j <= m; j += 1) {
    score[j] = j * GAP;
    trace[j] = 2;
  }
  for (let i = 1; i <= n; i += 1) {
    score[i * width] = i * GAP;
    trace[i * width] = 1;
    const a = reference[i - 1];
    const groupA = groupOf(a);
    for (let j = 1; j <= m; j += 1) {
      const b = ortholog[j - 1];
      const substitution =
        a === b
          ? MATCH
          : groupA !== -1 && groupA === groupOf(b)
            ? SIMILAR
            : MISMATCH;
      const diagonal = score[(i - 1) * width + (j - 1)] + substitution;
      const up = score[(i - 1) * width + j] + GAP;
      const left = score[i * width + (j - 1)] + GAP;
      let best = diagonal;
      let direction = 0;
      if (up > best) {
        best = up;
        direction = 1;
      }
      if (left > best) {
        best = left;
        direction = 2;
      }
      score[i * width + j] = best;
      trace[i * width + j] = direction;
    }
  }

  const mapping = new Int32Array(n + 1);
  const status: ConservationStatus[] = new Array(n + 1).fill('gap');
  let identical = 0;
  let alignedLength = 0;
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const direction = trace[i * width + j];
    if (i > 0 && j > 0 && direction === 0) {
      mapping[i] = j;
      const a = reference[i - 1];
      const b = ortholog[j - 1];
      if (a === b) {
        status[i] = 'identical';
        identical += 1;
      } else if (groupOf(a) !== -1 && groupOf(a) === groupOf(b)) {
        status[i] = 'similar';
      } else {
        status[i] = 'different';
      }
      alignedLength += 1;
      i -= 1;
      j -= 1;
    } else if (i > 0 && (direction === 1 || j === 0)) {
      status[i] = 'gap';
      i -= 1;
    } else {
      j -= 1;
    }
  }
  return {
    mapping,
    status,
    identity: alignedLength ? identical / alignedLength : 0,
    alignedLength,
  };
};

/** Anchor seed length: 20^8 possible 8-mers makes repeats within one
 * protein rare, so unique shared 8-mers are trustworthy anchor points */
const KMER = 8;
/** Below this many co-linear anchors the sequences are not ortholog-like
 * and the anchored shortcut would produce a misleading mosaic */
const MIN_ANCHORS = 8;

/**
 * Anchored alignment for pairs too large for full dynamic programming:
 * find k-mers unique in both sequences, chain the co-linear subset
 * (longest increasing subsequence), trust each anchor as an exact match
 * and run Needleman-Wunsch only inside the windows between anchors.
 * Near-linear for real ortholog pairs (TITIN vs mouse TITIN in well under
 * a second). Returns undefined when too few anchors exist.
 */
const alignAnchored = (
  reference: string,
  ortholog: string
): PairwiseAlignment | undefined => {
  const n = reference.length;
  const m = ortholog.length;

  // Positions of k-mers unique within each sequence (-2 marks repeats)
  const orthologIndex = new Map<string, number>();
  for (let j = 0; j + KMER <= m; j += 1) {
    const kmer = ortholog.slice(j, j + KMER);
    orthologIndex.set(kmer, orthologIndex.has(kmer) ? -2 : j);
  }
  const referenceCount = new Map<string, number>();
  for (let i = 0; i + KMER <= n; i += 1) {
    const kmer = reference.slice(i, i + KMER);
    referenceCount.set(kmer, (referenceCount.get(kmer) ?? 0) + 1);
  }
  type Anchor = { i: number; j: number };
  const candidates: Anchor[] = [];
  for (let i = 0; i + KMER <= n; i += 1) {
    const kmer = reference.slice(i, i + KMER);
    if (referenceCount.get(kmer) !== 1) continue;
    const j = orthologIndex.get(kmer);
    if (j === undefined || j < 0) continue;
    candidates.push({ i, j });
  }
  if (candidates.length < MIN_ANCHORS) return undefined;

  // Longest increasing subsequence on ortholog positions (candidates are
  // already ordered by reference position) keeps only co-linear anchors,
  // discarding matches from shuffled or repeated domains
  const tails: number[] = [];
  const tailPositions: number[] = [];
  const parent = new Int32Array(candidates.length).fill(-1);
  for (let c = 0; c < candidates.length; c += 1) {
    const { j } = candidates[c];
    let low = 0;
    let high = tailPositions.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (tailPositions[mid] < j) low = mid + 1;
      else high = mid;
    }
    if (low > 0) parent[c] = tails[low - 1];
    tails[low] = c;
    tailPositions[low] = j;
  }
  const chain: Anchor[] = [];
  for (let c = tails[tailPositions.length - 1]; c !== -1; c = parent[c]) {
    chain.push(candidates[c]);
  }
  chain.reverse();

  // Keep a non-overlapping subset so inter-anchor windows are well formed
  const anchors: Anchor[] = [];
  let previousEndI = -1;
  let previousEndJ = -1;
  for (const anchor of chain) {
    if (anchor.i > previousEndI && anchor.j > previousEndJ) {
      anchors.push(anchor);
      previousEndI = anchor.i + KMER - 1;
      previousEndJ = anchor.j + KMER - 1;
    }
  }
  if (anchors.length < MIN_ANCHORS) return undefined;

  const mapping = new Int32Array(n + 1);
  const status: ConservationStatus[] = new Array(n + 1).fill('gap');
  let identical = 0;
  let alignedLength = 0;

  // Align one inter-anchor window ([start, end) in 0-based coordinates)
  // and merge its result into the global arrays with offsets applied
  const mergeSegment = (
    refStart: number,
    refEnd: number,
    orthoStart: number,
    orthoEnd: number
  ) => {
    const a = reference.slice(refStart, refEnd);
    const b = ortholog.slice(orthoStart, orthoEnd);
    if (!a.length || !b.length) return; // pure insertion/deletion: gap
    // A pathological window (huge divergent stretch) stays unaligned
    // rather than blowing the memory budget
    if ((a.length + 1) * (b.length + 1) > MAX_ALIGNMENT_CELLS) return;
    const segment = alignCore(a, b);
    for (let t = 1; t <= a.length; t += 1) {
      status[refStart + t] = segment.status[t];
      const mapped = segment.mapping[t];
      if (mapped > 0) {
        mapping[refStart + t] = orthoStart + mapped;
        alignedLength += 1;
        if (segment.status[t] === 'identical') identical += 1;
      }
    }
  };

  let cursorI = 0;
  let cursorJ = 0;
  for (const anchor of anchors) {
    mergeSegment(cursorI, anchor.i, cursorJ, anchor.j);
    for (let t = 0; t < KMER; t += 1) {
      mapping[anchor.i + t + 1] = anchor.j + t + 1;
      status[anchor.i + t + 1] = 'identical';
      identical += 1;
      alignedLength += 1;
    }
    cursorI = anchor.i + KMER;
    cursorJ = anchor.j + KMER;
  }
  mergeSegment(cursorI, n, cursorJ, m);

  return {
    mapping,
    status,
    identity: alignedLength ? identical / alignedLength : 0,
    alignedLength,
  };
};

export type ConservationRun = {
  start: number;
  end: number;
  status: ConservationStatus;
};

/** Compress per-residue statuses into contiguous runs for cheap rendering */
export const conservationRuns = (
  status: ConservationStatus[]
): ConservationRun[] => {
  const runs: ConservationRun[] = [];
  for (let position = 1; position < status.length; position += 1) {
    const current = status[position];
    const last = runs[runs.length - 1];
    if (last && last.status === current && last.end === position - 1) {
      last.end = position;
    } else {
      runs.push({ start: position, end: position, status: current });
    }
  }
  return runs;
};

/**
 * Project an ortholog feature onto reference coordinates through the
 * alignment. Returns undefined when neither endpoint maps (deleted
 * region in the reference).
 */
export const projectToReference = (
  mapping: Int32Array,
  orthologStart: number,
  orthologEnd: number
): { start: number; end: number } | undefined => {
  // Invert lazily: find reference positions mapping into the range
  let start: number | undefined;
  let end: number | undefined;
  for (let ref = 1; ref < mapping.length; ref += 1) {
    const ortho = mapping[ref];
    if (ortho >= orthologStart && ortho <= orthologEnd) {
      if (start === undefined) start = ref;
      end = ref;
    }
  }
  if (start === undefined || end === undefined) return undefined;
  return { start, end };
};
