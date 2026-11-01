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

## Player feedback continuation — 2026-11-01

Delivered on `feat/remote-vision-feedback`, starting at `d6a712928`. Work stayed
in `.worktrees/remote-vision-feedback`; the main checkout, port 3000 and port 3417
were untouched. No PR, merge, deployment, training run or paid AI request.

Implemented: default-off per-account consent and a once-only lab prompt; explicit
pick/search/voice/accepted-AI `recordFeedback`; safe detected-card JPEG capture;
bounded shared SQLite/private-disk storage; independent-user consensus or owner
approval for deployment-wide learned references; confusion-pair second checks;
owner review and daily tier metrics; user/account deletion and hourly retention;
admin-approved trainer export; actual-pipeline crop comparison/regression gate.

Tables: `vision_feedback_preferences` (choice, prompt time, rate window) and
`vision_samples` (private user ownership, JPEG size, normalized embedding, original
top-five scores, chosen ID, tier/source, frame class, sharpness, game/model/hash,
index/preprocessing space, review state). JPEGs are UUID-named private files under
`vision-feedback/` beside SQLite. Limits are 30 days, 5,000 samples, 64 MiB of
crops, 32 KiB per JPEG and 60 submissions per user/hour. Fallback, partial,
covered and card-back results do not produce feedback evidence.

The learned delta is derived from live eligible samples, never an independently
retained index file. Deletion/rejection therefore withdraws references and
confusion evidence on the next worker request. Compatible model/index/layout
identity is required. Consensus requires another authenticated user with the same
label and cosine >= .97. Confusion pairs require two different users; extra
views and a .06 margin cannot manufacture a higher similarity. At most 512
references and 256 confusion pairs are served. Accuracy labels explicitly say
“among submitted feedback”; this is not a denominator for all recognition scans.

Fresh verification with Node **22.23.3**:

| Check | Result |
| --- | --- |
| Targeted vision pipeline/client/board cases | **27 passed** |
| Shared feedback integration, account deletion and DB connection | **27 passed** |
| Existing web lab, feedback/admin routes, AI-route and live-stats files | **82 passed** |
| Existing real worker-process lifecycle cases | **5 passed** |
| Total targeted automated cases | **141 passed**, zero failures |
| Shared + worker TypeScript builds; vision/web/worker typechecks | Passed |
| Worker/runtime bundle | Passed |
| Real Chromium/WASM consent → capture → owner review → delete | Passed; **0 page errors** |

The real browser smoke used Chromium **153.0.8010.12**, GPU disabled, an isolated
E2E account/database and port **3438**. It verified default-off consent, decline,
no repeat prompt, account opt-in, one confirmation upload with **384 embedding
values and five candidates**, private admin crop retrieval, approve/reject delta
withdrawal and deletion of the user's sample. The server-retained JPEG was
**13,898 bytes**. A React StrictMode prompt race was reproduced and fixed, with
an existing-file regression case. Desktop/mobile admin and account screenshots
were inspected. The temporary server was stopped by its PID.

A separate native-ONNX smoke used the full **14,817-vector / 14,652-card** index
and five existing clean synthetic photo fixtures. The detector first produced
eligible exact card crops, which were saved through the real feedback service
under an isolated fixture user. The benchmark then decoded/re-embedded those
retained JPEGs through `RecognitionPipeline`'s selected-card path:

| Metric | Baseline, no delta | Candidate, contributor held out |
| --- | --- | --- |
| Top-1 | **5/5 (100%)** | **5/5 (100%)** |
| Top-5 | **5/5 (100%)** | **5/5 (100%)** |
| Sure / sure-but-wrong | **5 / 0** | **5 / 0** |
| Recognition errors | **0** | **0** |
| Comparison gate | Baseline only | **PASS**, same corpus/hash |

The five approved samples exported as trainer-compatible `list.json` plus a
labelled manifest and **84,618 bytes** of JPEGs. Exact warped cards use
`mCrop:0`; there is no upstream padded-harvest assumption. Temporary smoke data,
reports and screenshots occupy about **2 MiB**, all ignored. Existing models and
index files were reused without downloads or duplicate model storage.

These five indexed-card synthetic fixtures demonstrate the workflow and absence
of a regression, **not a measured real-player accuracy gain**. No real-player
samples or physical webcam test corpus were available. The crop benchmark cannot
measure source-frame detection because those frames are deliberately not retained.
Contributor/identical-crop holdout prevents self-reference gains; evaluating a
model trained on the same corpus still needs a separate held-out dataset. Offline
exports are private copies and need owner deletion/rebuilding after a privacy
request; live deletion cannot erase copies moved elsewhere or undo trained weights.

Run with `REMOTE_VISION_FEEDBACK=1`, matching `WEB_URL`, absolute `DATABASE_PATH`
and prepared `VISION_DATA_DIR`, then opt in at `/settings/account`. The lab is
`/dev/vision-lab`; owner review is `/admin#vision`. Native offline commands:

