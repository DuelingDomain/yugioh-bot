# @yugidraft/vision

On-device card recognition for the Remote Duels prototype. This is a port of
[Duel Lens](https://github.com/mathulbrich/duel-lens/tree/f6968f3682d53a79c4a9fef591300615eda61c11),
with game data separated from the recognition engine. Local recognition keeps images in the browser. Separately, explicit per-user feedback opt-in can share a small warped card crop and confirmed label; the optional owner-only **Ask AI** action sends one small warped JPEG to Anthropic.

## Run the lab

From this worktree, with Node 22 on PATH:

```sh
export PATH=/home/sulman633/.nvm/versions/node/v22.23.3/bin:$PATH
npm ci
npx tsx scripts/vision/prepare.ts
npx tsx scripts/vision/build-index.ts --selection full
npm run dev --workspace=@yugioh-discord-bot/web -- --port 3417
```

Open **http://localhost:3417/dev/vision-lab**. The existing `fxLabEnabled()` gate
allows `next dev`, or `DUEL_FX_LAB=1` on an explicitly enabled server. Other
production servers return 404 for the page and assets. The root app normally
needs its existing Clerk environment. For an isolated local lab without Clerk,
use the repository's existing test auth mode on localhost:

```sh
E2E_AUTH=1 E2E_AUTH_SECRET=vision-lab-local-only-633-not-a-real-key \
  npm run dev --workspace=@yugioh-discord-bot/web -- --hostname 127.0.0.1 --port 3417
```

This does not sign a user in. It permits the gated public lab to render without
initializing Clerk. Camera access needs localhost or HTTPS.

For a quick first trial, use `--selection subset` instead. Physical-card coverage retains field Tokens and alternate artworks. Skill cards,
nonphysical passcode-zero rows and duplicate image rows are excluded; see the runtime filter below.
The single unnamed `???` record (nine images) is excluded as an upstream
placeholder. Older filtered catalog caches are automatically refetched once.

Use **Start camera**, then click a card, or **Freeze & outline cards** to select an exact gold quad with pointer/Tab/Enter. The caller owns a one-second ring of up
to six full-resolution frames; the worker evaluates up to the sharpest three near the
click, stopping after a safe first sure frame with a clean lead of at least .05. **Upload photo** exercises the same path with one frame. The page shows
five cached artwork thumbnails/scores, confidence tier, frame quality and stage timings. Click
a candidate or press 1–5, or search the local index by name/passcode to correct
it. **Export confirmations** downloads a local JSON log; it contains IDs and
quality, no photos. The local export remains session-only. Opted-in users can also share confirmations with this deployment; see the feedback loop below.

On a frozen image, **hover or focus** an outline for a small best-name/tier peek
after 250 ms. It caches per outline until Resume/source/backend reset, stays
hoverable, and closes with Escape. It creates no confirmation or AI request.
Choose **Camera side** and **Fill seat**, then **Read all cards** to recognize
the outlined board sequentially and fill that seat's local lab board twin.
Both near/far groups remain visible; uncertain names are marked unconfirmed,
and face-down/unknown/error slots remain explicit. **Cancel board read** stops
the worker; Stop/source/backend changes discard stale results. Twins are a
session-only lab demonstration, with no remote-room persistence or zone inference.

Models, index, worker, cached artwork and benchmark photos are all under ignored
`data/vision/`. In development `/dev/vision-assets/<path>` streams those files
with proper JavaScript/WASM MIME types. Worker/runtime requests use the isolated
alias `/dev/vision-lab/assets/<path>`; both routes retain the same lab gate.
Artwork thumbnails are hardlinked from the local cache, so the isolated lab needs neither the app database nor image hotlinks. `VISION_DATA_DIR` can override this root
(use an absolute path consistently in both tools and the web server). Generated
assets are excluded from route traces, pruned from production standalone output,
and remain outside `public/` to retain the request-time gate. No service on
port 3000 is needed. `prepare.ts --bundle-only` bundles code/runtime without
downloading models; rerun it after worker changes.

## API

```ts
import { createRecognizer } from '@yugidraft/vision';
const reader = createRecognizer({ game: 'yugioh' }); // lazy worker; auto prefers WebGPU
const result = await reader.recognize(frames, {
  clickPoint: { x: 0.5, y: 0.5 }, // normalized source pixels, not CSS pixels
  includeCrop: true, // only needed for optional Ask AI; JPEG stays local until requested
  // k defaults to 5; optional override: 1–100
  priors: {
    decklist: ['14558127'], seen: ['23434538'], voiceMentioned: ['46986414'],
    // frameClasses: ['Spell'], // optional explicit hard restriction
  },
});
// { candidates: [{cardId, score}], tier: 'sure' | 'not sure' | 'low match',
//   quality: { sharpness, detected, cornersFound, framesUsed,
//              selectedFrameIndices, fallback, frameClass? },
//   timingsMs: { sharpness, detect, warp, embed, search, total }, backend,
//   runtime: { crossOriginIsolated, wasmThreads, simd } }
reader.dispose();
```

For an outlined snapshot, keep an original `ImageBitmap` and pass fresh clones
to each call (transferred bitmaps are consumed; `ImageData` is copied):

```ts
const cards = await reader.detectCards(await createImageBitmap(snapshot));
const peek = await reader.peek(await createImageBitmap(snapshot), {
  card: cards[0], cards, // all outlines and selected card from this exact snapshot
});
// { cardId?, name: string | null, tier, faceDown, covered }; no crop/pixels
const controller = new AbortController();
const board = await reader.readAll(await createImageBitmap(snapshot), {
  cards, signal: controller.signal, // omit cards to detect once in the worker
});
// { near: BoardCard[], far: BoardCard[], timingsMs: { detect, total } }
const seatTwin = board.near; // retain each slot's tier/faceDown/error; never assume certainty
```

`peek` and `readAll` accept optional recognition `priors`. Both support an
`AbortSignal`; abort terminates their worker, rejects with `AbortError`, and
the next call lazily reloads it. One inference operation may run at a time.
`readAll` accepts at most **60** supplied outlines (larger lists reject), or
reads the first 60 ordered detections. Each `BoardCard` contains its original
`index`, `outline`, `side`, best name/ID, tier, `faceDown`, `covered`, and optional
`error`. It reads face-up cards sequentially, retaining duplicates as separate
slots. Face-down outlines produce an unnamed, uncertain slot without guessing
hidden identity. Individual read failures retain an error slot and do not
discard the rest of the board. An empty board returns two empty arrays.

Near/far uses the quad's center in **source image coordinates**: `y > .5` is
near; `y <= .5` is far, including the midpoint tie. CSS letterboxing has no
effect. This adapts Duel Lens `src/content/board.ts` to one camera/photo frame;
it does not infer orientation, perspective-correct a table, identify players,
or separate arbitrary multi-camera collages.

The automatic **COVERED guard** is exposed as `DetectedQuad.covered`,
`RecognitionResult.quality.covered`, and `PeekResult`/`BoardCard.covered`.
Detect-all and ordinary recognition retain weak detector peaks down to .2
(visible outlines still require .4), and the close-up 448px fallback checks the
same scene. A covered answer keeps its suggestions but cannot be `sure`.
Selected-quad recognition honors the flag from `detectCards`; `peek`/`readAll`
also compare supplied same-frame outlines. Supplying an arbitrary quad without
scene evidence cannot reveal an undetected covering object.

`board.ts` retains upstream's bounds-fit rule (`minFit .6`, `lead .2`,
`maxPickInside .8`) and adds polygon evidence for the exact-outline workflow:
distinct positive-overlap quads trigger when the competing-pick bounds rule
fits, or at least 20% of the target polygon overlaps. Polygon IoU >= .8 is
treated as a duplicate outline. With no depth evidence this conservatively
caps both cards of a stack. Hands, missing detections and nearly coincident
stacks are not reliably detected; this does not reconstruct hidden artwork or
inherit upstream's private-footage calibration.

