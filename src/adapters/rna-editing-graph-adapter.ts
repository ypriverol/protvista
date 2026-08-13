import { RnaEditing } from './types/rna-editing';

const transformData = (data: RnaEditing) => {
  if (data.sequence && data.features.length) {
    // Positions are 1-based and written at their own index; length + 1
    // slots so an editing event on the last residue isn't silently dropped
    const total = new Uint8ClampedArray(data.sequence.length + 1);
    const missense = new Uint8ClampedArray(data.sequence.length + 1);
    const synonymous = new Uint8ClampedArray(data.sequence.length + 1);
    for (const feature of data.features) {
      const index = +feature.locationType.position.position;
      const consequence = feature.variantType.consequenceType;
      if (index >= 0 && index <= data.sequence.length) {
        total[index] += 1;
        if (consequence === 'missense') {
          missense[index] += 1;
        } else if (consequence === 'synonymous') {
          // TODO: at present the data contains only missense
          synonymous[index] += 1;
        }
      }
    }

    const range = [0, Math.max(...total)];
    const graphData = [
      {
        name: 'missense',
        range,
        color: 'darkgrey',
        values: [...missense].map((value, index) => ({
          position: index,
          value: value,
        })),
      },
      // TODO: at present the data contains only missense
      // {
      //   name: 'synonymous',
      //   range,
      //   color: 'red',
      //   values: [...synonymous].map((value, index) => ({
      //     position: index,
      //     value: value,
      //   })),
      // },
    ];
    return graphData;
  }
};

export default transformData;
