# Browser Parakeet implementation plan

> Execute inline in the existing `feat/remote-stt` worktree. The user has authorized implementation, measurement, commits and push; no PR or changes to the main checkout.

**Goal:** Measure Parakeet TDT 0.6B int8 in the player's browser and expose a small push-to-talk module with Python-equivalent card matching.

**Architecture:** A dedicated module worker owns ONNX Runtime Web sessions and card matching. `start()` loads once and begins an utterance, `pushAudio(Float32Array)` buffers bounded mono 16 kHz audio, and `stop()` returns transcript, normalized text, matches and timing. The UI supplies its own microphone/resampling and catalog. Self-host weights as static files; no inference server. Use parakeet.js's existing TDT implementation rather than implementing a second decoder. Explicit WASM and WebGPU modes must report the actual backend, never label CPU fallback as GPU.

**Tech stack:** Node 22, pinned parakeet.js / ONNX Runtime Web, ES modules, Playwright Chromium, Python benchmark utilities.

## Tasks

- [ ] Inspect existing service accuracy, probes, matcher and current browser runtimes. Compare sherpa WASM, parakeet.js and Transformers.js support; select an export compatible with the runtime, downloading only needed files under ignored `data/stt-models`.
- [ ] Add one small JS matcher regression test first; run it failing, port normalization, Double Metaphone/lexical scoring, cue gating, staple aliases and Unicode code-point spans. Compare saved Python hypotheses against JS as a benchmark verification, not another unit test.
- [ ] Implement the worker and small UI API with bounded audio, explicit backend selection, load errors, lifecycle handling and disposal. Add an isolated npm package, build scripts and a static measurement page/server with cross-origin-isolation headers.
- [ ] Run headless Chrome with WASM only and attempt software WebGPU. Measure empty-browser-cache model load, weight/runtime bytes, exact 1 s / 3 s probes (seven repetitions), full original 40-clip accuracy, matcher cost and process memory. Record failures and distinguish local transfer from internet download. Wait for foreground jobs and clean up only owned process PIDs.
- [ ] Document run/deploy instructions, API contract, compatibility sources and measured results in services/stt/README.md. Assess size/latency and recommend a smaller in-browser fallback if warranted, with documented sizes rather than invented latency.
- [ ] Review code, run the one JS test, existing Python test and production build, verify no models tracked, commit in small pieces without attribution, push feat/remote-stt and verify remote SHA. Final response includes earlier service model/table plus browser results and contracts.