```sh
npx tsx scripts/vision/feedback.ts export --out /private/new-approved-dataset
npx tsx scripts/vision/feedback.ts benchmark --no-learning --out /private/before.json
npx tsx scripts/vision/feedback.ts benchmark --out /private/after.json --baseline /private/before.json
npx tsx scripts/vision/feedback.ts prune
```

Raw ignored evidence: `data/vision-feedback-smoke/{before,after,browser}.json`,
`export/{manifest,list}.json`, private JPEGs and screenshots. Operational commands,
version overrides, browser smoke configuration and privacy limitations are in
[the feedback runbook](../../docs/runbooks/vision-feedback.md). The canonical
marketing privacy page was updated; the app's legal links point there and it has
no separate privacy/terms page.

## Recognition review follow-up — 2026-11-01

Implemented the requested Part 1 scope from
`data/briefs/remote-duels/recognition-review-and-explainer.md` on
`feat/remote-vision-feedback`, starting at `a73bb2c5f`. All writes stayed in
`.worktrees/remote-vision-feedback`. The main checkout and existing port 3000/3417
processes were left alone. No retraining, paid API request, PR or merge.

| Item | Delivered |
| --- | --- |
| (2) Deck-first/catalog search | Actual restricted deck-row scan runs before the catalog scan. A confident off-deck clean winner survives; ambiguous reads can prefer a qualifying deck candidate. Sure always requires the same unboosted full-catalog winner and margin, so a wrong decklist cannot manufacture certainty. No unmeasured webcam accuracy gain is claimed. |
| (2) Physical index | In-memory filter removes Skill/nonphysical zero-passcode rows and duplicate image IDs, retaining field Tokens and alternate art. **14,817 → 14,652 vectors; 14,652 → 14,487 card identities**, plus the back. Builder catalog policy v3 applies to future builds. No shared binary/metadata rewrite or re-embedding. Ordinary Skill Drain/Prisoner/Successor cards remain eligible. |
| (4) Correctness | Every evaluated frame must independently agree with the final clean identity and pass confidence. Temporal frames redetect quads rather than reuse a selected outline. Face-down art guesses cannot be sure or contribute feedback. Exported remote message includes tier, covered and faceDown. |
| Vision-side (3) | Safe first frame with clean lead ≥ .05 can end a read. Learning snapshots refresh once on initialization and every 60s outside inference; failed refreshes retain the prior version for at most 120s. Shared own-feed buffer keeps native pixels, up to six frames/one second, without a fresh recording delay. The lab consumes this API. |
| P2 / P7 / P8 / P11 | Learned crops only rerank clean top-ten identities, cosine ≥ .90, cap eight/card; clean scores/competitors establish sure. Known confusion identities do not use learned rows. Actions use positive catalog IDs, including Token IDs, rather than zero passcodes. AI receives a separate **640 × 933** warp made from source pixels and ten clean candidate names; out-of-list responses abstain. Feedback remains a bounded 224px JPEG. README now says **broadcast-calibrated, not webcam-calibrated**. |
| (1) Tooling | Explicit lab mode labels true cards and arbitrary non-card targets, exports native JPEGs plus raw candidates/guards/provenance, and keeps captures local. Offline import merges batches without dropping old labels. Threshold tuning replays the recorded tier, uses cards and negatives, excludes wrong crop/frame/final decisions with a .01 safety gap, and maximizes sure coverage within conservative single score/margin rules at **zero observed wrong sure**. It emits a version-bound runtime configuration and condition/width/deck reports. |

The remote room and strict data-channel schema are on the separate
`feat/remote-ui` branch and do not exist here. This work supplies
`toRemoteRecognitionResult` and its typed payload; that branch must accept and
preserve the new fields when integrated. Actual remote-room click latency was
not measurable in this worktree.

### Synthetic before/after

Reused the exact existing **30 JPEGs**, seed **633**, five each of clean, blur,
perspective, glare, sleeve and combined conditions. No new reference downloads.
Node **22.23.3**, Chromium **153.0.8010.12**, Ryzen 7 9800X3D, WSL2, GPU disabled,
WASM SIMD/four threads with cross-origin isolation. Both workers used the same
model weights and original on-disk catalog; the candidate filters it in memory.

Unrelated worktrees began CPU-heavy Next/browser jobs during measurement. The
initial isolated-before run measured pipeline p50/p95 **235.2/426.7 ms**; the
first contended after run measured **773.8/1080.2 ms**. These runs are retained
but do not establish a latency regression. The comparison below instead runs
the old worker from `a73bb2c5f` and the candidate consecutively for each photo in
one browser, under the same ongoing load. Baseline runs first for each pair,
so residual scheduling/order noise remains.

