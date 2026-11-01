# Remote Duels speech service

For the new client-side target, see [Player-browser Parakeet](#player-browser-parakeet).

CPU HTTP + WebSocket transcription on **4020**, separate from the duel/application stack.
Default final and provisional decoder: **Parakeet TDT 0.6B v3 int8 ONNX /
sherpa-onnx**, with provisional re-decodes about every 400 ms. **Whisper is off by
default**: no turbo model download, import or allocation. `STT_VERIFY=whisper` enables
a selective background **Whisper large-v3-turbo / faster-whisper int8** second pass.
Silero VAD gates silence and supports optional automatic endpointing; push-to-talk
release never waits for trailing silence.

Parakeet provides fast proposals; the optional verifier can improve uncertain card
identities after the final arrives. Whisper won accuracy on the recorded synthetic
corpus but takes seconds on CPU. Neither transcripts nor corrections execute game
actions; command parsing, proposal chips, confirmation/Undo and UI wiring belong to
the application. `STT_MODEL=whisper` remains an explicit slower final-decoder option.

## Run with Docker

From the repository/worktree root (Docker Compose v2):

```bash
mkdir -p data/stt-models data/duel-engine
export STT_UID=$(id -u) STT_GID=$(id -g)
docker compose -f services/stt/docker-compose.yml up --build --wait --wait-timeout 600
curl http://127.0.0.1:4020/health
```

Create the bind directories as your current user **before** starting Compose; otherwise
Docker can create a root-owned model cache. If this has already happened, have its owner
restore write access. `STT_UID`/`STT_GID` must match the directory owner. First startup
fetches about 640 MiB of Parakeet/VAD weights; subsequent starts reuse
`data/stt-models`. Nothing is baked into the image or committed. The existing root `data/` ignore rule covers models,
clips and catalogs. Image build context excludes the virtualenv, benchmark data and models.

Optional background Whisper verification (same fast Parakeet finals):

```bash
STT_VERIFY=whisper docker compose -f services/stt/docker-compose.yml up --wait --wait-timeout 600
```

Compose defaults: one process, four inference threads, four active utterances, 6 GiB memory
limit, four CPUs, host loopback binding. The main application Compose file is unchanged.
For a separate server, copy this service and compose file with the same relative layout,
prepare the two writable/readable data directories, then put HTTPS/WSS and authentication
in front of it. `STT_API_KEY` enables HTTP bearer auth and WebSocket auth below.
`STT_ALLOWED_ORIGINS` is an optional comma-separated browser-origin allowlist (also enables
HTTP CORS). Do not embed a server-wide secret in a public frontend; use an authenticated
backend proxy. The local default requires no key.

## Run natively

Python 3.11, no Node/GPU required. Run from the worktree root:

```bash
uv venv services/stt/.venv --python 3.11
uv pip install --python services/stt/.venv/bin/python -r services/stt/requirements.txt
export PYTHONPATH=services/stt
services/stt/.venv/bin/python -m stt.download parakeet
services/stt/.venv/bin/python -m uvicorn stt.app:app --host 127.0.0.1 --port 4020 \
  --workers 1 --limit-concurrency 32 --ws-max-size 64000 --ws-max-queue 8
```

Configuration:

| Variable | Default | Meaning |
|---|---|---|
| `STT_MODEL` | `parakeet` | Final decoder: `whisper`, `parakeet`, or benchmark-only `zipformer` |
| `STT_PARTIAL_MODEL` | `parakeet` for Whisper, otherwise final model | Decoder for provisional text; `none` disables offline partials |
| `STT_VERIFY` | `none` | `whisper` loads turbo for optional WS verification of Parakeet finals; otherwise no verifier |
| `STT_VERIFY_THRESHOLD` | `0.95` | Verify any final with a card match strictly below this similarity score |
| `STT_VERIFY_CONFIDENCE` | `0.95` | Minimum Whisper card-match similarity for a new card identity to warrant a correction |
| `STT_THREADS` | `4` | CPU threads per recognizer; finals/partials serialized together, verification serialized separately |
| `STT_MAX_ACTIVE` | `4` | Active WS utterances + HTTP uploads/decodes; excess gets busy error |
| `STT_MAX_SECONDS` | `15` | Maximum audio duration per utterance |
| `STT_MODEL_DIR` | root `data/stt-models` | Download/cache directory; Docker `/data/stt-models` |
| `STT_DATA_DIR` | root `data` | Catalog discovery base; Docker `/data` |
| `STT_CARD_CATALOG` | auto | Explicit `.cdb`, app `.sqlite`/`.db`, or names JSON path; must exist |
| `STT_API_KEY` | empty | Shared service key; HTTP `Authorization: Bearer ...` |
| `STT_ALLOWED_ORIGINS` | empty | Allowed browser origins, separated by commas |

Both score thresholds must be in `[0,1]`; these are matcher similarities, not ASR
probabilities. Verification only applies when the final model is Parakeet. Enabling
it downloads another ~1.51 GiB of turbo weights on first startup (fp16 on disk,
int8 at CPU load). Readiness waits for enabled models. Explicit final/partial model
selection can also opt into Whisper; default startup loads only Parakeet.

Use one Uvicorn worker: extra processes duplicate model memory. Live audio queues are
bounded; partial work is skipped when inference is busy and final decodes take priority.
Verification uses a separate single-worker executor, with at most `STT_MAX_ACTIVE`
outstanding jobs globally (running + queued); a full verification queue skips the
second pass. It never enters the final/partial queue. Its CPU work can still contend
with finals; this is not a concurrent-load latency guarantee. Disconnect cancels
queued verification and suppresses corrections, retains the verification slot until
native work ends, and releases any active capture slot independently. A running
partial finishes before its native inference lock is released, including on
cancel/disconnect. Four active utterances bound queueing, not a concurrency latency SLA.
An utterance also has an absolute `STT_MAX_SECONDS + 10` second capture deadline and a
2,000-frame cap. Idle sockets close after 30 seconds; the server pings every 20 seconds.

## HTTP contract

- `GET /health`: readiness, final/partial/verify model, pending verification count, model-load seconds, active utterances,
  catalog source and size. Only becomes available after models/catalog/VAD load.
- `POST /transcribe`: raw **mono 16,000 Hz PCM signed 16-bit little-endian** bytes,
  `Content-Type: audio/pcm` (or `application/octet-stream`). No WAV header, Opus or WebM.
- Optional `X-STT-Hotwords`: JSON array of at most 256 names (120 characters each).
  Deck cards and staples receive preferred matching. Silence returns empty text/matches.
  HTTP returns the primary result only; background corrections are WebSocket-only.
- Errors: 401 auth, 408 upload timeout, 413 audio over limit, 415 content type, 422
  malformed samples/hints, 429 busy. Upload timeout is 30 seconds.

```bash
curl http://127.0.0.1:4020/transcribe \
  -H 'Content-Type: audio/pcm' \
  -H 'X-STT-Hotwords: ["Blue-Eyes White Dragon","Dark Magician"]' \
  --data-binary @utterance.pcm
```

Example response (timing varies):

```json
{
  "text": "Blue Eyes White Dragon attacks Dark Magician.",
  "normalizedText": "Blue-Eyes White Dragon attacks Dark Magician.",
  "cardMatches": [
    {"name":"Blue-Eyes White Dragon","passcode":89631139,"score":1.0,"span":[0,22]},
    {"name":"Dark Magician","passcode":46986414,"score":1.0,"span":[31,44]}
  ],
  "model": "parakeet",
  "durationMs": 2623.875,
  "speechDetected": true,
  "processingMs": 79.81
}
```

`span` is `[start, end)` in **Unicode characters of the original `text`**, not normalized
text, PCM timestamps, or JavaScript UTF-16 code units. `score` is a heuristic lexical/
phonetic similarity, not a calibrated ASR probability. `normalizedText` replaces matched
card spans with canonical names; it does not parse commands, turn spoken numbers into
integers, or correct player names.

## WebSocket contract

Connect to `ws://127.0.0.1:4020/ws`. With `STT_API_KEY` configured, either send HTTP bearer
auth in the upgrade or send this browser-compatible frame **immediately on open**, before
waiting for ready: `{"type":"auth","token":"..."}`. Authentication must finish in 5 seconds.
Bad auth closes with 1008. Without a key, start by waiting for ready.

1. Server: `{"type":"ready","model":"parakeet","partialModel":"parakeet","verifyModel":null,"sampleRate":16000,"format":"s16le","maxSeconds":15}`.
2. On key-down send `{"type":"start","requestId":"cmd-1","mode":"ptt","sampleRate":16000,"format":"s16le","partials":true,"cards":["Dark Magician"],"hotwords":["Ash Blossom & Joyous Spring"]}`. Only `type` is needed; other fields use these defaults or empty lists/id. `cards` and `hotwords` are name arrays whose combined unique size is at most 256. Punctuation in legitimate names such as `D/D` and `Number 39: Utopia` is accepted.
3. Wait for `{"type":"started","requestId":"cmd-1"}`, then send **binary PCM frames** while held. Recommended 20 ms / 640 bytes per frame. Maximum frame is 64,000 bytes; frames must be nonempty and contain complete 16-bit samples.
4. Server may emit `{"type":"partial","requestId":"cmd-1","text":"I activate Ash","audioMs":1200,"model":"parakeet"}`. Provisional text may change; no card replacements or actions apply yet. Offline re-decodes are attempted at approximately 400 ms of new audio, with at most one outstanding partial per utterance. Zipformer instead uses true incremental state.
5. **On key-up send `{"type":"end"}`**. The server decodes immediately, without a VAD silence delay. Final is the HTTP result plus `type:"final"`, `requestId`, and `reason:"release"`. `processingMs` includes any in-flight partial/queue wait, final inference and matching, measured from receipt of end; it excludes network time.
6. Send another start on the same connection, or close. `{"type":"cancel"}` discards the current utterance and returns `{"type":"cancelled"}`. Disconnect drains in-flight work and releases its slot.

### Optional correction messages

With `STT_VERIFY=whisper`, `ready.verifyModel` and `health.verifyModel` are `"whisper"`.
After sending a Parakeet final, the service verifies the **same complete PCM and card
hints** when any accepted card match scores below `STT_VERIFY_THRESHOLD`, or raw text
contains an attack/LP cue (`attack/attacks/attacking/attacked`, `LP`, `life` / `life point(s)`,
`damage`, `pay`, `lose/lost`, `gain`, `recover`, `take`). This is a conservative text trigger,
not command parsing. A non-command with no accepted card match does not trigger it.
Silence never triggers verification.

If Whisper finds a card passcode **absent from the original final** at a score of at
least `STT_VERIFY_CONFIDENCE`, the server sends at most one message:

```json
{
  "type": "correction",
  "requestId": "cmd-1",
  "model": "whisper",
  "replacesModel": "parakeet",
  "text": "I summon Accesscode Talker. Blue Eyes White Dragon attacks Dark Magician.",
  "normalizedText": "I summon Accesscode Talker. Blue-Eyes White Dragon attacks Dark Magician.",
  "cardMatches": [
    {"name":"Accesscode Talker","passcode":86066372,"score":1.0,"span":[9,26]},
    {"name":"Blue-Eyes White Dragon","passcode":89631139,"score":1.0,"span":[28,50]},
    {"name":"Dark Magician","passcode":46986414,"score":1.0,"span":[59,72]}
  ],
  "processingMs": 3200.0
}
```

The example timing/text are illustrative. `processingMs` starts when the background
job begins waiting for its executor; it includes queueing, decoding and matching.
All three result fields (`text`, `normalizedText`, `cardMatches`) replace the prior
proposal together. Correction spans refer to the correction's own raw text, using
the same Unicode character convention as finals. No correction is sent for spelling,
score-only, card deletion, number-only or command-only changes, or low-confidence
alternatives. The full Whisper result can include additional lower-scoring matches;
only the **new identity that triggers emission** must meet the confidence threshold.

Use a **unique nonempty `requestId` per utterance for the connection's lifetime**.
The final always precedes its correction, but a correction can arrive after another
utterance's `started`, partial or final. Route by `requestId` and update only a still
pending proposal chip. Ignore stale/confirmed/dismissed proposals; corrections never
authorize an action or change committed game state. An empty/default ID cannot safely
identify multiple proposals. The service does not implement the application's chip.

Verification is best effort: no message is promised if it agrees, fails, is saturated,
or the socket closes. Verification errors are logged and do not close a healthy
socket. There is no separate completion/ack message, no replay after reconnect and
no extra capture slot held while the verifier runs. `cancel` applies to the current
capture; it does not retract a prior final or cancel that final's pending verification.

For automatic endpointing, use `mode:"vad"` and keep sending silence frames: after about
350 ms of detected trailing silence the service sends a final with `reason:"silence"`.
One start represents one utterance; stop sending audio after final and send a new start
for the next utterance. PTT mode allows mid-command pauses and finalizes only on end.
Silero rejects all-silence clips in either mode. Protocol errors send `{type:"error",error}`
then close with 1008; unexpected transcription failures close with 1011. Final results
are not replayed after reconnect, so the caller must handle interrupted utterances.

Capture only the local processed mic track, with browser AEC/noise suppression; resample
it to 16 kHz before encoding PCM. Never include remote participants' audio. Capture and
keyboard/UI wiring are the caller's responsibility.

## Card catalog and biasing

This machine used **`data/duel-engine/cards.cdb`**, SHA-256
`4c4025613e2fb7588ad8e520a16af72d9d7e509f7848a9bffec461f1cbcd0548`.
It supplies 14,422 unique name/passcode rows after resolving alternate-art aliases,
14,420 normalized name keys. CDB aliases resolve only when both card names agree,
preserving different cards whose rules say their names count as another card.
No application database is opened for writing. An explicit app database uses
`card_catalog.ygoprodeck_id` and `name` read-only.

If CDB is absent, first startup downloads [YGOPRODeck card data](https://db.ygoprodeck.com/api/v7/cardinfo.php),
retains only `{id,name}` under the model volume, and reuses it thereafter. `/health` says
which source is active. JSON also accepts `{ "data": [...] }` or a bare list. To refresh
names, replace that cache while the service is stopped.

Matching examines word spans, combines RapidFuzz edit similarity with cached Double
Metaphone keys, and favors duel cards/staples over a stricter full-catalog threshold.
Exact longer names win over shorter overlapping hints (Dark Magician Girl remains
correct even when Dark Magician is in the duel list). Staples include Ash/Imperm/Nib/
Called by/Veiler aliases. Unknown names in hints remain available to the recognizer but
receive a passcode only if present in the catalog. Full-catalog single-word matches need
a card-action cue; exact preferred staples can stand alone. Ambiguous low scores remain
uncorrected; short aliases are deliberately conservative.

Whisper receives the duel list as a decoder hint; Zipformer uses per-stream modified-beam
hotword boosting with a generated BPE text vocabulary. The Parakeet TDT adapter uses greedy
CPU decoding and **post-STT biasing only**: no claim of native TDT decoder hotword support.
The full catalog is never dumped into a decoder prompt.

## Benchmark

Measured locally on AMD Ryzen 7 9800X3D (8 cores), 47 GB RAM, WSL2, CPU only, Python 3.11.15,
four recognizer threads. **40 identical local Piper clips**, 20 phrases × US Lessac/UK Alan
voices, 79.30 s total, 188 reference words. The corpus includes the five requested examples
plus difficult cards and phase/LP commands. Every model receives the same 14-card duel
hint list; the same final matcher/staples/catalog rescores every saved hypothesis.

| Model | Raw WER | Card-normalized WER | Load (s) | 1 s release p50/p95 (ms) | 3 s release p50/p95 (ms) | RTF | Peak RSS (MiB) |
|---|---:|---:|---:|---:|---:|---:|---:|
| Parakeet TDT 0.6B v3 int8 | 17.02% | 7.45% | 1.527 | 89 / 101 | 132 / 170 | 0.0758 | 1,668 |
| Streaming Zipformer EN 2023-06-26 int8 | 33.51% | 28.19% | 0.954 | 23 / 45 | 34 / 54 | 0.0617 | 273 |
| Whisper large-v3-turbo int8 | **4.26%** | **2.66%** | 2.494 | 3,549 / 3,700 | 2,443 / 2,676 | 1.9496 | 1,675 |

WER is corpus edit distance / reference words, with case/punctuation removed and `&`
normalized to `and`. Number words **are not equated with digits**: e.g. `800` versus
`eight hundred` contributes formatting errors. This is strict transcript WER, not command
success rate. Normalized WER is after card replacements only. The matcher is shared across
all models; saved hypotheses were re-scored after matcher bug fixes without altering raw
ASR text/timings. Thresholds were developed on this small synthetic set, not held-out data.

Load excludes downloads and includes backend import/initialization; it benefits from OS
file cache, so it is not a cold-disk boot claim. Warm decode excludes warmup/model load.
RTF = total recognition compute / total original audio duration, lower is better.
Peak RSS comes from an isolated model process, including matcher and warmup, not sum of
weights or a whole-container limit. Timing varies with normal workstation scheduling.

The latency probes are separate exact 1 s/3 s clips ("end turn" / "moving to standby
phase"), with silence padding after intact speech, seven warm repetitions each. They
measure **last audio frame / PTT release to decode completion**, excluding network, VAD
and matcher. Zipformer processes 20 ms chunks while speaking; its release timing includes
only immediate lookahead flush, while its RTF includes all streaming work. Its full-clip
p50 costs are 53 ms / 147 ms, not the tail-only figures in the table. The deliberately short
1 s probe is misrecognized by all three (`In turn`, `IN TURN`, `Intern`); latency does not
imply correctness. Natural "end my turn" clips are also in the WER corpus.

Whisper wins accuracy, Parakeet wins fast offline decoding, Zipformer wins streaming tail
latency but loses accuracy. Default service storage only needs **Parakeet + Silero** (~640 MiB). Zipformer,
Piper voices and optional turbo files are removed after verification/benchmarking;
Whisper is downloaded again only when explicitly selected. The optional browser
exports are separate (Parakeet 639.42 MiB, tiny.en 38.95 MiB of weights). No model
binaries or synthesized audio are in Git.

Actual paced WebSocket smoke measurements (20 ms frames, partials enabled, three runs
per duration):

| Configuration | 1 s release p50/p95 (ms) | 3 s release p50/p95 (ms) |
|---|---:|---:|
| Docker Whisper finals + Parakeet partials | 2,580 / 3,704 | 3,242 / 3,497 |
| Native Parakeet finals + partials | 48 / 63 | 91 / 94 |

The historical Whisper configuration's first nonempty partial arrived at 414 ms from speech start in the
Blue-Eyes command. Its final arrived 2,988 ms after release. The dual-model Docker
service peaked at 2.54 GiB cgroup memory across load and these checks. Its measured
startup reported 4.447 s for the Whisper decoder; readiness also waits for Parakeet,
catalog and VAD. These API figures include VAD/matching/queueing/loopback network and
are distinct from the single-model compute table. See `api-whisper.json` and
`api-parakeet.json` for individual runs and partials. HTTP/WS transcripts, silence,
odd/empty/oversized PCM, malformed hints, punctuated card names, cancel/disconnect
cleanup, browser auth, bearer auth and automatic VAD endpointing were checked.

These synthetic clean voices do not establish accuracy for real players, accents, room
noise, overlapping speech or echo. Very short commands and proper player names remain
error-prone. Collect human recordings before relying on automatic game actions; keep
confirmation/Undo in the application.

## Reproduce and verify

From worktree root, using the native virtualenv:

```bash
uv pip install --python services/stt/.venv/bin/python -r services/stt/requirements-benchmark.txt
export PYTHONPATH=services/stt
services/stt/.venv/bin/python -m unittest discover -s services/stt/tests -v
```

The recorded benchmark requires `data/duel-engine/cards.cdb` with the SHA-256 above;
the service's automatic YGOPRODeck fallback does not create this CDB. Copy it from
an existing prepared checkout into that exact path, or use the repository's
`npm run duel:prepare` after installing its Node 22 workspace dependencies (see
the root setup docs). Verify with `sha256sum data/duel-engine/cards.cdb` before
comparing results. A newly prepared upstream CDB may differ from the recorded
snapshot. `run.py --catalog data/stt-models/card-names.json` can benchmark the
YGOPRODeck fallback instead, but that changes catalog contents and the supplied
`rescore.py` intentionally requires the recorded CDB path.

Generate and run sequentially (Whisper takes several minutes on CPU):

```bash
services/stt/.venv/bin/python services/stt/benchmarks/generate.py
OMP_NUM_THREADS=4 services/stt/.venv/bin/python services/stt/benchmarks/run.py --model parakeet --output services/stt/benchmarks/parakeet.json
OMP_NUM_THREADS=4 services/stt/.venv/bin/python services/stt/benchmarks/run.py --model zipformer --output services/stt/benchmarks/zipformer.json
OMP_NUM_THREADS=4 services/stt/.venv/bin/python services/stt/benchmarks/run.py --model whisper --output services/stt/benchmarks/whisper.json
services/stt/.venv/bin/python services/stt/benchmarks/rescore.py
services/stt/.venv/bin/python services/stt/benchmarks/smoke.py --output services/stt/benchmarks/api-parakeet.json
find data/stt-models/zipformer data/stt-benchmark/voices -type f -delete
find data/stt-models/zipformer data/stt-benchmark/voices -depth -type d -empty -delete
```

The smoke command requires a running API at `http://127.0.0.1:4020`; `--url`
selects an isolated port. To reproduce historical `api-whisper.json`, explicitly
start that API with `STT_MODEL=whisper` and select that output filename. For an
enabled-verifier smoke run, start with `STT_VERIFY=whisper` and save a separate
report. HTTP results remain primary-only and closing the smoke socket cancels its
pending verification; correction ordering/capacity/failure paths were also checked
with an in-process controlled executor and model decoders.

`benchmarks/corpus.json` records phrases, voice revision and WAV SHA-256s;
`benchmarks/{parakeet,zipformer,whisper}.json` contain every hypothesis and timing;
`benchmarks/environment.txt` records installed package versions. The generator runs Piper
locally after downloading pinned voices; audio stays under ignored `data/stt-benchmark`.
Waveforms contain unseeded synthesis noise; reruns can differ slightly, so the committed
manifest's hashes identify the exact measured audio. Model repositories/revisions and
selected files are pinned in `stt/download.py`; only needed int8 ONNX components are fetched.
The Silero download is verified against a SHA-256. `smoke.py` checks actual HTTP/WS audio,
partial text, canonical card IDs, silence, validation, cancel/disconnect and VAD; it is an
integration/measurement script, not an extra unit-test suite.

Sources/licenses: [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (Apache-2.0),
[NVIDIA Parakeet v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) (CC-BY-4.0;
[sherpa ONNX conversion](https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8)),
[Whisper conversion](https://huggingface.co/mobiuslabsgmbh/faster-whisper-large-v3-turbo) (MIT),
[Zipformer](https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26) (Apache-2.0),
[Silero VAD](https://github.com/snakers4/silero-vad) (MIT),
[faster-whisper](https://github.com/SYSTRAN/faster-whisper) (MIT), and
[Piper](https://github.com/OHF-Voice/piper1-gpl) (GPL-3.0, benchmark tool only).

## Player-browser Parakeet

`browser/` adds **Parakeet TDT 0.6B v3 int8 in a module worker**, using
`parakeet.js 1.4.4` and ONNX Runtime Web `1.24.1`. Audio and card matching stay on
the player's device. Deployment needs static JS/WASM/model hosting, with no Python,
WebSocket or inference server. The local service above remains available for the
benchmark and fallback; its default final decoder is now Parakeet.
This module is ready for a UI to call; microphone capture and duel UI wiring remain
with the caller.

The browser export is
[istupakov/parakeet-tdt-0.6b-v3-onnx](https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx/tree/8f23f0c03c8761650bdb5b40aaf3e40d2c15f1ce),
revision `8f23f0c03c8761650bdb5b40aaf3e40d2c15f1ce`:

| Artifact | Bytes |
|---|---:|
| `encoder-model.int8.onnx` | 652,183,999 |
| `decoder_joint-model.int8.onnx` | 18,202,004 |
| `vocab.txt` | 93,939 |
| **Model payload** | **670,479,942 (639.42 MiB)** |
| Local card catalog (14,422 name/passcode rows) | 792,847 |

`download.py` pins the repository/revision and verifies both ONNX SHA-256s. It also
fetches the 97-byte export config for reference; the runtime does not request it.
These exports have a combined decoder/joiner and differ from the existing sherpa
files, so the browser uses a separate directory under ignored `data/stt-models`.
Only the selected int8 exports are downloaded; tiny.en is an independent opt-in below.

Why this runtime: [sherpa-onnx supports WASM builds](https://k2-fsa.github.io/sherpa/onnx/wasm/build.html),
but an ORT Web adapter gives us both requested execution paths without building a
second WASM toolchain. [parakeet.js](https://github.com/ysdede/parakeet.js) supplies
TDT decoding and a JS mel frontend. Its hub loader documents upgrading int8 encoder
requests to fp32 on WebGPU; **we bypass that loader with explicit int8 URLs** and
never silently fetch a 2.4 GB fp32 encoder. The pinned package's strict WebGPU mode
also initializes two sessions concurrently, racing `initWasm`; `build.mjs` applies
a checked, narrow patch to serialize them as its hybrid mode already does.
ORT's `/webgpu` build needs its matching **Asyncify** WASM asset; `/wasm` uses the
smaller CPU asset. All assets are served locally; no runtime CDN is required.

[Transformers.js 4.3.2's published Parakeet implementation](https://unpkg.com/@huggingface/transformers@4.3.2/src/models/parakeet/modeling_parakeet.js)
provides `ParakeetForCTC`, not the TDT decoder used here. Python Transformers'
Parakeet TDT support does not establish equivalent JS pipeline support.

### Run and deploy the browser module

From the worktree root, with Node 22 and the existing Python virtualenv:

```bash
npm ci --ignore-scripts --prefix services/stt/browser
services/stt/.venv/bin/python services/stt/browser/download.py --catalog data/duel-engine/cards.cdb
npm test --prefix services/stt/browser
npm run build --prefix services/stt/browser
npm run serve --prefix services/stt/browser
```

`--ignore-scripts` skips unused native ONNX/CUDA installation hooks; this build
uses browser WASM and the packaged esbuild binary. No GPU libraries are needed.

The development static host listens on **http://127.0.0.1:4021**. `PORT` overrides it.
`download.py` can omit `--catalog` to use the service's catalog discovery/fallback,
or accept a names JSON path. No existing application database is modified. The
page is a benchmark entry point; use its module from your own microphone UI.

For deployment, publish the contents of `browser/dist/` and mount the three model
payload files plus `cards.json` at `/models/`, or pass another `modelBaseUrl` and
`catalogUrl`. Keep the workers beside `index.js` and ORT assets in the adjacent
`ort/` directory. Include `METAPHONE-LICENSE` and retain dependency/model licenses
(Parakeet weights CC-BY-4.0; parakeet.js/ORT MIT; phonetic rules BSD).
Use HTTPS (localhost is acceptable for development). Serve:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Content-Type: application/wasm  # for .wasm files
```

Cross-origin asset hosts need suitable CORS/CORP headers. Isolation enables four
WASM threads; without `SharedArrayBuffer` the module uses **one thread**, whose
latency is not measured here. Check isolation against the rest of the application's
embedded assets. Production can cache versioned weights/assets with long-lived
HTTP cache headers. This development/measurement host uses `no-store`, and the
explicit-URL adapter does not add an IndexedDB copy of the weights.

### Browser API contract

```js
import { createBrowserSTT } from '/index.js';
const stt = createBrowserSTT({
  model: 'parakeet',               // or 'whisper-tiny.en' (WASM only)
  backend: 'wasm',                 // explicit 'wasm' or 'webgpu'; no silent switch
  modelBaseUrl: '/models/',        // tiny default: '/models-tiny/'
  // cards: [{ name: 'Dark Magician', passcode: 46986414 }],
  // catalogUrl: '/my-card-names.json', // alternative to cards / models/cards.json
  threads: 4,
  maxSeconds: 15,
});
await stt.start({ hotwords: ['Dark Magician', 'Blue-Eyes White Dragon'] });
stt.pushAudio(pcm); // repeated Float32Array mono 16000 Hz PCM in [-1, 1]
const result = await stt.stop();
console.log(result.transcript, result.normalizedText, result.cardMatches);
// Next utterance: await stt.start(...), pushAudio(...), await stt.stop().
stt.dispose();
```

- `start({hotwords?}) -> Promise<loadInfo>` loads once per instance and begins an
  utterance. Await it before pushing samples. At most 256 hints, 120 characters each.
  First `loadInfo` includes load/session time, thread count, requested encoder
  provider, decoder provider and adapter. Subsequent starts reuse that information.
  To preload before enabling push-to-talk: `await start(); cancel()`.
- `pushAudio(pcm) -> void` copies the input, allowing capture buffers to be reused.
  It rejects invalid/empty samples and utterances beyond the configured maximum
  (at most 15 s). It accepts **decoded float PCM**, not MediaRecorder WebM/Opus,
  WAV headers, stereo or service-style s16le bytes. Supply only the local processed
  microphone track and resample it first.
- `stop() -> Promise<{transcript,text,normalizedText,cardMatches,model,backend,
  durationMs,speechDetected,decodeMs,matchMs,processingMs}>` finalizes immediately
  on release, then returns to idle. `transcript` and `text` are the same raw ASR
  string. `processingMs` includes assembly, worker round trip, ASR and matching;
  `decodeMs` includes feature extraction/ASR, and `matchMs` covers matching.
- `cardMatches` uses the same `{name,passcode,score,span:[start,end]}` shape and
  **Unicode code-point offsets** as Python. Convert with `Array.from(text)` before
  using spans in JS; `text.slice(start,end)` uses different units after an emoji.
  Hotwords affect post-ASR matching only for both browser models.
- `cancel()` discards a recording. `dispose()` terminates the worker and rejects
  pending work, including an in-progress load/decode. Repeated dispose is safe.
  Start/push/stop in the wrong state reject/throw; overlapping utterances are
  rejected. After a load failure, dispose/recreate the instance to retry.
- Empty/digital-silence audio returns empty text/matches. `speechDetected` only
  reports a nonzero-sample threshold; this adapter has **no Silero VAD**, automatic
  endpointing or partial transcript loop. PTT release controls finalization.
  Decoder text/matches do not execute game actions.

The JS matcher ports the lexical thresholds, staple aliases, cue/boundary rules,
preferred hints, exact-longer overlap selection, canonical IDs and normalization.
An initial npm Double Metaphone dependency differed on 559 cleaned catalog keys.
`phonetics.js` instead mechanically translates the existing pinned Python
Metaphone 0.6 rules; `generate-phonetics.py` regenerates it without adding a browser
Python runtime. There is **one small JS regression test**. The benchmark scorer
also compares all catalog phonetics and saved hypotheses with Python, recording
the exact counts and zero differences in the result JSON.

### Browser measurements

Measured October 31, 2026 (Toronto), Chrome for Testing **153.0.8010.12**,
Ryzen 7 9800X3D, 47.05 GiB RAM visible to WSL2, four WASM threads:

| Browser path | Empty-cache page → ready (s) | 1 s release p50/p95 (ms) | 3 s release p50/p95 (ms) | Peak aggregate Chrome RSS (MiB) |
|---|---:|---:|---:|---:|
| WASM CPU, WebGPU disabled | **3.564** | **238 / 344** | **334 / 603** | **3,111** |
| Default WebGPU | Unavailable: null adapter | — | — | — |
| SwiftShader software WebGPU EP + CPU/WASM | 4.471 | 3,332 / 3,624 | 7,422 / 11,420 | 3,800 |

WASM worker/catalog/session loading itself took **3.415 s** (session stage 3.321 s).
SwiftShader worker loading took **4.377 s** (session stage 4.309 s). The first
post-load inference on the intact **2.624 s Blue-Eyes clip** took **731 ms** on
WASM and **7,612 ms** on SwiftShader; these are separate from the warm probes.
These are single cold-load observations, not p50/p95 startup statistics.

| Memory stage (aggregate RSS, MiB) | WASM | SwiftShader |
|---|---:|---:|
| Idle page before model load | 938 | 927 |
| Immediately after model load | 3,050 | 2,624 |
| Sampled peak through inference | 3,111 | 3,800 |

Measured initial HTTP **response-body** transfer, including JS/runtime/catalog:
**683,812,021 bytes (652.13 MiB)** for WASM; **698,737,256 bytes (666.37 MiB)** for
SwiftShader. The CPU WASM binary is 12,297,086 bytes; the GPU Asyncify binary is
27,084,114 bytes. Modules can be requested by multiple WASM threads on this
`no-store` host; the raw JSON lists every transfer. These totals exclude HTTP
headers and later corpus audio fetches.

The browser WASM corpus scored **14.89% raw WER / 5.85% card-normalized WER**
(28 / 11 errors over 188 reference words), with decode RTF **0.1252**. JS matching
cost a median **15.8 ms**, max **150.6 ms** across these clips. Python/JS verification
found **zero differences on 188 saved hypotheses and 14,482 phonetic inputs**,
including all 14,420 cleaned catalog keys. The six real-worker API checks passed
in both working modes (state guards, PCM validation, duration bound, silence and
disposal).

The software adapter reports `vendor: google`, `architecture: swiftshader`,
`isFallbackAdapter: true`. ORT warned that some encoder nodes used CPU placement;
per-operator placement was not profiled. **No hardware WebGPU latency or memory
result is available.** Timing varied with workstation scheduling: an earlier
exploratory run was faster (WASM 184 / 310 ms p50, SwiftShader 2,748 / 4,306 ms).
The table above and committed raw JSON use the final run consistently.

Cold load is a fresh browser/context and worker with empty HTTP/model cache,
including **loopback transfer**, matcher initialization and ORT session creation;
OS disk cache was not flushed. It excludes internet download. At 100 Mbit/s the
model payload alone has an ideal transfer floor of **53.6 s**; at 10 Mbit/s it is
**536 s (8.9 min)**, before runtime, protocol overhead or contention. Neither is a
measured internet download time.

The release probes use the same exact 1 s / 3 s WAVs and seven warm repetitions as
the service benchmark. `stop()` timing includes the full JS matcher and worker
messaging, which the earlier isolated native compute table excludes. The 1 s
probe still decodes as **“Intern”**, not “end turn”; fast output is not proof of
accuracy. The browser corpus uses the same 40 clips, 188 words, catalog SHA and
14 hints, with no new matcher tuning. Browser and native Parakeet exports/frontends
differ, so hypotheses and WER need not be identical. Synthetic clean speech does
not establish real-player/noise accuracy.

Memory is sampled every 100 ms across **all descendant Chrome processes**,
including worker/renderer, browser, GPU and utility processes. Aggregate RSS counts
shared pages in each process and is not unique resident memory, a JS heap size or
GPU VRAM measurement. Idle baseline and loaded/peak values are saved separately;
only the benchmark's own Chrome tree is counted. Default and software GPU runs
have separate processes. Chrome is closed through Playwright after each run; no
process-name kills are used.

### Browser compatibility and recommendation

| Browser | WASM int8 | WebGPU int8 path |
|---|---|---|
| Headless Chrome 153, this WSL2 machine | Measured, four threads with isolation | Default adapter unavailable; explicit SwiftShader software adapter measured |
| Firefox | **Untested here**; ORT documents WASM support; SIMD/module workers and sufficient memory required | **Untested here**; do not promise this TDT export/runtime combination |
| Safari, including iOS | **Untested here**; ORT documents WASM support; large allocations can exceed device/tab budgets | **Untested here**; do not promise this TDT export/runtime combination |

The [ORT browser support matrix](https://onnxruntime.ai/docs/get-started/with-javascript/web.html#supported-versions)
lists WASM across these browsers but does not certify this WebGPU path on Firefox
or Safari. [Chrome's WebGPU overview](https://developer.chrome.com/docs/web-platform/webgpu/overview/)
notes browser API releases in Firefox 141 on Windows and Safari 26; an API being
present is different from validating this model/runtime. A null adapter is a
normal handled failure; select a new WASM instance explicitly.

**Recommendation:** keep Parakeet v3 as an opt-in desktop browser option and use
**WASM by default on this CPU-only setup**. Warm latency is useful, but roughly
639 MiB of weights and multi-GiB Chrome RSS make it too heavy for an automatic
universal/mobile download. The existing Whisper service remains the measured
accuracy winner; Parakeet does not win that condition. Software WebGPU costs much
more CPU time here and provides no evidence about hardware GPU performance.

### Optional browser Whisper tiny.en int8

Select `createBrowserSTT({ model: 'whisper-tiny.en', backend: 'wasm' })`. Parakeet
remains the browser default. The same start/pushAudio/stop/cancel/dispose contract
and matcher apply; model loading starts only on `start()`. Tiny has its own worker
and adjacent `ort-tiny/` assets, so Parakeet users do not fetch its runtime or model.
Tiny does not download Parakeet. Only WASM is supported for this option.

The runtime is **Transformers.js 4.3.2**, ORT Web
**1.31.0-dev.20260914-8d85527a0**; both encoder and merged decoder use `dtype: 'q8'`,
which selects the pinned int8 quantized exports. Greedy decoding uses the English-only
model's generation config. Hints only affect the shared matcher; they are not Whisper
decoder prompts. All requests go to the supplied static model host and local ORT
assets. No Hub/CDN fallback or persistent Cache API copy is used.

Pinned [tiny.en export](https://huggingface.co/onnx-community/whisper-tiny.en/tree/2575352d61be1bf7225cf8f8b268a4678025fc58),
revision `2575352d61be1bf7225cf8f8b268a4678025fc58` (Whisper weights MIT):

| Artifact | Bytes |
|---|---:|
| `onnx/encoder_model_quantized.onnx` | 10,124,993 |
| `onnx/decoder_model_merged_quantized.onnx` | 30,718,858 |
| **Weights** | **40,843,851 (38.95 MiB)** |
| Weights + tokenizer + model metadata (unique files) | 43,536,374 (41.52 MiB) |
| Measured uncached cold transfer, all resources including catalog/JS/WASM | 72,272,072 (68.92 MiB) |

The downloader verifies both weight SHA-256s. The cold transfer counts repeated
metadata/runtime-module requests from the no-store host and four WASM threads; it
is actual response payload, excluding HTTP headers. Ideal transfer floors for the
**complete measured transfer** are 5.78 s at 100 Mbit/s or 57.8 s at 10 Mbit/s.
The measured cold load below uses loopback, not an internet connection.

**Same method and inputs as browser Parakeet:** Chrome 153.0.8010.12 on this Ryzen /
WSL2 CPU, four isolated WASM threads, same 40 clips (188 words, 79.30 s), manifest,
14 hints and full catalog; one warmup then seven repetitions of each exact release
probe, followed by all clips. No new matcher tuning. Scoring verifies every saved
result against Python and the catalog hash, with zero differences. Raw results:
`benchmarks/browser-whisper-tiny.json`.

| Measurement | tiny.en WASM int8 | Prior Parakeet WASM int8 |
|---|---:|---:|
| Raw WER | **23.40%** (44/188) | 14.89% |
| Card-normalized WER | **18.62%** (35/188) | 5.85% |
| 1 s release p50 / p95 | **361 / 429 ms** | 238 / 344 ms |
| 3 s release p50 / p95 | **430 / 632 ms** | 334 / 603 ms |
| Recognition RTF (40 clips) | **0.2668** | 0.1252 |
| Worker load / ORT session initialization | **1,310 / 1,253 ms** | 3,415 / 3,321 ms |
| Cold page-to-ready, empty cache, loopback | **1,457 ms** | 3,564 ms |
| Chrome tree RSS idle / loaded / peak | **932 / 1,472 / 1,488 MiB** | 938 / 3,050 / 3,111 MiB |

RSS uses the same 100 ms descendant-process sampler and counts shared pages in each
process. Tiny's loaded increase over its baseline was ~540 MiB; this is not a JS
heap or unique-memory measurement. First inference, all seven probe samples and
lifecycle checks are included in the JSON. Tiny also decoded the short
“end turn” probe as “Intern” and produced substantially worse card-corpus WER. Its footprint
is ~16.4× smaller in weights, with about half the observed loaded Chrome RSS, while
Parakeet was faster on these warm probes. Both remain explicit desktop options;
this synthetic corpus does not establish human/noise/mobile performance. Firefox,
Safari and non-isolated one-thread tiny execution are **untested** here.

Install/download only the option needed:

```bash
npm ci --ignore-scripts --prefix services/stt/browser
services/stt/.venv/bin/python services/stt/browser/download.py --model whisper-tiny.en --catalog data/duel-engine/cards.cdb
npm run build --prefix services/stt/browser
MODEL=whisper-tiny.en CHROME_PATH=/home/sulman633/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome npm run benchmark --prefix services/stt/browser
PYTHONPATH=services/stt services/stt/.venv/bin/python services/stt/browser/score.py --report services/stt/benchmarks/browser-whisper-tiny.json
```

Omit `CHROME_PATH` to use Playwright's installed Chrome. Deployment serves the
seven pinned model/tokenizer/config files with their `onnx/` subdirectory and
`cards.json` at `/models-tiny/`, or another `modelBaseUrl`; keep `worker-tiny.js` and
`ort-tiny/` beside `index.js`. The default catalog is `modelBaseUrl + 'cards.json'`;
`cards`/`catalogUrl` override it. Unused model files need not be deployed.

### Reproduce browser measurements

The RSS benchmark harness requires **Linux/WSL** (`/proc`); the browser module
itself does not. It also requires the native benchmark dependencies and generated
audio corpus from [Reproduce and verify](#reproduce-and-verify). If not already
prepared, install/generate them first:

```bash
uv pip install --python services/stt/.venv/bin/python -r services/stt/requirements-benchmark.txt
PYTHONPATH=services/stt services/stt/.venv/bin/python services/stt/benchmarks/generate.py
```

The existing recorded corpus can be reused without generating/downloading voices.
After the browser setup/build above, run foreground from the worktree root:

```bash
# Install the managed Chrome for Testing, or use CHROME_PATH for an existing Chrome.
(cd services/stt/browser && npx playwright install chromium)
npm run benchmark --prefix services/stt/browser
PYTHONPATH=services/stt services/stt/.venv/bin/python services/stt/browser/score.py
```

This machine reused `/home/sulman633/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`
via `CHROME_PATH` (Chrome **153.0.8010.12**) with Playwright 1.61.1; no extra browser
was downloaded. The default command uses Playwright's own installed browser and
records its real version and detected host details. It runs WASM with WebGPU
disabled, tries default WebGPU, then tries explicit SwiftShader/Vulkan flags.
Unsupported hardware is reported instead of substituted silently. The WebGPU EP
may run unsupported encoder operators on CPU; operator placement is **not
profiled**, and the decoder is always WASM. These are software WebGPU + CPU
measurements, not proof of an entirely GPU-resident int8 encoder.

`benchmarks/browser-parakeet.json` records raw probe samples, transcripts, timing,
transferred resource bytes, host/browser/adapter details, memory and API lifecycle
checks. Accuracy is measured on all 40 WASM clips; `GPU_CORPUS=1` also runs the full
corpus through software WebGPU (much slower). `MODE=wasm`, `MODE=webgpu-default`,
`MODE=webgpu-swiftshader` and root-relative `OUTPUT=...` allow isolated experiments.
WASM failures make the benchmark command fail; expected unavailable GPU modes are
recorded. The scorer verifies corpus/catalog identity and exact Python/JS results.
Audio remains in ignored `data/stt-benchmark`; weights/catalogs stay under ignored
`data/stt-models`. The benchmark serves only generated assets, models and corpus
on its temporary loopback port, and closes its own browser/server afterward.
