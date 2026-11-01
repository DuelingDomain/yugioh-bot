# Fast STT finals, optional verification and tiny browser model

**Goal:** Make Parakeet the default, optionally correct uncertain card proposals with Whisper turbo, and measure a smaller browser option on the existing corpus.

**Design:** Preserve the service and browser APIs. Parakeet emits finals immediately. Only `STT_VERIFY=whisper` loads a second recognizer; a separate single-worker executor handles a bounded number of verification jobs without entering the final/partial inference queue. Verify low-scoring card matches (<0.95 by default) and attack/LP phrases. Emit a correction only when Whisper finds a different card identity at >=0.95, correlated by requestId. Failed, saturated or disconnected verification is best effort. No game actions run here.

Browser selection adds `model: 'whisper-tiny.en'` (WASM q8) beside default Parakeet, with an independently bundled worker/runtime and pinned local exports. Reuse identical PCM, hints, full-catalog matcher, warmups, seven release probe repetitions, 40 clips, no-store cold loads and Chrome-tree RSS sampling. Report transfer bytes separately from internet timing.

- [x] Extend only the existing matcher test with verification policy cases; observe failure, implement policy and rerun.
- [x] Change service/download/Compose defaults; add bounded background correction lifecycle and health/ready metadata.
- [x] Install pinned Transformers.js, add tiny worker/assets/download selection, reuse benchmark and scorer for either model.
- [x] Run Chrome WASM tiny benchmark in foreground and score all 40 clips; retain raw results.
- [x] Run native default and enabled verifier integration checks (including final-before-correction, connection reuse, disconnect and verifier failure).
- [x] Update README with defaults, thresholds, correction contract, measured browser numbers and reproduction commands.
- [x] Remove unused local model/cache files, review, verify, commit small changes without attribution and push feat/remote-stt. No PR.

**Validation:** Existing Python/JS matcher tests, Python compilation, browser production build, existing HTTP/WS smoke, direct verifier lifecycle integration and real Chrome benchmark/scorer. Do not add unit-test files or modify the main checkout. Stop only owned processes by PID.

Validation completed: existing Python tests (2), existing JS matcher test, clean browser install/build, Compose default rendering, real native default and enabled-verifier HTTP/WS smoke, seven controlled verifier lifecycle checks, and full Chrome WASM runs for both models. Tiny scorer verified 40 clips and zero JS/Python differences. A final offline real Engine startup after removing turbo confirmed Parakeet-only initialization and no faster_whisper import or download. Removed 1.51 GiB of optional model files; no owned services remain running. The branch is committed and pushed as requested; no PR.
