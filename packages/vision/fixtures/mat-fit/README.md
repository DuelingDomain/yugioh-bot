# Printed-mat fit regression fixtures

These are **camera pixels**, not desired grid coordinates. Both source captures contain the old yellow overlay that was a row off. Masking is fixture preparation only: product captures raw video before any overlay.

- `circuit-break-base.png` (1663 × 930, grayscale lossless): the prototype's `scratchpad/matfit/clean.png`, reachable on 2026-11-07. Original `frame.png` crop `(0,9)..(1663,939)`. The prototype's `prep.py` inpainted known overlay line bands (x=278.5+157.2*i, y=156.5+216.5*j) and label color BGR (188,235,255). The brief's `base_before.png` is a resized display of that source; we use the full-resolution cleaned source. Ground truth is the 14 **hand-annotated printed-box centres** from `proto/gt.py`, with named Deck/GY/S/M/Extra/Field assignments. The printed monster row is the lower visible full row. The inferred EMZ row extends below the camera; calibration must extrapolate rather than shift/clamp the visible rows.
- `circuit-break-prod.png` (928 × 521, grayscale lossless): `autodetect-prod/owner-grid-190ms.png`, camera crop x `[0,928)`, y `[16,537)` (UI sidebar excluded). OpenCV Telea radius 3 inpainted grid line bands at source x=160,247,334,421,508,595,682,770, y=102,223,344,465 (±2 pixels); label boxes centred x=203,290,377,464,552,639,726, y=162,283,403 (55×15); HUD rectangles `(0,18)..(276,112)` and `(0,503)..(632,537)`. Cards, piles and the owner's arm remain. Too few printed zones are exposed: this is an intentional refusal fixture, never grounds for a guessed board.

Sources are under `/tmp/claude-1000/-home-sulman633-repos-yugioh-bot/d30d5e56-3cea-46c2-b551-62f1705375ad/scratchpad/`. The prototype brief/code in the main checkout were read only. PNGs are grayscale to keep the set small; the algorithm uses luminance, including both bright and dark ridges.

The single `src/mat-fit.test.ts` generates ±rotation, missing Deck/GY column, blur and art-only variants from these pixels, plus a noisy-cloth negative. It checks named rows after serialization/reload, unchanged editor geometry, alternate-side row-window Flip, errors ≤0.1 pitch and refusal with no applicable calibration. No Python/OpenCV dependency is needed to run tests.

Measured on Node 22 and CPU-only Chromium 153 (2026-11-07):

| Frame | Mean / max centre error | Printed rows |
|---|---|---|
| Base | 2.67 / 5.37 px (pitch ~190 px) | 14/14 named zones correct |
| Rotated -6° | 2.36 / 6.80 px | correct |
| Rotated +8° | 3.55 / 7.77 px | correct |
| Occupied production screenshot | refused: two same-size printed zones | no calibration applied |

Browser client → isolated worker → result: **549, 440, 451 ms** at 832×465 processing resolution, GPU disabled, three fresh workers. Only client/worker/fixture were requested, with no ONNX model or index fetch. Node's process CPU check also enforces ≤1.5s; wall time under concurrent machine load is reported separately.

Limits: one physical mat design, two real captures, synthetic rotation/blur/crop variants; no real multi-mat corpus, low-end mobile timing, 90°/270° orientation, lens-distortion correction or EMZ ground-truth annotations. Mirroring is supplied as a prior (existing Mirror control). When full rows alone cannot decide side, the result flags `sideByPrior` and supplies an equally supported opposite-side fit including its alternate row window for the one-button Flip.
