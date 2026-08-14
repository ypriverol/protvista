# nightingale-track: data getter returns the processed copy

`set data(d)` stores `processData(d)` (normalized locations) and
`get data()` returns that processed object — never the raw object that
was assigned. Any consumer guard of the form

```ts
if (element.data !== myData) element.data = myData;
```

is always true, silently re-feeding the track (and re-running
`NonOverlappingLayout.init`) on every host re-render.

**Evidence:** in this viewer, every feature click on TITIN was a single
~2.1s main-thread longtask (CPU-profiled: `set data` → `createTrack` →
`NonOverlappingLayout.init` ≈ 95% of blocked time) because the identity
guard could never hold. 0ms after the workaround.

**Proposed upstream fix (any of):** short-circuit in the setter
(`if (d === this.#rawData) return;`); or return the raw object from the
getter; or document the asymmetry prominently.

**Our workaround:** last-assigned raw reference tracked in a WeakMap
(`_assignedTrackData` in
[src/protvista-uniprot.ts](../../src/protvista-uniprot.ts)).