Offline synthetic board measurements and validation are in [REPORT.md](REPORT.md).
Reproduce using existing local models/index and the existing clean-photo corpus:

```sh
npx tsx scripts/vision/prepare.ts --bundle-only
npx tsx scripts/vision/benchmark-board.ts
VISION_LAB_ORIGIN=http://127.0.0.1:3429 npx tsx scripts/vision/check-lab.ts
```

The benchmark performs no external requests. Raw board measurements and compact
JPEG fixtures stay under ignored `data/vision/benchmark/board/` (about 0.53 MiB).
The lab check needs an already-running server with the lab and offline auth
enabled; its sole AI request is intercepted locally by Playwright.

The five `candidates` are distinct card IDs, merging alternate artworks by their
best match. `tier` describes confidence in the visual winner; lower suggestions
are alternatives, not separately accepted cards. `priors` are optional and never
turn a weak visual result into `sure`. Use `{ game: 'yugioh', backend: 'wasm' }`
to skip GPU probing on CPU-only devices. Unknown game IDs fail before a worker
is allocated. The existing `{ profile: yugioh }` form remains compatible; an
explicit `profile` takes precedence and permits another game's data/URLs.

Defaults use the gated local lab assets. The API does not enable those assets
in production: they still require `DUEL_FX_LAB=1`. A production Remote Duel
integration can supply its own `profile` model/index URLs, `workerUrl` and
`runtimeBase` when mounting the generated files. Serve the worker and runtime
under `/duels/remote/…` so their responses receive the same isolation headers.
Index metadata must be generated for that exact profile: `embedding.url` currently
participates in `layoutKey`. Relocating the embedding URL therefore requires
matching regenerated metadata, even with unchanged weights/preprocessing.
Changing only `workerUrl`, `runtimeBase`, `indexUrl` or `metaUrl` does not change
that identity. No camera frames are sent to those asset endpoints.

`frames` is `ImageBitmap[]` or `ImageData[]`, 1–12 images, each 3 pixels to 16 MP.
ImageBitmaps transfer to the worker and are consumed; ImageData is copied. Clone
ring-buffer originals before calling. A reader permits one pending recognition;
`dispose()` terminates its worker and rejects outstanding requests. Initial model
loading is outside `timingsMs.total`; cold wall time is measured separately below.

