/**
 * Aggregates the peptides of the Proteins API proteomics (nonPtm) payload
 * into per-residue coverage depth: how many peptides (all, and unique-only)
 * cover each position.
 *
 * This is the "summary-first" representation for dense peptide data: the
 * classic one-rectangle-per-peptide track becomes unreadable (and slow)
 * beyond a few hundred peptides, while this stays O(sequence length) no
 * matter how many peptides the resources accumulate. See
 * docs/design/scalable-dense-tracks.md.
 */

type PeptideFeature = {
  begin: string | number;
  end: string | number;
  unique?: boolean;
};

type ProteomicsData = {
  sequence?: string;
  features?: PeptideFeature[];
};

type LinegraphSeries = {
  name: string;
  range: number[];
  color: string;
  values: { position: number; value: number }[];
};

const transformData = (data: ProteomicsData): LinegraphSeries[] | undefined => {
  if (!data?.sequence || !data.features?.length) return undefined;
  const length = data.sequence.length;

  // Difference arrays -> prefix sums: O(peptides + length), positions are
  // 1-based (index 0 stays 0, matching the other graph adapters)
  const allDiff = new Int32Array(length + 2);
  const uniqueDiff = new Int32Array(length + 2);

  for (const { begin, end, unique } of data.features) {
    const start = Math.max(1, Math.trunc(+begin));
    const stop = Math.min(length, Math.trunc(+end));
    if (!Number.isFinite(start) || !Number.isFinite(stop) || stop < start) {
      continue;
    }
    allDiff[start] += 1;
    allDiff[stop + 1] -= 1;
    if (unique) {
      uniqueDiff[start] += 1;
      uniqueDiff[stop + 1] -= 1;
    }
  }

  const all = new Array<{ position: number; value: number }>(length + 1);
  const uniqueOnly = new Array<{ position: number; value: number }>(length + 1);
  let runningAll = 0;
  let runningUnique = 0;
  let max = 0;
  all[0] = { position: 0, value: 0 };
  uniqueOnly[0] = { position: 0, value: 0 };
  for (let position = 1; position <= length; position += 1) {
    runningAll += allDiff[position];
    runningUnique += uniqueDiff[position];
    if (runningAll > max) max = runningAll;
    all[position] = { position, value: runningAll };
    uniqueOnly[position] = { position, value: runningUnique };
  }

  const range = [0, max];
  return [
    {
      name: 'all peptides',
      range,
      color: 'darkgrey',
      values: all,
    },
    {
      // UniProt Franklin sea-blue, matching the viewer's link colour
      name: 'unique peptides',
      range,
      color: '#00639a',
      values: uniqueOnly,
    },
  ];
};

export default transformData;
