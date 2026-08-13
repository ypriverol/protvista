# Design: mapping groups of features onto the 3D structure

Planned as the next stacked PR after coordinate navigation.

## Goal

Select a set of features in the 1D view (a whole track, a filter result,
or a manual multi-select) and see them **all highlighted at once on the 3D
structure**, colour-coded by feature type — e.g. all phosphosites, the
active site, and disease variants together on the AlphaFold model. Today
only single hover/click positions cross from 1D to 3D.

## Design

1. **Selection model**: a `selectedFeatures` set on `<protvista-uniprot>`
   (feature or whole-track granularity). UI entry points: a "show on
   structure" checkbox on each track label row, and shift-click on
   individual features.
2. **Residue set computation**: union of `start..end` per selected
   feature, merged into intervals; each interval tagged with its feature
   type's colour (reusing the track colours).
3. **Bridge to Mol\***: `nightingale-structure` already accepts a
   `highlight` attribute (ranges) and maps UniProt positions to PDB/AF
   coordinates via SIFTS mappings. Extend the wrapper
   (`ResilientNightingaleStructure`) to accept a list of
   `{start, end, color}` groups and drive Mol\* overpaint per group — AF
   models are 1:1 so mapping is trivial; PDB entries go through the
   existing mappings.
4. **Legend**: a small overlay in the structure pane listing the shown
   groups with their colours and a clear-all control.

## Constraints

- Keep it wrapper-side; touch upstream nightingale-structure only if
  per-group overpaint is impossible through the existing API.
- Cap total highlighted intervals (~500) to keep Mol\* responsive; beyond
  that, fall back to per-residue density colouring (consistent with
  [scalable-dense-tracks.md](./scalable-dense-tracks.md)).

## Relation to the roadmap

ROADMAP Years 2–3 target MolViewSpec / MolSequenceSpec alignment; shared
1D↔3D selection state is the natural precursor, and this feature should be
built so its selection model can later serialize to MSS expressions.