Pipeline: Laplacian-variance selection → detector/card corners → edge refinement →
perspective warp → profile artwork crops → DINOv2 embedding → cosine search,
best artwork per card. As in Duel Lens, extra windows/180° readings run only if
the first view is uncertain. Selected-frame embeddings are normalized and averaged.
A missed click uses a card-shaped crop around that click, reduces similarity by
15%, and can never be `sure`. Border samples supply a conservative soft class
penalty; explicit `priors.frameClasses` is a hard filter. Decklist rows are searched
first, then the full catalog. A clear off-deck catalog winner survives as
**Not in decklist**; a deck preference cannot manufacture sure. Seen/voice boosts
are bounded to .06 and only affect plausible visual matches (raw cosine ≥ .5).
Scores include ranking adjustments and are **not probabilities**.

Confidence uses **unboosted visual candidates**, including the runner-up when
`k=1`. Duel Lens's **broadcast-calibrated, not webcam-calibrated** thresholds are preserved: score ≥ .80
and margin ≥ .02, or score ≥ .73 and margin ≥ .10, with floor .74 and a .10
card-back margin. Below the floor is `low match`; above it without a sure match
is `not sure`. A prior that changes the winner cannot make it sure. These are
upstream thresholds, not a webcam calibration. The actual card back competes in
the embedding index. A face-down detection cannot be sure as a face-up card or
produce feedback. Every evaluated frame must independently name the same clean
catalog winner and pass the thresholds. Temporal reads redetect the quad per
frame; an explicit selected quad applies only to a single frozen frame.

The full upstream runtime handles WebGPU adapter/build/session/run timeouts,
nonfinite GPU outputs and failures by retrying on a separate WASM runtime. A
failed GPU stays disabled for that worker. WASM uses one thread without cross
origin isolation, otherwise half the logical cores capped at four. Fixed-width
SIMD is explicitly enabled and the matching `ort-wasm-simd-threaded.wasm` is
served locally; this binary already provided SIMD in the original baseline.
Threading supplies the new speedup. `runtime` reports the worker's actual
isolation and ONNX WASM configuration after initialization/fallback.

COOP `same-origin` and COEP `require-corp` apply **only** to
`/dev/vision-lab/:path*` and `/duels/remote/:path*`. The worker, runtime modules
and WASM thread workers use `/dev/vision-lab/assets/…`, reusing the existing
gated, traversal-safe file handler. Index/model/thumbnail URLs remain same-origin
under `/dev/vision-assets/…`. Headers on the page alone are insufficient: the
worker's own script and thread runtime must also opt in. Enter/leave isolated
screens with a full document navigation; a Next.js client transition cannot
change an existing document's isolation. Browsers without isolation keep the
one-thread fallback. See [ORT flags](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html)
and [worker isolation](https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope/crossOriginIsolated).

HTTP checks verify no COOP/COEP on sign-in, sign-up, SSO callback, regular duels,
the sign-in preview or the legacy asset URLs. The real lab upload returned five
candidates without browser errors; the real trailer component opened/closed its
YouTube iframe on a non-isolated page. The 50 selected existing proxy/auth/trailer
tests pass. Production build/standalone packaging pass, with generated vision
assets excluded; disabled production lab/worker/model URLs return 404. Raw
application checks are in `data/vision/benchmark/application-checks.json`.
Live Clerk OAuth was not exercised because this worktree has no Clerk
keys; the lab uses the existing offline auth mode.

## Game profiles and index format

`src/types.ts::GameProfile` is a serializable data contract. Yu-Gi-Oh's data is in
`src/games/yugioh.ts`: physical size 59×86, warp dimensions, the measured artwork
window, optional alternate artwork windows, border sample regions/RGB frame
classes, back ID/image, fallback crop height, model preprocessing/checksums,
thresholds, detector and index URLs. Frame classes include Fusion, Synchro, Xyz,
Link, Ritual, Pendulum, Normal, Effect, Spell and Trap.

For One Piece, supply 63×88 geometry, measured art/full-art windows, back image,
frame classes, model spec and an index built from its own references. Pass the
object as `profile`; engine/worker code does not change. The existing detector
and tuned embedder were trained on Yu-Gi-Oh; zero-shot quality on another game
is unmeasured, so data-only configuration is not an accuracy guarantee. A base
Apache DINOv2-S ONNX can use `pooling: 'cls'` for `[N,tokens,384]` or `'none'` for
`[N,384]`, with its own hashes, normalization and calibrated thresholds. Never
compare an index made with different weights/preprocessing.

The binary is Duel Lens's **YGIX v1**, little endian: 20-byte header (`YGIX`, u32
version, dimension, count, quantization: 0 float32 / 1 int8), then row-major
vectors. Int8 is `round(127 × L2-normalized vector)`. Search renormalizes stored
rows to remove quantization norm drift. JSON retains `modelId`, `dim`, `count`,
`quant`, `builtAt`, `entries`, adding `dtype`, game ID, model SHA256 and layout
identity; entries carry generic string `cardId`, passcode, name, image ID and
frame class. A passcode of 0 marks an entry without an eight-digit game passcode
(including nonstandard catalog IDs and newly announced cards), or the card-back
sentinel. Header, metadata and vector length are validated before inference.

## Index build and assets

