# Remote Vision Implementation Plan

**Goal:** Implement the user's approved Remote Duels recognition slice, with an isolated browser worker, local index builder, gated lab, and measured WASM benchmark.

**Architecture:** A data-only GameProfile supplies card geometry, art crop, frame colours, card back, model preprocessing and index URLs. Pure pixel and vector functions are shared by the worker and offline builder. The browser client serializes requests to a worker; WebGPU session creation/inference failures fall back to WASM. The lab holds raw camera frames and sends snapshots only on demand.

**Tech stack:** TypeScript, onnxruntime-web, onnxruntime-node for offline embedding, sharp, Next.js, esbuild, Playwright for a real WASM benchmark.

## Files and steps

- [x] `packages/vision/src/{types,models,games/yugioh}.ts`: document profile and API contracts; retain 59x86 card and measured art box. Use original synthetic-only embedder and detector if their hashes match upstream documentation; otherwise explicitly document and use Apache DINOv2-S fallback.
- [x] `packages/vision/src/{pixels,geometry,detector/*}.ts`: port upstream pure preprocessing, perspective warp and detector decode/refinement with Apache headers and change notices. Preserve upstream licence and third-party notices, add root NOTICE.
- [x] `packages/vision/src/{search,index-format,quality,pipeline}.ts`: validate Float32/int8 indexes, select sharpest three frames, choose clicked card, warp/crop/embed, average and vote, bounded optional priors and conservative border-colour filtering. On missed detection use a lower-confidence card-shaped click crop. Validate in one small test file with actual pixel/vector cases.
- [x] `packages/vision/src/{runtime,worker,client,index}.ts`: ONNX in a serialized worker with WebGPU first and WASM fallback; transfer ImageBitmap ownership, support copied ImageData, surface errors, release resources.
- [x] `scripts/vision/{prepare,build-index,benchmark}.ts`: pinned resumable model setup; build our own art index using local cache and politely fetched YGOPRODeck crops. Measure a short sample before choosing full vs 2,000-card catalog. Keep all generated data ignored under data/vision. Bundle worker and runtime assets into data/vision for static dev serving.
- [x] `packages/web/app/dev/vision-lab/*`, static asset route, `src/lib/fx-lab.ts`, `proxy.ts`: gate page and assets using existing switch. Webcam, bounded one-second ring, normalized click mapping, upload, top five thumbnails/scores and quality/timings. No camera inference on main thread.
- [x] Real browser WASM benchmark: 24-30 reproducible synthetic scene photos including blur, perspective, glare and coloured sleeves; report top-1/top-5, detector coverage, median/p95 latency, cold load, hardware and limits. Also exercise multi-frame and fallback in browser.
- [x] Verify package types/tests, affected web gate tests and typecheck/build, inspect diff and licence provenance, review, small commits without attribution trailers, push feat/remote-vision (no PR or merge). Remove upstream scratch clone and stop only owned process PIDs. Confirm main checkout status unchanged.

User explicitly authorized implementation through push. This plan records that scope and does not introduce an additional approval gate. The user's one-test-file limit applies to the entire change; benchmark scripts are executable measurement tools, not additional test suites.

## Verification record

- Package: five tests in one 58-line file; TypeScript passes.
- Web: 38 existing proxy/auth tests pass; production build and standalone packaging pass.
- Actual Chromium worker/WASM: 30/30 top-1 and top-5; median 525.8 ms, p95 588.7 ms; cold wall 1285.4 ms. Six differently blurred frames select the sharpest three, ImageData/k=1 and off-card fallback pass, native/WASM cosine ~1.
- Lab: uploaded-photo recognition, all five cached thumbnails, numbered pick, name correction, JSON export, fake camera ring and Stop pass; card back identified. 390px layout has no overflow.
- Disabled production page, worker/model/thumbnail routes return 404. Generated data excluded from standalone output.
- Optional trainers: Python source compilation and preparation checked; labels preserved and stale index/profile inputs rejected. No training or physical webcam/GPU benchmark run.
- Local outputs: 2,000 cards, 2,030 artwork vectors plus back; no failed downloads/placeholders, 779,924-byte YGIX binary.
- Final branch push/cleanup is performed after this record is committed; no PR or merge.