| Metric | Before | After |
| --- | ---: | ---: |
| Top-1 | **30/30 (100%)** | **30/30 (100%)** |
| Top-5 | **30/30 (100%)** | **30/30 (100%)** |
| Detected / corners found | **30/30 / 30/30** | **30/30 / 30/30** |
| Sure | **29/30 (96.7%)** | **30/30 (100%)** |
| Sure-but-wrong / all positives | **0/30** | **0/30** |
| Wrong / sure answers | **0/29** | **0/30** |
| Pipeline p50 | **389.9 ms** | **428.8 ms** (+10.0%) |
| Pipeline p95 | **694.3 ms** | **659.6 ms** (−5.0%) |
| Worker API wall p50 / p95 | **393.1 / 700.6 ms** | **430.8 / 661.5 ms** |
| Six-frame API read (one fixture) | **839.7 ms; 3 frames** | **270.6 ms; 1 frame** (−67.8%) |

The full-catalog top-1/top-5 and wrong-sure gates hold; paired p95 is below the
+20% budget. These are indexed-image synthetic positives, **not a physical
webcam/open-set evaluation**. The off-card fallback probe remained `low match`;
one negative probe does not establish a false-positive rate. The Skill duplicate
that previously narrowed Double Evolution Pill's lead no longer blocks sure.
No physical webcam corpus was available, so there are **no real webcam accuracy,
negative sure-rate, mobile latency, or set-code readability measurements**. The
640px output preserves available text pixels; it cannot recreate text missing
from a distant or blurred source frame. No webcam-calibrated threshold file is
published from synthetic or mocked data.

Raw ignored evidence:
`data/vision/benchmark/results-review-before.json`,
`results-review-after.json`, `results-review-paired.json` (contains both workers'
per-photo records and timings), and their matching logs.

### Verification and tooling reproduction

The focused regression file is `packages/vision/src/pipeline.test.ts`; it covers
deck restriction/off-deck fallback, Skill Drain preservation, Token ID mapping,
poisoned references inside/outside the clean ten, face-down art sleeves,
disagreeing/moving frames, early exit, learning-cache expiry, source AI crop,
threshold safety including a misleading whole-card view, and a mocked AI answer
outside its candidate list. No paid API is called.

```sh
npx tsx --test packages/vision/src/pipeline.test.ts
npx tsc -p packages/vision/tsconfig.json --noEmit
npx tsc -p packages/web/tsconfig.json --noEmit --incremental false
npx tsx scripts/vision/check-realset.ts
npx tsx scripts/vision/tune-thresholds.ts \
  --input data/vision/realset-smoke/export.json \
  --import-dir data/vision/realset-smoke/imported \
  --out data/vision/realset-smoke/thresholds.json
```

The browser harness bundles the actual lab React components and runs the actual
WASM worker on an ephemeral HTTP port. It mocks API responses and the unrelated
shared sheet button, avoiding Next's server/font build environment. It does not
start or stop a Next server, touch protected ports, or change a real user's
feedback preferences. Its synthetic camera is explicitly labelled as such.


Fresh verification: **25/25 cases passed in the one small targeted test file**;
vision and web TypeScript checks passed; browser worker bundle generated. The
isolated real-component/real-WASM smoke exported **one labelled card and one
empty-mat negative**, reproduced both recorded tiers offline, retained native
**1920 × 1080** buffer frames, and made **one mocked AI request** with a
**640 × 933, 95,685-byte JPEG and ten candidate names**. Repeated reads used
**one learning fetch**; starting a new recognizer for the camera used a second
initialization fetch. There were **zero feedback uploads and zero browser errors**.
A new freeze cannot export prior live evidence while detection is busy.

The offline smoke replay had **top-1/top-5 1/1**, **one correct sure**, and
**zero sure-but-wrong / 2 total samples** before and after tuning. A second import
with copied smoke imagery and distinct IDs retained all **four records**, with
zero wrong sure; this verifies batch retention, not additional accuracy evidence.
The deliberately poisoned/mock threshold regression also excludes wrong sure
and demonstrates refusal to calibrate without both cards and negatives.
The generated smoke threshold JSON stays under `realset-smoke/`; it is **not**
the default runtime threshold file.

Evidence: `data/vision/realset-smoke/{report.json,export.json,capture.png,unit.log,
thresholds.json,thresholds.report.json,thresholds-merged.report.json}` and
`imported/manifest.json` plus its two JPEGs. Temporary baseline source and UI
bundles were removed; models/runtime/index were reused. Only the pre-existing
`packages/web/next-env.d.ts` change is intentionally left uncommitted.

To repeat the paired comparison, build the old worker from the pinned source
without switching checkouts, then use the ordinary benchmark's comparison mode:

```sh
mkdir -p data/vision/baseline-src
git archive a73bb2c5f packages/vision/src | tar -x -C data/vision/baseline-src
npx esbuild data/vision/baseline-src/packages/vision/src/worker.ts --bundle \
  --format=esm --platform=browser --target=es2022 --minify \
  --outfile=data/vision/worker-before.js
npx tsx scripts/vision/benchmark.ts --label review-paired \
  --compare-worker /dev/vision-lab/assets/worker-before.js
```

Small commits: `317c51d8b` core safety, `6c2b35894` AI candidate validation,
`6dd70e15e` raw replay/calibration, `620c752df` native lab capture. The final
follow-up/documentation commit and pushed head are reported in the final answer.