`npx tsx scripts/vision/build-index.ts --selection auto` chooses a full catalog
only when its conservative download+embedding estimate fits an hour; otherwise
it chooses 2,000 cards. `--selection full` explicitly builds everything. Options:
`--threads 4`, `--catalog <YGOPRODeck-cardinfo.json>`, `--image-cache <directory>`,
`--refresh-catalog`, `--cache <directory>`, `--output <directory>`, `--limit 20`.
The Yu-Gi-Oh catalog adapter is intentionally outside the generic runtime.

Subset selection combines 1,000 cards ranked by repository format staple/generic
deck usage (then catalog views), with recent released cards. It includes all
alternate artworks and field Tokens, excludes Skills/nonphysical rows, and fills unavailable cards with the
next recent releases. Derived 224px JPEGs and model/profile-keyed float vectors
are resumable. Local `data/card-images/<imageId>.jpg` full cards are preferred;
otherwise use YGOPRODeck cropped art, falling back to the full render and the
profile art window. Downloads are serial, ≥255 ms apart, with retries and
`Retry-After` handling. Source catalog hash, coverage, exclusions, elapsed time
and inference speed are recorded in `yugioh-index.build.json`. Card-back image
placeholders are removed with Duel Lens's cosine ≥ .90 rule.

### Full catalog, verified 2026-11-01 UTC

**14,652 cards, 14,816 artwork vectors + one card-back vector** (14,817 total).
This historical unfiltered build included 230 Tokens/Skills and 164 alternate images beyond one per card. The current runtime physical filter described below applies before search.
Every named catalog card/image ID and every thumbnail was checked against the
source snapshot. There are **zero missing artworks, failures or card-back
placeholder exclusions** among these named entries. The source's one unnamed
`???` record with nine images is excluded as an upstream placeholder before selection.

| Metric | Measured result |
| --- | --- |
| Full build wall time | **3,318.094 s = 55m 18.1s** |
| YGIX int8 binary | **5,689,748 bytes (5.43 MiB)** |
| Metadata JSON | **3,551,731 bytes (3.39 MiB)** |
| Resumable cache, logical bytes | 396,801,329 bytes (378.42 MiB) |
| Entire `data/vision/` after cleanup, allocated disk space | 561,487,872 bytes (535.48 MiB), hardlinks counted once |
| Reused / newly embedded artwork vectors | 2,030 / 12,786 |
| New images downloaded / read from local full-card cache | 12,784 / 2 |
| Serial HTTP requests (including retries/full-render fallbacks) | 12,943 |
| Native CPU embedding, four threads | **37.7 ms/art mean** |

Downloads and native inference overlap the rate-limit wait. The reported wall
time is the full invocation, including the concurrent application checks.
Artwork is retained as 224px JPEGs alongside float embedding checkpoints;
thumbnail hardlinks share the JPEG storage. The raw and normalized catalog snapshots are
also kept for provenance. The binary is 384 dimensions, int8, with the standard
20-byte YGIX header. All outputs remain ignored under `data/vision/`:
`yugioh-index.bin`, `yugioh-index.meta.json`, `yugioh-index.build.json` and
`cache/25a56963ff4ae74df99b3995/`. The source SHA256 is
`698f7dcff6092a055e606e24f83d0bc8d944aac622bc1bd539d8bebd8c3bded3`.
The exact measured invocation was:

```sh
npx tsx scripts/vision/build-index.ts --selection full --threads 4 \
  --catalog data/vision/cache/cardinfo.json
```

A subsequent `--selection full --threads 4` resumes the normalized catalog and
vectors without needing to download or embed these artworks again. It still
validates and rewrites the index; no second full build was needed for this report.

Original subset build (retained as the baseline): **2,000 cards, 2,030 artwork vectors + one card-back
vector**. Index binary: **779,924 bytes**. The original filtered source catalog contained 14,422
cards / 14,572 artworks after Token/Skill exclusions; fresh serial downloads
alone would take at least 61.9 minutes at this rate, so the subset was selected.
The measured resumable build reused 1,921 vectors and embedded 109 at 31.9 ms/art
(native CPU, four threads), finished in 50.2 seconds, with zero failures or
placeholder exclusions (`yugioh-index.initial-build.json`). The thumbnail-only
refresh reused all 2,030 vectors in 1.4 seconds. Outputs are `data/vision/yugioh-index.bin`,
`yugioh-index.meta.json`, and `yugioh-index.build.json`. For the full catalog:

```sh
npx tsx scripts/vision/build-index.ts --selection full --threads 4
npx tsx scripts/vision/prepare.ts --bundle-only
npx tsx scripts/vision/benchmark.ts
```

The pinned model downloads succeeded; no DINOv2 fallback was needed:

| Model | SHA-256 |
| --- | --- |
| `dinov2-small-duel.q8.onnx`, synthetic card-image renderings only | `02d9720530ff488397ad7db66423199dbd7a406b264b866eb695cdc59c638bee` |
| `card-detector.onnx`, synthetic scenes, MobileNetV3 | `542a03b523cb1398a1b5437dae665908b3bdf61be9b30a2a52e7bcea25dce03c` |

Both are Apache-2.0 per the pinned upstream notices. The v3b tournament-video
model, DINOv3 and MobileCLIP are not used. `prepare.ts` fetches only pinned files,
checks hashes and never runs upstream install/training scripts.

