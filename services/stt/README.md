# Remote Duels speech service

CPU HTTP + WebSocket transcription on **4020**, separate from the duel/application stack.
Default final decoder: **Whisper large-v3-turbo, faster-whisper int8**. Provisional text:
**Parakeet TDT 0.6B v3 int8 ONNX / sherpa-onnx**, re-decoded about every 400 ms.
Set `STT_MODEL=parakeet` for fast final results. Silero VAD gates silence and supports
optional automatic endpointing; push-to-talk release never waits for trailing silence.

The requested Parakeet primary is implemented and measured. The accuracy-first selection
rule changes the default: Whisper made fewer errors on this corpus. Its multi-second CPU
finalization **does not meet a sub-500 ms final-transcript target**. Parakeet provisional
text keeps feedback responsive while Whisper finalizes. For fast confirmed actions, use
Parakeet-only mode and retain confirmation/Undo in the caller. Neither partials nor final
transcripts execute game actions; grammar parsing and Remote Duels UI integration belong
to the application.

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
fetches about 2.2 GiB of weights; subsequent starts reuse `data/stt-models`. Nothing is
baked into the image or committed. The existing root `data/` ignore rule covers models,
clips and catalogs. Image build context excludes the virtualenv, benchmark data and models.

Fast Parakeet finals (same API):

```bash
STT_MODEL=parakeet docker compose -f services/stt/docker-compose.yml up --wait
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
services/stt/.venv/bin/python -m stt.download whisper parakeet
services/stt/.venv/bin/python -m uvicorn stt.app:app --host 127.0.0.1 --port 4020 \
  --workers 1 --limit-concurrency 32 --ws-max-size 64000 --ws-max-queue 8
```

Configuration:

| Variable | Default | Meaning |
|---|---|---|
| `STT_MODEL` | `whisper` | Final decoder: `whisper`, `parakeet`, or benchmark-only `zipformer` |
| `STT_PARTIAL_MODEL` | `parakeet` for Whisper, otherwise final model | Decoder for provisional text; `none` disables offline partials |
| `STT_THREADS` | `4` | CPU threads per recognizer; native decodes are serialized |
| `STT_MAX_ACTIVE` | `4` | Active WS utterances + HTTP uploads/decodes; excess gets busy error |
| `STT_MAX_SECONDS` | `15` | Maximum audio duration per utterance |
| `STT_MODEL_DIR` | root `data/stt-models` | Download/cache directory; Docker `/data/stt-models` |
| `STT_DATA_DIR` | root `data` | Catalog discovery base; Docker `/data` |
| `STT_CARD_CATALOG` | auto | Explicit `.cdb`, app `.sqlite`/`.db`, or names JSON path; must exist |
| `STT_API_KEY` | empty | Shared service key; HTTP `Authorization: Bearer ...` |
| `STT_ALLOWED_ORIGINS` | empty | Allowed browser origins, separated by commas |

Use one Uvicorn worker: extra processes duplicate model memory. Live audio queues are
bounded; partial work is skipped when inference is busy and final decodes take priority.
A running partial finishes before its native inference lock is released, including on
cancel/disconnect. Four active utterances bound queueing, not a concurrency latency SLA.
An utterance also has an absolute `STT_MAX_SECONDS + 10` second capture deadline and a
2,000-frame cap. Idle sockets close after 30 seconds; the server pings every 20 seconds.

## HTTP contract

- `GET /health`: readiness, final/partial model, model-load seconds, active utterances,
  catalog source and size. Only becomes available after models/catalog/VAD load.
- `POST /transcribe`: raw **mono 16,000 Hz PCM signed 16-bit little-endian** bytes,
  `Content-Type: audio/pcm` (or `application/octet-stream`). No WAV header, Opus or WebM.
- Optional `X-STT-Hotwords`: JSON array of at most 256 names (120 characters each).
  Deck cards and staples receive preferred matching. Silence returns empty text/matches.
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

1. Server: `{"type":"ready","model":"whisper","partialModel":"parakeet","sampleRate":16000,"format":"s16le","maxSeconds":15}`.
2. On key-down send `{"type":"start","requestId":"cmd-1","mode":"ptt","sampleRate":16000,"format":"s16le","partials":true,"cards":["Dark Magician"],"hotwords":["Ash Blossom & Joyous Spring"]}`. Only `type` is needed; other fields use these defaults or empty lists/id. `cards` and `hotwords` are name arrays whose combined unique size is at most 256. Punctuation in legitimate names such as `D/D` and `Number 39: Utopia` is accepted.
3. Wait for `{"type":"started","requestId":"cmd-1"}`, then send **binary PCM frames** while held. Recommended 20 ms / 640 bytes per frame. Maximum frame is 64,000 bytes; frames must be nonempty and contain complete 16-bit samples.
4. Server may emit `{"type":"partial","requestId":"cmd-1","text":"I activate Ash","audioMs":1200,"model":"parakeet"}`. Provisional text may change; no card replacements or actions apply yet. Offline re-decodes are attempted at approximately 400 ms of new audio, with at most one outstanding partial per utterance. Zipformer instead uses true incremental state.
5. **On key-up send `{"type":"end"}`**. The server decodes immediately, without a VAD silence delay. Final is the HTTP result plus `type:"final"`, `requestId`, and `reason:"release"`. `processingMs` includes any in-flight partial/queue wait, final inference and matching, measured from receipt of end; it excludes network time.
6. Send another start on the same connection, or close. `{"type":"cancel"}` discards the current utterance and returns `{"type":"cancelled"}`. Disconnect drains in-flight work and releases its slot.

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
latency but loses accuracy. Keep only **Whisper + Parakeet** locally; Zipformer and Piper
voice weights are removed after benchmarking. Retained weights total about 2.2 GiB:
Whisper's upstream file is fp16 on disk, quantized to **int8 at CPU load**, while Parakeet
is stored as int8 ONNX. No model binaries or synthesized audio are in Git.

Actual paced WebSocket smoke measurements (20 ms frames, partials enabled, three runs
per duration):

| Configuration | 1 s release p50/p95 (ms) | 3 s release p50/p95 (ms) |
|---|---:|---:|
| Docker Whisper finals + Parakeet partials | 2,580 / 3,704 | 3,242 / 3,497 |
| Native Parakeet finals + partials | 48 / 63 | 91 / 94 |

The default's first nonempty partial arrived at 414 ms from speech start in the
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
services/stt/.venv/bin/python services/stt/benchmarks/smoke.py --output services/stt/benchmarks/api-whisper.json
find data/stt-models/zipformer data/stt-benchmark/voices -type f -delete
find data/stt-models/zipformer data/stt-benchmark/voices -depth -type d -empty -delete
```

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
