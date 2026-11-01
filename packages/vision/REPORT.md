# Remote vision round 2 — 2026-11-01

Implemented on `feat/remote-vision` in the dedicated `remote-vision` worktree.
The main checkout and port 3000 were not changed. Apache notices remain intact.

## Board continuation: local peeks, read-all and COVERED

Measured with Node **22.23.3**, Chromium **153.0.8010.12**, GPU disabled,
cross-origin isolation enabled, the actual browser Worker/ONNX WASM path and
the existing **14,652-card** full index. No external requests were permitted
by the benchmark. Five clean local card-photo fixtures were projectively
straightened, then composited into separate **2-, 4- and 6-card** boards.
Far-side cards were turned 180°. These are synthetic arrangements of indexed
cards, not held-out camera images or a claim about arbitrary table layouts.

| Cards in frame | Detected | Correct top-1 | Correct near/far | Warm API median | Warm pipeline median |
| --- | --- | --- | --- | --- | --- |
| 2 | 2/2 | 2/2 | 2/2 | **488.4 ms** | 486.5 ms |
| 4 | 4/4 | 4/4 | 4/4 | **847.9 ms** | 846.2 ms |
| 6 | 6/6 | 6/6 | 6/6 | **1,258.4 ms** | 1,256.7 ms |

Each median uses **3 warm repeats**, with frame decoding outside the timed API
call. Detection runs once per board, followed by sequential local reads.
The first 2-card call, including worker/model/index initialization, took
**1,214.0 ms**. Assignment and top-1 counts above describe the first warm
result per board, **12/12 total** each. The midpoint helper also passed
**100/100** synthetic y positions, including y=.5 assigned far.

An API peek returned the correct local name/tier in **240.7 ms**, including
local fixture fetch/decode. In the built production lab, focus-to-tooltip took
**795 ms**, including the **250 ms** dwell. Focus then hover on the same
outline made **1 worker peek request**, confirming snapshot-cache reuse.
No click, confirmation or AI request was produced by the peek/board paths.

Coverage checks:

- **3/3** distinct synthetic overlap geometries flagged covered; **3/3**
  duplicate/touching/separated controls remained unflagged. A perfect synthetic
  embedding remained `sure` when clean and became `not sure` when covered.
- A real-model synthetic two-card overlap read returned **2/2 `covered: true`,
  tier `not sure`**, preserving the suggested names. The hidden target's
  suggestion can be wrong: this guard suppresses certainty, not reconstructs it.
- A reviewer separately exercised an empty initial detector pass followed by
  two overlapping cards at the 448px fallback scale: **2 detector passes**,
  a perfect embedding, and final **`covered: true`, `not sure`**.

The lab browser check detected **6 outlines**, grouped **3 near / 3 far**,
filled **3 cards into Seat 2's selected near-side twin**, and preserved the
existing single manual confirmation. Moving the pointer during read-all did
not discard the result. Cancel followed by another read and Stop discarded
stale board/tooltip output. API abort returned **`AbortError`**, then the same
recognizer successfully reinitialized. **0 browser errors** occurred in the
API benchmark and lab check. The lab check's one explicit AI request was
intercepted by Playwright; **0 real provider calls** were made.

Validation: **8 targeted core tests + 15 existing lab component tests pass**;
vision/web typechecks, worker bundle and production Next.js build/standalone
packaging pass. Only one new **88-line** test file was added. Existing build
warnings concern the Sentry config import and a broad database trace; the
production build exits successfully. The temporary upstream clone is removed
after source inspection; no upstream executable, installer or trainer ran.

Changed runtime/UI paths: `packages/vision/src/{board,client,pipeline,worker,types}.ts`,
`src/detector/run.ts`, and
`packages/web/app/dev/vision-lab/{use-outline-reads.ts,vision-lab.tsx,vision-lab.module.css}`.
Reproducible tooling: `scripts/vision/{benchmark-board,check-lab}.ts`.
Raw ignored artifacts: `data/vision/benchmark/board/results.json`, three board
JPEGs and overlap fixture (about **0.53 MiB** total with the bundled benchmark
client), plus `data/vision/benchmark/lab-board.json`.

