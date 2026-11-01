# @yugidraft/vision

On-device card recognition for the Remote Duels prototype. This is a port of
[Duel Lens](https://github.com/mathulbrich/duel-lens/tree/f6968f3682d53a79c4a9fef591300615eda61c11),
with game data separated from the recognition engine. No camera image leaves the browser.

## Run the lab

From this worktree, with Node 22 on PATH:

```sh
export PATH=/home/sulman633/.nvm/versions/node/v22.23.3/bin:$PATH
npm ci
npx tsx scripts/vision/prepare.ts
npx tsx scripts/vision/build-index.ts --selection subset
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

Use **Start camera**, then click a card. The caller owns a one-second ring of up
to six full-resolution frames; the worker selects the sharpest three near the
click. **Upload photo** exercises the same path with one frame. The page shows
five cached artwork thumbnails/scores, confidence tier, frame quality and stage timings. Click
a candidate or press 1–5, or search the local index by name/passcode to correct
it. **Export confirmations** downloads a local JSON log; it contains IDs and
quality, no photos. Confirmations live only for the current page session.

Models, index, worker, cached artwork and benchmark photos are all under ignored
`data/vision/`. In development `/dev/vision-assets/<path>` streams those files
with proper JavaScript/WASM MIME types. Artwork thumbnails are hardlinked from the
local cache, so the isolated lab needs neither the app database nor image hotlinks. `VISION_DATA_DIR` can override this root
(use an absolute path consistently in both tools and the web server). Generated
assets are excluded from route traces, pruned from production standalone output,
and remain outside `public/` to retain the request-time gate. No service on
port 3000 is needed. `prepare.ts --bundle-only` bundles code/runtime without
downloading models; rerun it after worker changes.

## API

```ts
import { createRecognizer, yugioh } from '@yugidraft/vision';
const reader = createRecognizer({ profile: yugioh }); // backend: 'auto' | 'wasm'
const result = await reader.recognize(frames, {
  clickPoint: { x: 0.5, y: 0.5 }, // normalized source pixels, not CSS pixels
  k: 5,
  priors: {
    decklist: ['14558127'], seen: ['23434538'], voiceMentioned: ['46986414'],
    // frameClasses: ['Spell'], // optional explicit hard restriction
  },
});
// { candidates: [{cardId, score}], tier: 'sure' | 'not sure' | 'low match',
//   quality: { sharpness, detected, cornersFound, framesUsed,
//              selectedFrameIndices, fallback, frameClass? },
//   timingsMs: { sharpness, detect, warp, embed, search, total }, backend }
reader.dispose();
```

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
penalty; explicit `priors.frameClasses` is a hard filter. Deck/seen/voice boosts
are bounded to .06 and only affect plausible visual matches (raw cosine ≥ .5).
Scores include ranking adjustments and are **not probabilities**.

Confidence uses **unboosted visual candidates**, including the runner-up when
`k=1`. Duel Lens's synthetic-only embedder thresholds are preserved: score ≥ .80
and margin ≥ .02, or score ≥ .73 and margin ≥ .10, with floor .74 and a .10
card-back margin. Below the floor is `low match`; above it without a sure match
is `not sure`. A prior that changes the winner cannot make it sure. These are
upstream thresholds, not a webcam calibration. The actual card back competes in
the embedding index; a face-down detector prediction alone never identifies it.

The full upstream runtime handles WebGPU adapter/build/session/run timeouts,
nonfinite GPU outputs and failures by retrying on a separate WASM runtime. A
failed GPU stays disabled for that worker. WASM uses one thread without cross
origin isolation, otherwise half the logical cores capped at four. The lab does
not change global COOP/COEP headers or the app's OAuth behavior.

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
frame class. A passcode of 0 marks an as-yet unassigned code (seven recent cards
in this snapshot) or the card-back sentinel. Header, metadata and vector length are validated before inference.

## Index build and assets

`npx tsx scripts/vision/build-index.ts --selection auto` chooses a full catalog
only when its conservative download+embedding estimate fits an hour; otherwise
it chooses 2,000 cards. `--selection full` explicitly builds everything. Options:
`--threads 4`, `--catalog <YGOPRODeck-cardinfo.json>`, `--image-cache <directory>`,
`--refresh-catalog`, `--cache <directory>`, `--output <directory>`, `--limit 20`.
The Yu-Gi-Oh catalog adapter is intentionally outside the generic runtime.

Subset selection combines 1,000 cards ranked by repository format staple/generic
deck usage (then catalog views), with recent released cards. It includes all
alternate artworks, skips Tokens/Skills, and fills unavailable cards with the
next recent releases. Derived 224px JPEGs and model/profile-keyed float vectors
are resumable. Local `data/card-images/<imageId>.jpg` full cards are preferred;
otherwise use YGOPRODeck cropped art, falling back to the full render and the
profile art window. Downloads are serial, ≥255 ms apart, with retries and
`Retry-After` handling. Source catalog hash, coverage, exclusions, elapsed time
and inference speed are recorded in `yugioh-index.build.json`. Card-back image
placeholders are removed with Duel Lens's cosine ≥ .90 rule.

Verified local coverage: **2,000 cards, 2,030 artwork vectors + one card-back
vector**. Index binary: **779,924 bytes**. The source catalog contains 14,422
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
then exercises the actual browser Worker/ONNX WASM path. Seed 633 selects 30
catalog cards, five per condition: clean, blur, perspective/rotation, glare,
coloured sleeves, combined. Photos and raw results stay under
`data/vision/benchmark/`. Detector misses/errors stay in the accuracy denominator.
A six-frame ring with differing blur checks selection of exactly the sharpest
three; additional probes cover ImageData, `k=1`, off-card fallback and native vs
WASM embedding parity. Duel Lens's seeded degradation helper is reused for the
ring; a full-scene renderer adds the perspective/sleeve geometry needed to test
the detector.

Measured on Ryzen 7 9800X3D, WSL2, Chromium 153.0.8010.12, **single-thread WASM**, GPU disabled, no cross-origin isolation (2026-11-01 UTC):

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
WSL machine; WebGPU could not be measured without a usable GPU.

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
