# Full Remote Vision Implementation Plan

**Goal:** Build the complete local Yu-Gi-Oh artwork index, reduce CPU browser latency, prove the WebGPU path, and expose the Remote Duel client API.

**Architecture:** Retain the Apache-2.0 Duel Lens detector, embedder, search and runtime fallback. Extend the existing resumable builder to include Tokens/Skills. Serve isolated worker/runtime assets beneath the lab URL, with COOP/COEP only beneath `/dev/vision-lab` and `/duels/remote`. Keep the generic profile API and add the Yu-Gi-Oh game shorthand.

**Tech stack:** Node 22, TypeScript, ONNX Runtime Web/Node 1.30, Next 16, Playwright Chromium, sharp.

The user authorized implementation through small commits and branch push, without a PR/merge or further approval gates. Work only in this existing worktree. Use the existing single test file; all generated assets and raw measurement reports stay in ignored `data/vision`. Long jobs run as foreground commands with progress reporting. Never touch port 3000 or mutate the main checkout.

- [ ] `scripts/vision/{catalog,build-index}.ts`: normalize the whole catalog including every alternate image, invalidate the old filtered catalog cache, record complete coverage/size/time; build with four native CPU threads and retain only 224px artwork and resumable vectors.
- [ ] `packages/web/{next.config.ts,src/lib/fx-lab.ts,proxy.ts,app/dev/vision-lab/assets/[...path]/route.ts}` and `packages/vision/src/{client,web-runtime}.ts`: scope isolation headers, reuse the gated asset handler, enable explicit SIMD and threaded WASM. Check actual page/worker isolation and unaffected Clerk/YouTube routes.
- [ ] `packages/vision/src/client.ts`: add `createRecognizer({game:'yugioh'})`, retain profile overrides, default top five and existing tiers/priors/lifecycle. Verify validation/lifecycle in the existing `vision.test.ts` and real browser inputs.
- [ ] `scripts/vision/benchmark.ts`: preserve the seeded 30-photo corpus, measure full-index before/after with actual worker thread diagnostics; try unsafe WebGPU with SwiftShader and capture adapter/provider/fallback details. Tune CPU thread count if measurements justify it.
- [ ] `packages/vision/README.md`: record commands, full coverage/exclusions, actual index/build/disk numbers, comparable latency results, WebGPU outcome and client usage. Verify package/web types, relevant existing web tests/build and header scoping. Review, commit small changes without attribution trailers, push only `feat/remote-vision`.
