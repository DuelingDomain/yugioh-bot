# Remote vision board continuation

**Goal:** Port local outline peeks, sequential read-all with near/far grouping, and conservative covered-card confidence suppression from Duel Lens f6968f3.

**Design:** Keep recognition in the existing worker. A peek returns the best catalog name and tier without crop export, history or AI. Read-all detects once (or uses the same frame's supplied outlines), reads at most 60 cards sequentially, preserves per-card errors/face-down readings, and groups centers at y > .5 as near, otherwise far. The lab can fill a selected seat twin from either side, keeping uncertain/unknown slots explicit. Bind caches/results to the frozen snapshot and discard stale work on reset/cancellation.

**Covered adaptation:** Retain upstream COVERED bounds-fit thresholds for a competing pick versus a target outline, plus conservative polygon-overlap suppression for selected outlines. A single RGB frame cannot prove stacking order: distinct overlapping outlines may both become uncertain. Ignore duplicate outlines; do not claim hand/undetected occlusion detection or upstream calibration equivalence.

- [ ] Add one focused test file; verify missing behavior fails.
- [ ] Implement board/coverage helpers, pipeline and createRecognizer peek/readAll contracts; small commit.
- [ ] Integrate delayed hover/focus peeks, read-all/cancel and seat twins into the existing lab; small commit.
- [ ] Run targeted tests, package typechecks/build, offline synthetic native/browser measurements and review. Record numbers and limitations in README/REPORT/PORTING.
- [ ] Remove temporary upstream clone, push only feat/remote-vision; no PR/merge or attribution trailers.
