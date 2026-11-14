# Hybrid card reader

Remote Duels has two device-local readers: **Current** (the default) and **Hybrid**. The switch is inside the signed-in camera settings in the lobby and at a running table. It restarts the reader and watcher through the existing processor-switch lifecycle; the table, camera and saved board stay open. Nothing opts an existing user into Hybrid.

Choose **Card reader → Hybrid**, or append `?visionReader=hybrid` to the actual table URL (`&visionReader=hybrid` when it already has a query). On localhost this is `http://localhost:3000/duels/remote/<slug>?visionReader=hybrid`; the same parameter works on the production app origin. `visionReader=current` forces the default for that page. The UI choice is saved as `dd-remote-card-reader` in localStorage, alongside the existing `dd-remote-recognition-mode` setting. The query overrides storage at page initialization; remove it before testing saved choices after a reload. The processor selector still controls the unchanged detector and the current compatibility reader.

## Name read and product rules

The four-corner `card-detector.onnx` is unchanged. Stage one uses DuelSight's MobileNetV3-Small recognizer (about 4.0 MB): a whole-card 295×430 warp, both 0° and 180° orientations, exact `full128` pool-version-2 area pooling to 128 px, and float32 `[-1,1]` normalization. Its fp16 bank is decoded and every row renormalized using the released decoder. For each identity, take the maximum score across artwork rows and both orientations. Accept the name at **score ≥ 0.68 AND distinct-identity margin ≥ 0.06**, the released constants. Both distinct competitors must exist. Temporal frames must agree; name-based re-ranking cannot replace the visual winner on a first-stage exit.

Otherwise stage two runs Light, a six-layer distilled DINOv2-small model (about 13.3 MB), using its published **v3b** index. It receives the artwork window with the eval harness's rounded origin/size, RGB/ImageNet normalization and 224 px input; its graph internally resizes to 168 px. It uses the product's current score/margin/floor rules, including any validated `yugioh-thresholds.json`. Calibration is loaded and validated against the original model/index before its thresholds are carried to Light; this does **not** establish a separate calibration of Light.

Both stages use the existing read pipeline for warp, pre-clean retry, temporal agreement, name priors, deck preference, context re-ranking and quality gates. A name passing the first gate can still be **not sure** because of the existing partial/covered/full-art/other quality rules; selecting a stage never bypasses placement or confirmation rules. Stage one always checks both orientations; stage two retains the product's existing orientation and early-exit behavior. Prompts, Best match, tracking and Set/placement policy are unchanged.

Reference compatibility is explicit:

- Deck lists, seen/related cards, voice hints and frame restrictions use mapped catalog identities. They can operate in either bank. A first-stage rank/visual disagreement escalates.
- New local gallery vectors carry their model ID. DuelSight galleries apply to DuelSight; a Light gallery routes to Light. Current and Light both have 384 dimensions but are never compared. Legacy untagged vectors belong to Current. The gallery survives a reader switch, with compatible reads preserving its use.
- Existing server corrections/confusions, untagged current session galleries, opted-in feedback collection, or an installed current whole-card index route to the **current compatibility reader**. These appear as `stage: second, model: current` with the reason. This retains corrections, feedback provenance and full-art matching instead of using incompatible vectors. In those cases this is deliberately more expensive than offline “number 6”. No new learning upload format is introduced.
- Bank scope is the union of the pinned catalogs, not the eval's common-identity intersection. Name matching folds case, apostrophes and repeated spaces, never fuzzy spelling. Unmatched numeric DuelSight identities retain their own published name/ID; Light-only identities remain available to stage two. The app's catalog lookup may still lack a newer bank identity.

## Runtime and failure

Only a selected Hybrid reader fetches/decodes its extra models, bank, index and catalog. Default worker initialization does not send the hybrid option, import its loader, or fetch hybrid assets. Current's preprocessing and fixture result bytes are frozen in a regression captured from the pre-change `HEAD`.

The two new recognizers intentionally run on **WASM only**, with the existing runtime's one-thread or multi-thread configuration. They do not yet have WASM-derived WebGPU self-check references. The detector and current compatibility reader keep the existing WebGPU → WASM fallback. Single-worker and split-worker layouts use the same worker implementation; the scene-only worker never loads Hybrid. Current remains ready in the selected Hybrid read worker to provide fallback and compatible features, so Hybrid has a larger resident footprint.