## Benchmark

Run `npx tsx scripts/vision/benchmark.ts` after preparing models/index. It launches
an ephemeral localhost asset server and headless Chromium with GPU disabled,
then exercises the actual browser Worker/ONNX WASM path. It uses the full Chromium
executable in new headless mode (`channel: 'chromium'`). Isolation is on by
default; `--isolation off` reproduces single-thread WASM against the same index.
Use `--backend auto` to try WebGPU with `--enable-unsafe-webgpu`,
`--use-angle=swiftshader`, `--enable-unsafe-swiftshader`. `--label <name>` writes
`results-<name>.json`; `--quick` runs three clean photos for a path probe only.
Reports include page/worker isolation, real runtime thread/SIMD flags, requested
WASM files, adapter info, console fallback reasons, pipeline and API wall latency. Seed 633 selects 30
catalog cards, five per condition: clean, blur, perspective/rotation, glare,
coloured sleeves, combined. Photos and raw results stay under
`data/vision/benchmark/`. Detector misses/errors stay in the accuracy denominator.
A six-frame ring with differing blur checks selection of exactly the sharpest
three; additional probes cover ImageData, `k=1`, off-card fallback and native vs
WASM embedding parity. Duel Lens's seeded degradation helper is reused for the
ring; a full-scene renderer adds the perspective/sleeve geometry needed to test
the detector.

### Full-index CPU comparison

Ryzen 7 9800X3D, WSL2 exposing eight logical CPUs, 47 GB RAM, Chromium
153.0.8010.12 in new headless mode, GPU disabled, 2026-11-01 UTC. Both runs use
**the same 14,652-card index and unchanged seed-633 30-photo corpus**. The full
index builder had exited before measurement. SIMD is active in both runs;
isolation enables the additional WASM threads.

| Metric | One thread, isolation off | Four threads, isolation on |
| --- | --- | --- |
| Warm pipeline median / p95 | **483.4 / 535.4 ms** | **182.0 / 274.8 ms** |
| Warm API wall median / p95 | 484.8 / 536.7 ms | **183.4 / 276.1 ms** |
| Warm pipeline mean | 496.2 ms | 192.0 ms |
| Cold API wall, models/index/runtime included | 1,548.4 ms | 896.0 ms |
| Median detect / embed / search | 138.3 / 303.1 / 23.1 ms | 45.0 / 94.1 / 23.9 ms |
| Top-1 / top-5 | 30/30 / 30/30 | 30/30 / 30/30 |
| Detected / corners found | 30/30 / 30/30 | 30/30 / 30/30 |
| Six-frame ring, sharpest three [0,1,2] | 1,438.2 ms, correct top-1 | 504.9 ms, correct top-1 |
| Off-card fallback | 905.6 ms, `low match` | 292.0 ms, `low match` |
| Native / WASM embedding cosine | 0.999999998 | 0.999999998 |

The comparable full-index median improves **2.66× (62.3% lower latency)** and
meets the **<250 ms single-frame median** target. The API wall timer includes
worker transfer/conversion and response; `timingsMs.total` measures the pipeline.
Frame fetch/decode and initial loading are outside the warm pipeline timer.
Each condition remains 5/5 top-1 and top-5. Both runs produce 29 `sure` and one
`not sure`; ImageData/`k=1` identifies the correct card. The multi-frame ring
still embeds three selected views, so its latency is higher than a single frame.

The worker reports `crossOriginIsolated: true`, `wasmThreads: 4`, `simd: true`
and loads `/dev/vision-lab/assets/ort/ort-wasm-simd-threaded.wasm`; the control
reports isolation false and one thread. Raw records, stage timings, backend and
runtime diagnostics are in `data/vision/benchmark/results-full-single.json` and
`results-full-threaded.json`. Reproduce them with:

```sh
npx tsx scripts/vision/benchmark.ts --isolation off --label full-single
npx tsx scripts/vision/benchmark.ts --label full-threaded
npx tsx scripts/vision/benchmark.ts --backend auto --label full-webgpu
```

### Headless WebGPU with SwiftShader

The final full-index run uses `--enable-unsafe-webgpu --use-angle=swiftshader
--enable-unsafe-swiftshader` in headless Chrome/Chromium 153. The adapter reports
vendor `google`, architecture `swiftshader`, `isFallbackAdapter: true`.
**All 30 recorded recognitions report `backend: 'webgpu'`**, with 30/30 top-1 and
top-5, 30/30 detections/corners and no inference fallback in this final run.
Both original models create WebGPU sessions (622 ms detector, 298 ms embedder);
their first WebGPU runs take 7,054 ms and 3,689 ms respectively.

| Software WebGPU metric | Result |
| --- | --- |
| Warm pipeline median / p95 | **8,580.4 / 9,580.3 ms** |
| Warm API wall median / p95 | 8,581.8 / 9,581.7 ms |
| Cold API wall, including load and first shaders/runs | 12,165.8 ms |
| Six-frame ring, sharpest three | 25,769.5 ms, correct top-1 |
| Off-card fallback | 13,778.2 ms, `low match` |

