# Full Remote Vision Implementation Plan

**Goal:** Build the complete local Yu-Gi-Oh artwork index, reduce CPU browser latency, prove the WebGPU path, and expose the Remote Duel client API.

**Architecture:** Retain the Apache-2.0 Duel Lens detector, embedder, search and runtime fallback. Extend the existing resumable builder to include Tokens/Skills. Serve isolated worker/runtime assets beneath the lab URL, with COOP/COEP only beneath `/dev/vision-lab` and `/duels/remote`. Keep the generic profile API and add the Yu-Gi-Oh game shorthand.

**Tech stack:** Node 22, TypeScript, ONNX Runtime Web/Node 1.30, Next 16, Playwright Chromium, sharp.

The user authorized implementation through small commits and branch push, without a PR/merge or further approval gates. Work only in this existing worktree. Use the existing single test file; all generated assets and raw measurement reports stay in ignored `data/vision`. Long jobs run as foreground commands with progress reporting. Never touch port 3000 or mutate the main checkout.

- [x] `scripts/vision/{catalog,build-index}.ts`: normalize the whole catalog including every alternate image, invalidate the old filtered catalog cache, record complete coverage/size/time; build with four native CPU threads and retain only 224px artwork and resumable vectors.
- [x] `packages/web/{next.config.ts,src/lib/fx-lab.ts,proxy.ts,app/dev/vision-lab/assets/[...path]/route.ts}` and `packages/vision/src/{client,web-runtime}.ts`: scope isolation headers, reuse the gated asset handler, enable explicit SIMD and threaded WASM. Check actual page/worker isolation and unaffected Clerk/YouTube routes.
- [x] `packages/vision/src/client.ts`: add `createRecognizer({game:'yugioh'})`, retain profile overrides, default top five and existing tiers/priors/lifecycle. Verify validation/lifecycle in the existing `vision.test.ts` and real browser inputs.
- [x] `scripts/vision/benchmark.ts`: preserve the seeded 30-photo corpus, measure full-index before/after with actual worker thread diagnostics; try unsafe WebGPU with SwiftShader and capture adapter/provider/fallback details. Tune CPU thread count if measurements justify it.
- [x] `packages/vision/README.md`: record commands, full coverage/exclusions, actual index/build/disk numbers, comparable latency results, WebGPU outcome and client usage. Verify package/web types, relevant existing web tests/build and header scoping. Review, commit small changes without attribution trailers, push only `feat/remote-vision`.


## Verification record

- Full catalog build exited 0: 14,652 named cards, 14,816 artwork vectors +back, no failed/missing/placeholder artworks; every catalog card/image ID and thumbnail audited. Binary 5,689,748 bytes; wall 3,318.094 seconds; 2,030 vectors reused, 12,786 embedded at 37.7 ms/art.
- Actual full-index Chromium worker comparison: one thread median/p95 483.4/535.4 ms; isolated four threads +SIMD 182.0/274.8 ms, API wall median 183.4 ms. Both top-1/top-5 30/30 on the same seeded synthetic corpus. Three-view temporal selection, ImageData/k=1, off-card fallback and native/WASM parity verified.
- Final SwiftShader run: all 30 recorded inferences remain on WebGPU, correct top-1/top-5, median 8,580.4 ms; cold 12,165.8 ms. Earlier probes during the build exercise the original 10-second watchdog and successful WASM fallback.
- Vision: eight tests in the one existing test file and TypeScript pass. Web: 50 selected existing auth/proxy/trailer tests, TypeScript, production build/standalone packaging pass. The worktree-local missing SQLite binding was repaired with Node 22 `npm rebuild better-sqlite3`; no dependency versions changed.
- Real lab upload returns five candidates without page errors. Trailer iframe opens/closes on a non-isolated page. Headers scoped to lab/remote paths; disabled production lab, worker, runtime and models return 404. Generated vision assets excluded from standalone. Live Clerk OAuth not exercised (keys unavailable); its routes receive no isolation headers.
- Independent review found no source defects; the documentation finding about embedding URL/profile identity was verified and clarified. Apache notices retained. All raw reports and generated assets remain under ignored data/vision, 535.48 MiB allocated after cleanup.
- Owned app/browser processes stopped; temporary SQLite and generated dev/standalone build copies removed. Main checkout status matches the initial state. Final branch push is performed after committing this record; no PR or merge.