An asset/network/hash/session failure keeps Current ready and shows **“Hybrid reader could not load. Using the current reader. Switch readers to retry.”** An inference failure similarly switches to Current. The failure is sticky for this reader instance; switching Current → Hybrid retries. There is no recurring download retry on watcher ticks.

`RecognitionResult.reader` carries selected reader, answering stage/model, first/second raw top score, runner-up, distinct margin and elapsed ms, total ms and any compatibility reason. It appears in the owner zone-grid Debug overlay, `.ddclip` read/watcher sidecars, field timing events and persisted **`cam.reader`** action evidence. Geometry/timing-only evidence contains no pixels or names. Reads that produce no game action remain available in the local clip read sidecar, rather than inventing a table event. Stage timers include the product pipeline work for that stage; they are not pure ONNX inference timers.

## Prepare and deliver assets

No models, indexes, card images or eval footage are added to Git. The existing `scripts/vision/prepare.ts` owns preparation. The Dockerfile's existing `--code-only` build stays offline and includes the new worker code; binary data still lives in the mounted `data/vision` volume. `--code-only` refuses `--hybrid`.

From this checkout, with an existing prepared Current installation:

```sh
export PATH=/Users/imranqureshi/.nvm/versions/node/v22.23.4/bin:$PATH
export VISION_HYBRID_SOURCES=/Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/sources
npx tsx scripts/vision/prepare.ts --hybrid --bundle-only
npm run dev --workspace=packages/web -- --port 3000
```

`--bundle-only` avoids re-fetching Current models; `--hybrid` explicitly prepares the new data as well as rebuilding local worker/runtime code. This worktree has the Hybrid assets prepared from the retained eval source. If Current's data is absent, install the deployment's existing prepared Current `models/`, `yugioh-index.*` and any threshold/full-art/related files into `data/vision` first, as in [vision setup](../../packages/vision/README.md). The hybrid command does not substitute an eval index for the product's current index. `VISION_DATA_DIR` may be an absolute alternative directory, consistently set in preparation and web.

For a fresh preparation on another machine, unset `VISION_HYBRID_SOURCES` and run the same prepare command. It fetches only the pinned GitHub revision files and the checksum-pinned DuelSight v0.8.0 archive. Archive reads use Python 3's standard library (or `VISION_PYTHON`); no upstream code is executed. The prepared `hybrid/` directory contains four binary assets (two models, the bank and the Light index), two catalog/index JSON files, and notices. Verified inputs remain in ignored `hybrid-sources/`; do not ship that source cache.

