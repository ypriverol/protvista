import {
  ProteinsAPIVariation,
  Variant,
} from '@nightingale-elements/nightingale-variation';

const transformData = (data: ProteinsAPIVariation) => {
  if (data.sequence && data.features.length) {
    const variants = (data.features as Variant[]).map((variant) => ({
      ...variant,
      accession: variant.genomicLocation?.join(', '),
      start: variant.begin,
    }));

    // Positions are 1-based and written at their own index, so the arrays
    // need length + 1 slots: with only `length`, a variant on the LAST
    // residue silently disappeared (out-of-range typed-array writes are
    // no-ops).
    const total = new Uint8ClampedArray(data.sequence.length + 1);
    const diseaseTotal = new Uint8ClampedArray(data.sequence.length + 1);

    for (const { start, association } of variants) {
      const index = +start;
      // skip if the variant is outside of bounds
      if (index < 1 || index > data.sequence.length) continue;

      total[index] += 1;

      if (!association) continue;
      const hasDisease = (association as { disease?: boolean }[]).find(
        (assoc) => assoc.disease === true
      );
      if (hasDisease) diseaseTotal[index] += 1;
    }

    const range = [0, Math.max(Math.max(...total), Math.max(...diseaseTotal))];
    const graphData = [
      {
        name: 'variant',
        range,
        color: 'darkgrey',
        values: [...total].map((value, index) => ({
          position: index,
          value: value,
        })),
      },
      {
        name: 'disease causing variant',
        range,
        color: 'red',
        values: [...diseaseTotal].map((value, index) => ({
          position: index,
          value: value,
        })),
      },
    ];
    return graphData;
  }
};

export default transformData;
