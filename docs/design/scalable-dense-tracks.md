# Scaling dense tracks: summary-first, detail-on-demand

Proteomics resources double every few years; the Proteins API already
returns ~85MB of variants and hundreds of thousands of PSM-backed peptides
for extreme proteins (TITIN, Q8WZ42). Any design that draws **one glyph per
observation** loses twice as data grows: it becomes unreadable (overplotted
red rectangles) and slow (layout + draw is O(observations)).

This document defines the architecture this repository is converging on,
validated against how mature genome browsers solved the same problem (IGV's
coverage-then-reads threshold, JBrowse 2's pileup/SNPCoverage pair,
PeptideAtlas' sequence-painted coverage).

## The invariant

> Every dense data type gets TWO representations with a contract between
> them: an **O(sequence length) summary** that is always renderable at any
> zoom, and the **native per-observation detail**, rendered only when the
> user asks for it (expansion) and only for what is visible (viewport
> virtualization, zoom window).

Rendering cost is then bounded by pixels on screen, not by database growth.

## Per-data-type mapping

| Data type   | Summary (always cheap)                                                                  | Detail (on demand)                           |
| ----------- | --------------------------------------------------------------------------------------- | -------------------------------------------- |
| Peptides    | Coverage skyline: depth/residue, all vs unique (`proteomics-coverage-adapter`, shipped) | Packed peptide rectangles (existing tracks)  |
| Variants    | Count line graph (existing `variation-graph-adapter`)                                   | Position × residue matrix (variation canvas) |
| PTMs        | Events-per-residue lollipop or count graph (planned)                                    | Per-site glyphs with peptidoform tooltips    |
| RNA editing | Lollipop per edited site (planned; sparse events need position, not a matrix)           | Variation-canvas rows                        |
| Structures  | Count of structures covering each residue (planned)                                     | Per-entry rows + 3D viewer                   |

## Mechanisms already in this codebase

1. **Progressive fetch**: each category awaits only its own endpoints; one
   slow 85MB payload never blocks the rest.
2. **Mount once, hide on collapse**: re-expanding never re-processes.
3. **Deferred expansion**: the click paints before the heavy mount.
4. **Viewport virtualization**: track data is assigned via
   IntersectionObserver only when the track is within 250px of the
   viewport (the `nightingale-scrollbox` pattern, upstream PR #311).
5. **Reference-guarded assignment**: re-renders never re-feed unchanged
   data.
6. **Raw payload release**: fetched JSON is dropped once transformed.

## Next steps (in impact order)

1. **Windowed detail fetching**: the Proteins API supports positional
   filtering; when the visible window is a fraction of the sequence, fetch
   variants/peptides for that window only. This eliminates the 85MB
   download entirely — the summary track can be served by a (future)
   pre-aggregated endpoint or computed once server-side.
2. **Zoom-threshold switching** (the IGV rule): below ~1px/residue, render
   only the summary even when expanded; swap in the detail track when the
   user zooms past the threshold. Per-residue letter tracks (colored
   sequence) switch from heatmap band to letters at ~8px/residue.
3. **Lollipop track element** for sparse per-residue events (RNA editing,
   curated PTMs) — the cBioPortal/ProteinPaint convention.
4. **Source-diversity encoding** in the coverage skyline: colour saturation
   by number of independent resources (PeptideAtlas, ProteomicsDB, MaxQB…)
   observing each residue, turning the summary into an evidence-strength
   map rather than a raw count.

## Why not one clever track instead of two representations?

Opacity stacking, jittering, or WebGL brute force keep the
glyph-per-observation model alive longer but do not change its complexity
class, and none of them answer the reader's first questions ("how well is
this region covered? by how many independent sources?") without aggregation.
The two-representation contract is what IGV/JBrowse converged on after a
decade of genome-scale growth; protein data is following the same curve.