Production follows the existing manual data procedure in [VM runbook, Remote Duels step 5](../deployment/vm-runbook.md#remote-duels). After the owner deploys the code, copy just the additive Hybrid directory, retaining the existing Current files:

```sh
# Owner operation, from the prepared checkout; replace <vm>.
rsync -a data/vision/hybrid/ root@<vm>:/opt/yugioh-bot/data/vision/hybrid/
# On that VM, from /opt/yugioh-bot:
chown -R 1000:1000 data/vision/hybrid
chmod -R a+rX data/vision/hybrid
```

A new image carries `/app/vision-code/worker.js` and matching `ort/`; the authenticated `/dev/vision-assets/hybrid/*` route reads the volume. No Compose env/build-argument change, new public route, API provider, database migration, or default-reader change is needed. A browser choosing Hybrid before the data copy gets the visible Current fallback. Reload/switch after data installation. No deployment or remote copy was performed for this change.

## Sources, licenses and SHA-256

- Current detector and v3b bank/catalog: [Duel Lens f6968f3682d53a79c4a9fef591300615eda61c11](https://github.com/mathulbrich/duel-lens/tree/f6968f3682d53a79c4a9fef591300615eda61c11), `extension/models/detector/card-detector.onnx`, `extension/data/index-dinov2-small-duel-v3b.{bin,meta.json}`, `extension/data/cards.json`.
- Light: [Duel Lens de87d44e2822a25a2dc481a27ed3c2881ce9ad03 registry](https://github.com/mathulbrich/duel-lens/blob/de87d44e2822a25a2dc481a27ed3c2881ce9ad03/src/shared/models.ts), `extension/models/dinov2-small-duel-v3b-light.q8.onnx`.
- DuelSight: [v0.8.0 archive](https://github.com/ryangswe/duelsight/releases/download/v0.8.0/duelsight-0.8.0.zip), release model ID `862aec0f937da326`; only `release/recognizer.onnx`, `bank.bin` and `catalog.json` are used. Its detector is not used.
- Exact pool and bank decoder: [riftsight-vision 5ef332a7da58508b1ff9747fe1cf0ba4f70af30b](https://github.com/ryangswe/riftsight-vision/tree/5ef332a7da58508b1ff9747fe1cf0ba4f70af30b), Apache-2.0, retained under `packages/vision/src/duelsight` with notices.

| Asset | SHA-256 |
|---|---|
| Unchanged four-corner detector | `542a03b523cb1398a1b5437dae665908b3bdf61be9b30a2a52e7bcea25dce03c` |
| DuelSight archive | `dd90b32888b9a6a7441937c4281cc057cf736049185088d269c8f2caa296df1c` |
| DuelSight recognizer | `0722ca4a2b9e76b37f3e0d32b78bb1d9afd5d040d219de3560a322c98a966d79` |
| DuelSight bank | `cc3e74968039c687a65e4fc7b0ddfc291dcc8e879973010f2da114b5cd3949ab` |
| DuelSight source catalog | `42c96e83f81258c71f29cc80453cf3deab6cb55102be7ac10ee36d531bd88776` |
| Light recognizer | `b82ad6b73f4965f5fbe5aa850de7a5e78f8819348b15b02402d2cdbc112e497c` |
| v3b / Light binary index | `c4dcfa1503f6e26b98b960f1d3c6d10df2e8b55812a4181be1842d20097ba923` |
| v3b source metadata | `3db72869e5cd8e5fda7aeff969cb96595f152caa840d910e61e6610df51bff55` |
| Duel Lens source catalog | `9b3dd40140aade141c2a0f7bc89d34e079b4142178dd5d9a4bdd864c7d8762ef` |
| Prepared union catalog | `5b2e6781d2337bbe8233f76532f76990f22ec7f63d9c6e9e0aeb78501d555578` |
| Prepared Light metadata | `5d4ba62c8af9a024fae492801d9aa59287ddcf68bd0d54b0f617ebdbefb3a6b2` |

Runtime verifies all six Hybrid data files, not just the weights. Preparation verifies every input and the deterministic metadata output. Original Apache-2.0 licenses, DuelSight NOTICE/PROVENANCE and Light THIRD_PARTY_NOTICES are retained in source and copied beside the assets. Upstream grants cover their own work; card artwork, video and pretraining material retain their owners' rights. **The owner approved use of models trained on public tournament video. A license check of the Light and DuelSight weights is still advised before a wider release.** This records that approval and the upstream notices, not a new license conclusion.

## Measurements and proof limits

Owner-provided offline comparison (“number 6”), 500 labeled cards: **Current 489 correct at about 370 ms/read; Hybrid 493 correct at about 30 ms mean**, with about 4 ms for the first read and 111 ms when the second ran, on browser WASM with two threads. About 23% escalated; **one confident-wrong first-stage answer in 500**. Timers exclude detector/capture/startup. These are eval measurements, not performance targets or measurements of this integrated feature.

The source report is `docs/remote-duels/vision-youtube-eval.md` in the sibling eval worktree. It also contains separately scoped native-runtime results: do not mix those timings with the browser numbers. The collection uses YouTube footage and agent-made labels **not reviewed by a person**. Repeated cards/frames are correlated; readable-frame selection, training overlap and a common-bank identity scope limit generalization. The product uses broader bank scope, its own detector/quality gates, pre-cleaning, priors and compatible-reference routes, so its accuracy, escalation fraction and latency need fresh live evaluation. This change does not claim 493/500 in the product.

Local verification cannot establish camera timing, WebGPU/browser worker behavior or a deployed data copy. Before production comparison, use a real signed-in browser on port 3000 and production: check default has no `hybrid/*` requests; switch mid-table; confirm both answering stages, a missing/corrupt-asset fallback, deck priors and a gallery correction; test single-worker/one-thread and split/multi-thread modes, GPU detector and WASM fallback; export a clip and inspect `cam.reader` in a saved action. Chrome cannot be run in this sandbox.

## Verification receipt (14 November 2026)

Baseline: `345d4ed0d24e10048fa3b5b8aaf86697fc8db30b`. Node 22.23.4.

- `npm run build --workspace=packages/shared`: passed.
- `npm run typecheck --workspace=packages/vision` and `npm run typecheck --workspace=packages/web`: passed.
- `npm test --workspace=packages/vision`: **322 passed, 2 failed, 324 total**. Both failures reproduce from the unmodified HEAD source in an isolated temporary copy: `mat-fit.test.ts:78` exceeds its 1500 ms CPU budget (1782 ms in the final full run; 2797 ms on HEAD), and `pipeline.test.ts:214` expects context `[1,3]` but receives `[1,3,4]` on both versions. No assertions or unrelated code were changed.
- New `hybrid.test.ts`: **15 passed**, including the default tensor/result bytes captured from HEAD, first-stage gate, cross-orientation competitor, cascade/floor, priors, incompatible references, real loader checksum/404 failures, sticky inference fallback, catalog union, and exact crop preprocessing.
- Web: **141 passed across 4 files**: `remote-card-reader.test.tsx` (5), `remote-recognition.test.ts`, `remote-test-recording-route.test.ts`, `vision-assets-route.test.ts`. Command: `npx vitest run packages/web/tests/remote-card-reader.test.tsx packages/web/tests/remote-recognition.test.ts packages/web/tests/remote-test-recording-route.test.ts packages/web/tests/vision-assets-route.test.ts -c packages/web/vitest.config.ts --no-file-parallelism --testTimeout=30000`. Two existing tests timed out in the earlier concurrent run; the serial run passes without assertion changes.
- `check-hybrid-runtime.ts`: **4/4 retained eval crops correct on WASM with 1 thread, and 4/4 with 2 threads**, three first-stage answers and one Light answer in each process. The Node harness substitutes the identical local pthread module file for a browser Blob URL; it does not prove browser worker loading or performance. There was no existing image golden for the current recognizer; mat-fit image fixtures test a different subsystem. The new opt-in real-asset regression uses existing retained eval crops without committing footage or images.
- Asset preparation and offline `--code-only` worker/runtime build: passed. `git diff --check`: passed.

Re-run the real-asset checks (each command starts a separate runtime):

```sh
export VISION_HYBRID_EVAL_DATA=/Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval
npx tsx scripts/vision/check-hybrid-runtime.ts --threads 1
npx tsx scripts/vision/check-hybrid-runtime.ts --threads 2
```

Sanitized local logs and an asset hash receipt are retained in ignored `data/vision/hybrid-verification/`. Current-reader model/index data was not provisioned in this fresh worktree; install an existing prepared Current data set before testing the app. The checks above use prepared Hybrid data and outlined source crops, not a running table. Live browser switching, single/split worker delivery, camera timing, GPU detection/fallback and production installation remain unverified. No Chrome, commit, push or deployment was run.

## Changed files

- `NOTICE`
- `docs/README.md`
- `docs/remote-duels/contract.md`
- `packages/shared/src/remote/action-meta.ts`
- `packages/vision/src/client.ts`
- `packages/vision/src/clip-format.ts`
- `packages/vision/src/embed.ts`
- `packages/vision/src/face-state.ts`
- `packages/vision/src/field-motion.ts`
- `packages/vision/src/field-watcher.ts`
- `packages/vision/src/hypotheses.ts`
- `packages/vision/src/index.ts`
- `packages/vision/src/pipeline.ts`
- `packages/vision/src/profile.ts`
- `packages/vision/src/types.ts`
- `packages/vision/src/worker.ts`
- `packages/web/src/components/remote/ui/recognition-backend.ts`
- `packages/web/src/components/remote/ui/recognition-setting.tsx`
- `packages/web/src/components/remote/ui/recognizer.ts`
- `packages/web/src/components/remote/ui/zone-grid.tsx`
- `packages/web/src/lib/remote/field-timing.ts`
- `scripts/vision/prepare.ts`
- `docs/remote-duels/hybrid-reader.md`
- `packages/vision/src/duelsight/bank.ts`
- `packages/vision/src/duelsight/preprocess.ts`
- `packages/vision/src/hybrid-catalog.ts`
- `packages/vision/src/hybrid-loader.ts`
- `packages/vision/src/hybrid-models.ts`
- `packages/vision/src/hybrid.test.ts`
- `packages/vision/src/hybrid.ts`
- `packages/vision/src/licenses/duel-lens-light.THIRD_PARTY_NOTICES.md`
- `packages/vision/src/licenses/duelsight.LICENSE`
- `packages/vision/src/licenses/duelsight.NOTICE`
- `packages/vision/src/licenses/duelsight.PROVENANCE.md`
- `packages/web/tests/remote-card-reader.test.tsx`
- `scripts/vision/check-hybrid-runtime.ts`
- `scripts/vision/prepare-hybrid.ts`
