# Face state implementation plan

Goal: independent, CPU-only sleeve-aware face classification, without editing field-watcher.ts.
Architecture: sample a bounded portrait grid from a warped RGBA crop; combine uniformity, edge density and card-frame structure with optional detector and compatible bound-reference evidence. Abstain on ambiguity. Keep a per-track 300 ms sustain filter separate from classification.

- [x] Write one regression test for a bound face-up card flipping to white/colored/patterned sleeves, returning face-up, missing evidence and interrupted sustain; observe failure.
- [x] Implement packages/vision/src/face-state.ts and public exports. No image/model dependencies in the module.
- [x] Add a deterministic calibration script using existing face-up thumbnails, synthetic matte/glossy/patterned sleeves and available feedback crops; report held-out metrics and CPU timings without retaining generated images.
- [x] Document the precise watcher/owner-adapter insertion points and a 10–20 line integration example, including private identity, reverse reread and effect-context candidates for new Sets.
- [x] Run the single module test and vision typecheck, review the diff, commit and push feat/remote-facedown. Do not create a PR.