This proves the actual detector/embedder WebGPU path on a software adapter; it
provides no speedup on this CPU. Use `backend: 'wasm'` on this machine. The full
report is `data/vision/benchmark/results-full-webgpu.json`, including provider
logs, adapter details and every per-frame result. Its plain WASM fetch also
covers the separate native/WASM parity probe; the recognition records themselves
all remain WebGPU.

Earlier three-photo probes, performed while indexing/application validation was
running, created both SwiftShader sessions but the detector hit Duel Lens's
**10,000 ms per-run watchdog**. Both models then switched to the separate WASM
runtime and returned correct matches. This also verifies the existing failure
path; the original watchdog is retained. Raw early probe:
`data/vision/benchmark/results-chrome-swiftshader-probe.json` (13,960.3 ms cold).
No physical GPU performance was measured.

Original **2,000-card subset baseline**, Ryzen 7 9800X3D, WSL2, Chromium
153.0.8010.12 headless shell, **single-thread WASM**, GPU disabled, no cross-origin
isolation (2026-11-01 UTC):

| Metric | Result |
| --- | --- |
| Top-1 / top-5 | **30/30 (100%) / 30/30 (100%)** |
| Detected / corners found | 30/30 / 30/30 |
| Warm end-to-end median / p95 | **525.8 / 588.7 ms** |
| Warm mean | 527.1 ms |
| Cold wall time including model/index/runtime load | 1,285.4 ms |
| Median detect / embed / search | 155.3 / 342.4 / 3.6 ms |
| Six-frame ring, sharpest three [0,1,2] | Correct top-1, 1,513.1 ms |
| Off-card click fallback | `low match`, 877.3 ms; no card/corners detected |
| ImageData input, k=1 | Correct top-1, `sure`; runner-up still considered internally |
| Native / WASM embedding cosine | 1.000000007 (rounding around 1) |

Each condition (clean, blur, perspective, glare, sleeve, combined) scored **5/5 top-1 and top-5**. All 30 were `sure`; this small positive-only set does not measure false acceptance. Raw records, photo manifest and timings: `data/vision/benchmark/results.json` and `photos.json`.

These are synthetic transforms of indexed card images, not a held-out real
webcam benchmark. They cannot establish real webcam accuracy, unfamiliar-card
rejection, foil robustness or safe automatic acceptance. The camera ring and Stop/release behavior were exercised with Chromium's fake
media device. Physical webcam capture still needs a human hardware check on this
WSL machine. The software WebGPU experiment does not measure physical GPU performance.

## Ports and application code

Pinned upstream revision: `f6968f3682d53a79c4a9fef591300615eda61c11`.

| Upstream | Local port / adaptation |
| --- | --- |
| `src/offscreen/detector/{detector,decode,preprocess,refine,geometry,spec}.ts` | `src/detector/`, extension message adapter removed |
| `src/offscreen/{geometry,hypotheses}.ts` | same names; geometry/art-window supplied by profile |
| `src/shared/{preprocess,embed-core}.ts` | `src/{pixels,embed}.ts`, shared browser/native embedding |
| `src/shared/{search,models,index-format}.ts` | `src/{search,models,index-format}.ts`, same decision rules/YGIX, generic IDs and bounded priors |
| `src/offscreen/web-runtime.ts` | `src/web-runtime.ts`, original watchdog/fallback machinery; `runtime.ts` adds local URLs/hash checks |
| `src/offscreen/engine.ts` | `src/pipeline.ts`, staged hypotheses/search/decision flow with temporal fusion |
| `src/offscreen/placeholder-art.ts`, `tools/lib/index-builder.ts` | `src/{placeholder-art,index-builder}.ts` |
| `tools/lib/degrade.ts` | `scripts/vision/degrade.ts`, profile colours/geometry |
| `tools/train/`, `tools/train-detector/` core Python pipelines | `scripts/vision/training/`; local paths/profile and CPU/CUDA/MPS adaptation; see its README |
| Popover alternatives, keyboard selection, name-search correction | React lab adaptation, local confirmations instead of extension/report services |

Application-specific additions: worker request/transfer queue (replacing Chrome's
offscreen-document/message transport), webcam ring, sharpness and temporal
averaging, colour/prior hooks, catalog/cache orchestration, gated Next.js routes,
and full-scene measurement harness. Extension shell, browser-store packaging,
DuelingBook badge inpainting, video harvesting, AI API checks and private
upstream evaluation data are excluded.

Apache licence and original third-party notices are retained in `src/licenses/`
and identified in root `NOTICE`; modified files identify the port. Generated
model/runtime folders also carry their notices. Card art/text/back and derived
index remain subject to their owners' rights; they are not Apache-licensed.


## Round 2: full-art, AI second opinions and source inventory

See [REPORT.md](REPORT.md) for measured results and [PORTING.md](PORTING.md) for
the exact upstream module/feature inventory and deliberate exclusions.

There are currently **0 verified real full-art print images** in the local
reference manifest. Full rendered cards and Quarter Century set membership do
not establish a full-art printing. The existing cache mostly contains cropped
artwork without print-layout metadata. With no verified whole-card references,
use local name correction or explicitly ask the owner-enabled AI reader.

