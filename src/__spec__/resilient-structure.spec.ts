import { describe, expect, it, vi, beforeEach } from 'vitest';

const selectMoleculeMock = vi.fn();

vi.mock('@nightingale-elements/nightingale-structure', () => {
  class MockNightingaleStructure extends HTMLElement {
    'structure-id'?: string;
    'custom-download-url'?: string;
    'model-url'?: string;
    showMessage = vi.fn();
    selectMolecule(): Promise<void> {
      return selectMoleculeMock.call(this);
    }
  }
  return { default: MockNightingaleStructure, amColorScale: () => '#fff' };
});

import { ResilientNightingaleStructure } from '../protvista-uniprot-structure';

// Structural type: intersecting with the real class collapses to `never`
// because of its private members.
type TestInstance = {
  'structure-id'?: string;
  'custom-download-url'?: string;
  showMessage: ReturnType<typeof vi.fn>;
  selectMolecule(): Promise<void>;
};

const createInstance = (structureId?: string): TestInstance => {
  const instance = Object.create(
    ResilientNightingaleStructure.prototype
  ) as unknown as TestInstance;
  instance['structure-id'] = structureId;
  instance.showMessage = vi.fn();
  return instance;
};

describe('ResilientNightingaleStructure', () => {
  beforeEach(() => {
    selectMoleculeMock.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('does nothing special when the model server works', async () => {
    selectMoleculeMock.mockResolvedValue(undefined);
    const instance = createInstance('8osd');
    await instance.selectMolecule();
    expect(selectMoleculeMock).toHaveBeenCalledTimes(1);
    expect(instance.showMessage).not.toHaveBeenCalled();
  });

  it('falls back to PDBe entry files when the model server fails', async () => {
    const seenUrls: (string | undefined)[] = [];
    selectMoleculeMock.mockImplementation(function (this: TestInstance) {
      seenUrls.push(this['custom-download-url']);
      return seenUrls.length === 1
        ? Promise.reject(new Error('502'))
        : Promise.resolve();
    });
    const instance = createInstance('8osd');
    await instance.selectMolecule();
    expect(seenUrls).toEqual([
      undefined,
      'https://www.ebi.ac.uk/pdbe/entry-files/download/',
    ]);
    // Restored so future selections try the model server first
    expect(instance['custom-download-url']).toBe(undefined);
    expect(instance.showMessage).not.toHaveBeenCalled();
  });

  it('shows an error instead of throwing when both sources fail', async () => {
    selectMoleculeMock.mockRejectedValue(new Error('503'));
    const instance = createInstance('8osd');
    await expect(instance.selectMolecule()).resolves.toBe(undefined);
    expect(selectMoleculeMock).toHaveBeenCalledTimes(2);
    expect(instance.showMessage).toHaveBeenCalledWith(
      'Error',
      expect.stringContaining('8osd')
    );
  });

  it('does not use the PDB fallback for AlphaFold structures', async () => {
    selectMoleculeMock.mockRejectedValue(new Error('boom'));
    const instance = createInstance('AF-Q8WZ42-F1');
    await expect(instance.selectMolecule()).resolves.toBe(undefined);
    expect(selectMoleculeMock).toHaveBeenCalledTimes(1);
    expect(instance.showMessage).toHaveBeenCalled();
  });
});
