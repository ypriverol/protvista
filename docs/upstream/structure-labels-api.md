# Proposal: labels/callout API on nightingale-structure

This viewer mirrors 1D feature selections (PTMs, variants, whole tracks)
onto the structure via the `highlight` attribute. Colour overlay works,
but users ask for callouts: a label/leader line at the highlighted
residue (e.g. "pS262" on a phosphosite), which Mol\* label representations
and measurement callouts already support natively.

**Blocker:** `nightingale-structure` keeps its Mol\* viewer instance in a
true-private field, so wrappers cannot create label representations from
outside; `highlight` (colour) is the only exposed channel.

**Proposal:** a `labels` property accepting
`Array<{ position: number; text: string; color?: string }>` (UniProt
coordinates, mapped through the same SIFTS machinery as `highlight`),
rendered as Mol\* label representations and cleared when the array
empties. Also aligns with the MolViewSpec/MolSequenceSpec direction —
label state is exactly the kind of 1D-3D shared state MSS wants to
standardise.