`full-art.ts` tests for textured frame rails and absence of a conventional pale
rules box. This is a layout hint with false negatives, not a print classifier.
When full-art references exist, the pipeline always compares standard artwork
and whole-card embeddings (including 180°) against their respective indexes,
keeps both candidate lists and fuses frames separately for each index.
The whole-card index has a different layout identity. Add verified local images
with provenance to `scripts/vision/full-art-prints.json` and run:

```sh
npx tsx scripts/vision/build-full-art.ts
npx tsx scripts/vision/benchmark-full-art.ts
npx tsx scripts/vision/prepare.ts --bundle-only
```

Each manifest entry is `{cardId, printId, imagePath, source}`; `printId` uniquely
identifies a printing, `source` is its HTTPS provenance, and `imagePath` is
relative to the manifest. The builder reads local whole-card images, checks the
model hash and catalog identity, and records source-image hashes/counts in
`data/vision/yugioh-full-art.build.json`. Empty coverage removes the optional
full-art index; the standard index remains usable. Synthetic benchmark references
are isolated in memory and never count as real prints.

The client API also exposes:

```ts
const quads = await reader.detectCards(frame); // consumes transferred ImageBitmap
const result = await reader.recognize(frames, {
  card: quads[0], // normalized exact frozen quad; bind it to that same snapshot
  includeCrop: true,
});
const reading = await reader.askAI(result, { explicitRequest: true });
// { name, passcode?, setCode?, match: { passcode, name } | null }
```

`askAI` permits uncertainty without an explicit flag; a `sure` local result
requires `explicitRequest: true`. The lab never automatically uploads a crop.
The server independently enforces that policy on `POST /api/remote-vision/ai`,
requires an authenticated application owner (`OWNER_USER_IDS`), literal
`REMOTE_VISION_AI=1` and `ANTHROPIC_API_KEY`, and uses the current shared Haiku
model (`claude-haiku-5-5`). It permits 20 paid attempts per user per hour via
SQLite, accepts JPEGs up to 256 KiB / 32–1024 pixels per side, and bounds provider
fetch plus body reading to four seconds. Images/provider error payloads are
never logged or stored. Only an unambiguous exact `card_catalog` identity with
consistent readable hints is returned; otherwise it abstains. Tests mock the
provider; no live AI accuracy claim is made.

## Player feedback loop

Collection requires literal `REMOTE_VISION_FEEDBACK=1` and a signed-in user's
explicit **Help improve card recognition** opt-in. It defaults OFF for everyone,
including alpha testers. The lab asks once; `/settings/account` changes sharing
and deletes samples. With collection off, local recognition/export still work.
The owner reviews samples at `/admin#vision`.

```ts
// Read /api/remote-vision/feedback first; only request feedback evidence after opt-in.
const result = await reader.recognize(frames, {
  includeFeedback: settings.enabled && settings.collectionEnabled,
});
// After a real user confirms a suggestion or resolves a name/AI/voice correction:
await reader.recordFeedback(result, chosenCardId, 'pick');
// source: 'pick' | 'search' | 'voice' | 'ai'. Accept AI explicitly before recording.
```

Eligible results carry a crop-bound normalized vector, game/model/hash, index
and preprocessing identity. Feedback uses a bounded 224px JPEG. Explicit AI
requests use a separate 640 × 933 source-frame warp and ten clean candidate names;
the server rejects an answer outside that list. Fallback,
partial, covered and card-back results have no feedback evidence. The client
sends the original top five, tier, source, frame class and sharpness; it never
sends source frames or audio. The server re-decodes/re-encodes JPEGs without
metadata and validates index/card identities, consent, rate and storage limits.

Shared tables: `vision_feedback_preferences`, `vision_samples`. Private JPEGs
live at `<DATA dir>/vision-feedback/`, beside SQLite by default. Retention is
30 days; caps are 5,000 samples and 64 MiB of crops, <=32 KiB each. Worker cleanup
runs at startup/hourly, including while collection is disabled. Samples also
prune on access. User/account deletion removes crops and derived contributions.

The deployment-wide delta requires two distinct authenticated users confirming
the same card with cosine >= .97, or owner approval. It is scoped by model,
index and preprocessing space. A worker refreshes it in the background on startup
and every 60 seconds; reads never fetch or wait for it. Refresh failures retain
the last good version for at most two minutes, then reads use an empty snapshot.
Successful refreshes replace the entire snapshot, including deletions. References
only rerank the clean top ten, require cosine ≥ .90, and are capped at eight per
card. Known confusion identities do not use learned references. A learned score
cannot establish sure: the same winner must pass the unmodified clean catalog
score and margin against another card in every evaluated frame. Known confusion pairs require two users and
force additional visual checks with a stricter margin; they never raise scores.
Admin metrics include top-1/top-5 and **sure-but-wrong** per UTC day/original tier,
with explicit submitted-feedback denominators.

Offline commands (Node 22, repo root, absolute `DATABASE_PATH` and
`VISION_DATA_DIR`; prepare trainer inputs before exporting):

```sh
npx tsx scripts/vision/feedback.ts export --out /private/new-approved-dataset
npx tsx scripts/vision/feedback.ts benchmark --no-learning --out /private/before.json
npx tsx scripts/vision/feedback.ts benchmark --out /private/after.json --baseline /private/before.json
npx tsx scripts/vision/feedback.ts prune
```