Near/far is a source-frame midpoint heuristic; twins are session-only lab
state with uncertain/face-down/error slots preserved. There is no player/zone
inference, remote-room persistence, depth estimation, hand detection or hidden
art reconstruction. The COVERED thresholds/behavior are adapted for exact
outlines and have not inherited upstream's private real-footage calibration.
Source and feature mapping: [PORTING.md](PORTING.md); usage: [README.md](README.md).

## Full-art coverage and measured accuracy

**Verified real full-art print images available locally: 0; indexed real full-art
prints: 0.** This is a local verified-coverage count, not a claim that such prints
do not exist. The 14,653-record source snapshot has image ID/full/small/cropped
URLs but no print-layout field or image-to-print mapping. Its 552 cards with a
Quarter Century set are not automatically full-art references. The two locally
cached full-card renders are conventional framed cards; the vision cache holds
14,816 derived artwork crops, which cannot establish a print's frame layout.

Konami separately describes extended-art cards in
[Rarity Collection 5](https://www.yugioh-card.com/eu/product/rarity-collection-5/).
[YGOPRODeck's image API](https://ygoprodeck.com/api-guide/) supplies full renders
and cropped art; those URL forms alone do not identify a full-art printing.

`full-art.ts` supplies a conservative frameless/text-box-absence hint. The builder
accepts explicitly verified whole-card references with print IDs, image paths,
provenance URLs and image hashes. When present, this independently keyed index
competes with the standard art-box index on every recognition, with both upright
and 180° whole-card readings. Per-index frame fusion preserves both candidate
lists and keeps priors from manufacturing certainty. Missing references leave
local name correction and optional Haiku name OCR available; the lab explains
this when it detects a possible full-art layout.

| Measurement | Result |
| --- | --- |
| Real full-art reference images / real-print accuracy | **0 / unmeasured** |
| Synthetic full-art fixtures | 3 cards × clean, blur, upside-down = **9** |
| Standard art-box index alone, synthetic top-1 | **6/9 (66.7%)** |
| Standard + whole-card reference index, synthetic top-1 | **9/9 (100%)** |
| Frameless heuristic on those synthetic scenes | **6/9**, so it is not a coverage gate |
| Standard 30-photo regression, top-1 / top-5 | **30/30 / 30/30** |
| Standard regression detected / corners found | **30/30 / 30/30** |
| Standard regression confidence | 29 sure, 1 not sure |
| Warm CPU/WASM pipeline median / p95 | **193.7 / 511.4 ms** |

The synthetic references stretch existing Blue-Eyes White Dragon, Ash Blossom
& Joyous Spring and Maxx “C” art across a full card. They are **not Konami prints**
and never enter real reference coverage or the deployed standard index. Tests
run the actual detector, warp, embedder, full standard catalog and new dual-index
pipeline. Six synthetic scenes miss detection and correctly stay uncertain via
the fallback guard. Real webcam/open-set/full-art accuracy remains unmeasured.
Timing is a fresh standalone run, not a controlled comparison to the prior round.

Reproduce with Node 22:

```sh
npx tsx scripts/vision/build-full-art.ts
npx tsx scripts/vision/benchmark-full-art.ts
npx tsx scripts/vision/prepare.ts --bundle-only
npx tsx scripts/vision/benchmark.ts --label round2-final
```

Raw evidence (ignored generated data):
`data/vision/yugioh-full-art.build.json`,
`data/vision/benchmark/full-art/results.json`, and
`data/vision/benchmark/results-round2-final.json`.

## Optional AI route

`POST /api/remote-vision/ai` requires an authenticated application owner,
`REMOTE_VISION_AI=1` and `ANTHROPIC_API_KEY`. It reuses the existing direct
Anthropic Messages request pattern and shared current model constant,
**`claude-haiku-5-5`**. Request:
`{jpegBase64, localTier, explicitRequest}`. Sure local results require an explicit
request; uncertain results may request a second opinion. The lab uploads only
when **Ask AI** is pressed and explains where the crop goes.

The route accepts fully decoded JPEGs of at most **256 KiB**, with both sides
**32–1024 pixels**, and allows **20 attempts/user/hour** using an atomic SQLite
counter. The **four-second deadline** covers the provider request and response
body; there are no paid retries. Images and provider error payloads are never
logged or stored. The response is
`{name, passcode?, setCode?, match:{passcode,name}|null}`. Unknown, ambiguous or
contradictory readings abstain; no AI output inserts a catalog record.

The browser smoke sent **one mocked request**, with a **23,261-byte JPEG**, no
automatic upload and zero browser page errors. All provider calls in tests are
mocked. No live AI API request or live AI accuracy assessment was made.

Files: `packages/web/app/api/remote-vision/ai/route.ts`,
`packages/web/src/lib/remote-vision-ai.ts`, `packages/vision/src/client.ts`,
`packages/web/app/dev/vision-lab/vision-lab.tsx`.

## Exact upstream inventory and additional ports

[PORTING.md](PORTING.md) inventories the pinned upstream source individually:

| Scope | Ported | Adapted | Not ported | Total |
| --- | ---: | ---: | ---: | ---: |
| Application/support source modules | 4 | 52 | 59 | **115** |
| Tool modules | 0 | 28 | 92 | **120** |
| Relay runtime | 0 | 0 | 4 | **4** |
| Measurement scripts | 0 | 0 | 6 | **6** |
| Extension build entry | 0 | 0 | 1 | **1** |

Build-only test bridges, tests, assets and documentation are explicitly scoped
separately. Every exclusion has a target/reason. Extension injection, browser
storage/relay/reporting, simulator count-badge reconstruction and private-video
harvesting/calibration are not claimed as physical-camera ports.

This round ports/adapts **all-card gold outlines on freeze**, polygon hit testing
with overlapping-card choice and **24 CSS-pixel minimum targets**, exact quad
selection and reruns, a clamped dismissible popover, Tab/Enter/numeric/arrow/Escape
keys, focus restoration, and stale-request/bitmap disposal. Face-down outlines
remain visible deliberately. A masked warp preserves whole-card geometry for
partial cards and fills unseen regions with the profile artwork mean; partial
results cannot be sure. Upside-down and back matching remain enabled. The
standard art box follows upstream's measured pendulum choice; the pendulum-only
crop is not silently forced at runtime. The retained training tools comprise
seven embedder and seven detector Python modules, with precise exclusions.

The board continuation above adds hover/whole-board recognition and adapts the
COVERED guard for exact outlines. Upstream drag-box input semantics, calibrated
padded-redetection policy and brightness-based orientation ordering remain
boundaries, with their reasons in PORTING.md. The seen mask detects source-frame
truncation, not hands/objects occluding pixels inside the frame.

## Verification and delivery

- **24/24** vision unit/pipeline/masked-warp tests.
- **39/39** mocked AI-route tests and **15/15** lab component tests.
- Vision and web TypeScript checks passed.
- Isolated real Chromium/WASM lab smoke on **3418**: outline selection, keyboard
  focus, AI crop request and Resume cleanup passed; zero page errors.
- Optimized Next.js webpack production build passed, including the AI route and
  standalone tracing. Worker rebundled. No new production service was deployed.
- Temporary upstream clone and isolated dev/build outputs removed after checks.
  Existing unrelated `packages/web/next-env.d.ts` development imports retained.
- Small feature commits: AI `b74dd8503`, vision core `e20ad909d`, lab `d4d0ce489`.
  Final documentation commit and pushed branch head are reported in the final
  response. No PR or merge.