Export uses admin-approved samples only and produces a labelled manifest plus
`list.json` for `train.py --real`. The benchmark re-embeds retained warped JPEGs
through the actual pipeline, holding out the contributor/identical-crop users.
It does not evaluate source-frame detection. Baseline comparison fails on
lower top-1/top-5, increased sure-but-wrong, changed corpus or errors. No-baseline
runs are labelled BASELINE. No real-player accuracy improvement is claimed yet.
Full operating details, model/index overrides, offline-export deletion limits
and browser smoke commands: [feedback runbook](../../docs/runbooks/vision-feedback.md).


## Recognition review follow-up (2026-11-01)

The active runtime applies `filterPhysicalIndex` to the standard and whole-card
indexes. It leaves the shared on-disk binary/metadata untouched and copies only
eligible rows into memory. On the existing catalog this removes **165 rows**:
**14,817 → 14,652 vectors**, **14,652 → 14,487 card identities** plus the back.
The policy retains field Tokens, ordinary cards such as Skill Drain, and all
alternate image IDs; it excludes actual Skill-card entries, other nonphysical
passcode-zero entries and repeated image IDs. `scripts/vision/catalog.ts` applies
the corresponding source policy for future builds (catalog cache v3). No image
download, retraining or re-embedding is needed to activate the runtime filter.
The filtered count changes `indexVersion`, so old learned deltas are intentionally
incompatible until new matching evidence is submitted.

For an own camera feed, the lab uses the exported native-resolution API:

```ts
import {createOwnFeedBuffer,toRemoteRecognitionResult} from '@yugidraft/vision';
const buffer=createOwnFeedBuffer(video); // always captures at native size, 5 fps
const frames=await buffer.snapshot();    // clones; no new 1-second recording wait
const result=await reader.recognize(frames,{clickPoint:{x,y},priors:{decklist}});
const message=toRemoteRecognitionResult(result,entriesById,requestId);
// {type:'recognition.result',requestId,candidates,tier,faceDown,covered}
// candidates use positive catalog IDs, including Tokens without printed passcodes.
buffer.stop(); // closes owned bitmaps/timer; caller keeps its camera track
```

The remote-room transport lives on `feat/remote-ui`, outside this worktree. This
branch provides the payload producer/type and tests its tier/guard/ID mapping.
That transport's strict schema and receiving UI must accept and preserve these
fields when integrating the branches; no remote-room network timing is claimed.
`catalogCardId(entry)` uses the catalog identity rather than `passcode=0`.
Unmapped choices and the card back cannot trigger a card-identification action.

### Real webcam test set capture and tuning

In `/dev/vision-lab`, enable **Real webcam test set capture mode**, enter conditions,
then **Freeze & outline cards**. Click a card, confirm its true name using the tray
or search, then **Label confirmed card**. For negatives click any object or empty
area, including a missed detection, then **Mark non-card object**. Capture mode
retains all art views, raw clean/deck/ranked top-ten evidence, per-frame identities,
static safety guards, provenance, native image dimensions, target and card width.
It disables temporal early exit and feedback uploads. **Export N test samples**
downloads a local JSON bundle containing full-frame JPEGs; no server upload occurs.
Export before leaving; clear an exported batch to continue beyond 20 samples.

Aim for roughly **300 physical-card positives and 100 negatives**, using 720p/1080p
webcams and a phone, overhead/angled, bare/sleeved, matte/foil, bright/dim, near/far.
Include alternate art, look-alikes, pendulums, art-sleeve backs, boxes, logos, hands
and empty mat. Include about 10% off-deck cards when providing deck IDs. Freeze
this evaluation corpus; keep it out of any future training data.

```sh
# Repeated --input accepts multiple batches. Existing manifest samples are retained.
npx tsx scripts/vision/tune-thresholds.ts --input /private/vision-realset-1.json \
  --input /private/vision-realset-2.json --import-dir data/vision/realset \
  --out data/vision/yugioh-thresholds.json --gap .01
```

The tool verifies that each recorded tier replays exactly, validates/imports JPEGs,
merges previous manifest evidence, rejects duplicate IDs and mixed model/index/layout
identities, and emits thresholds plus a `.report.json`. It searches conservative
single score/margin rules for maximal correct sure coverage with **zero observed
wrong sure**, including a .01 score/lead safety gap on wrong individual crops,
prefixes, frame results and final results. It removes the secondary broadcast rule
so that it cannot bypass the calibrated gate; the low-match floor stays .74.
If data cannot separate correct and incorrect readings, the result can disable
sure entirely. Reports include top-1/top-5 counts, sure coverage, wrong-sure and
negative-sure counts, condition, card-width and in/off-deck splits. Top-1/top-5 use
the complete ranked candidate evidence, not the displayed five alone.

The worker loads `yugioh-thresholds.json` once per initialization without HTTP
caching and checks model/hash, filtered index version, layout and sample/negative
counts. A missing file preserves the broadcast defaults; an incompatible file
fails initialization. Reload the reader after tuning, then re-evaluate fresh
captures. Zero observed errors on a finite tuning set is not a population guarantee.
No webcam threshold file is shipped without physical webcam labels.

Measurement details and limitations: [REPORT.md](REPORT.md#recognition-review-follow-up--2026-11-01).
