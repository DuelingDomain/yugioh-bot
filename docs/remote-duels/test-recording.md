# Test recording

Real webcam footage is the missing piece for card-reader decisions. Test recording saves the table camera of a few named players on the server, so the models can be replayed on it later.

## What it does

- Off unless `REMOTE_RECORD_USERS` lists the player. The value is a comma list of `users.id` values. `*` does nothing here. Unset or empty = off for everybody. It is separate from `REMOTE_VISION_FEEDBACK` and the diagnostics flags, which stay off on prod.
- Only a seated player is recorded, and only their own table camera track (the one the field watcher reads). Video only, no audio. Not the opponent, not spectators, not the phone-scan view.
- The browser learns the setting from the room response (`recordingEnabled`), never from an env. While a file is open the player sees a red `REC` badge next to the recognition badge in the camera status row.
- The browser records with `MediaRecorder` (VP9, else VP8, else MP4), at most 2 Mbps, in 10 s chunks, and uploads them in order to `POST /api/remote/<slug>/recording`. It never changes the camera. When the network is slow it drops the oldest chunks quietly. It starts a new file when the camera track changes, when the server forgot the recording (restart), or when a file lost its header. If the recorder cannot start, it waits 5 s, 30 s, then 2 min before it tries again, and stops after a few failures until reload.
- Every watcher action now also carries a camera stamp `cam` (`seenAt` = the detector's first outline, `namedAt` = the end of the last read, `sentAt` = the board write; all on the client clock `performance.timeOrigin + performance.now()`, plus the build id `v`), and an automatic `twin.remove` has `source: "auto"`. These are stored in the room events for every player, not only recorded ones.

## Files

`<REMOTE_RECORDINGS_DIR>/<table slug>/<userId>-<seat>-<start time>.webm` (or `.mp4`) and a sidecar `.json` with the same name: table, user, seat, start time (server), client clock at the start request, `videoStartDateNow` / `videoStartPerfNow` (the clock when the recorder really started, sent with chunk 0: video time 0; with `timeOrigin` it matches the camera stamps), clock offset and round trip, video size and fps, mime, app version, user agent, recognition backend, chunk and byte counts, end reason. The sidecar is rewritten at the start, after every chunk and at the end. A closed tab sends no end call: the file then has no end reason, but the counts are current.

## Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `REMOTE_RECORD_USERS` | empty (off) | Allowlist, `users.id` values. Web only. |
| `REMOTE_RECORDINGS_DIR` | `<folder of DATABASE_PATH>/remote-recordings` (`/app/data/remote-recordings` in Compose) | Where files go. |
| `REMOTE_RECORDINGS_MAX_BYTES` | 6 GiB | Total cap. At every start and every 12 chunks the oldest finished recordings are deleted first. Active files stay. |
| `REMOTE_RECORDINGS_MIN_FREE_BYTES` | 3 GiB | The server refuses a start or a chunk when the disk has less free space. |

Limits: 8 MB per chunk, 2 GiB per file (the browser then opens a new file), 8 recordings at once, one open recording per user and table (a new start closes the old one).

Storage is about 0.9 GB per hour at 2 Mbps (estimate from the bit rate cap, not measured on real footage; a still mat compresses below the cap, so the real figure is probably lower). The 6 GiB cap holds roughly 6 hours.

## Replay

```sh
npx tsx scripts/vision/replay-recording.ts <file.webm> [--events room.json] [--fps 10] [--from 0] [--duration 600] \
  [--calibration cal.json] [--data data/vision] [--json out.json]
```

It needs `ffmpeg` on PATH and the models from `scripts/vision/prepare.ts` and `build-index.ts`; it downloads nothing else. It extracts frames to a temp folder (deleted at the end), runs the current detector, embedder and field watcher on them through onnxruntime-node, and prints for every card the time it was first seen and the time it was named. With `--events` (the JSON of `GET /api/remote/<slug>`, or the event array) it also lists the live watcher actions with their camera stamps converted to video time, so live and replay times can be compared. Without `--calibration` the whole frame counts as the mat. Node CPU times are not browser times: use `--read-scale` to stand in for a slower machine.

### Other readers and run summaries

`--recognizer <name|path>` picks the card reader. `current` (default) is the app's own reader and runs the unchanged loader. Another reader is a small spec file (or `<data>/recognizers/<name>.json`), paths relative to the file:

```json
{ "name": "other", "kind": "ddindex", "embedder": "m/other.onnx", "index": "other.bin", "meta": "other.meta.json", "input": { "size": 224, "mean": [0.485, 0.456, 0.406], "std": [0.229, 0.224, 0.225] } }
```

- `kind: "ddindex"`: the app's index format. Embedding settings come from the index meta (`layoutKey`) and can be overridden in `input` (`size`, `mean`, `std`, `dim`, `inputName`, `outputName`, `pooling`).
- `kind: "whole-card-bank"`: a whole-card fp16 bank (`bank`, `catalog`; `input.size`, `inputName` and `outputName` are required, optional `thresholds.score` and `thresholds.margin`). The card is warped to 295x430 and box-averaged to `input.size`.

Other readers are for offline comparison only. Do not ship their model files or wire them into the app; where a model's training data comes from is still an open question (plan decision F.1).

`--json out.json` writes the run summary: every card read (video seconds, zone, name, score, margin, sure or not), time per read, tracks with the time from first seen to named, and, with `--events`, phantom reads (reads on zones the events say were empty) and the live seen-to-named gaps from the camera stamps. Phantom reads are only checked when the event list is complete (see Limits).

```sh
npx tsx scripts/vision/replay-recording.ts clip.webm --events room.json --calibration cal.json --json run-current.json
npx tsx scripts/vision/replay-recording.ts clip.webm --events room.json --calibration cal.json --recognizer ./other.json --json run-other.json
npx tsx scripts/vision/compare-recordings.ts run-current.json run-other.json [--window 1.5] [--json compare.json]
```

`compare-recordings.ts` needs two or more summaries of the same clip (same file, `--fps`, `--from`). It prints reads, sure %, time per read, wall time, phantom reads and time to name per reader, then agreement per pair (reads paired by zone and nearest time within `--window` seconds, names compared) and the reads that differ.

### Label harvest

```sh
npx tsx scripts/vision/harvest-labels.ts clip.webm --events room.json --calibration cal.json [--agree-seconds 20] [--max-crops 8] [--fps 2] [--holdout] [--allow-partial]
```

Writes `data/vision-harvest/<room>/` (git-ignored; `--out` and `--room` change it): `crops/*.jpg` (warped card crops), `labels.jsonl`, `hard.jsonl`, `summary.json`, and a `HOLDOUT` file with `--holdout`. Local only: no network, no upload, no training, no index change. Each record has the room, clip time, zone, seat, label, label kind, source, the reader's top answer (score, margin, tier), sharpness, the crop path and a `hard` flag. Label kinds, most trusted first:

| Kind | Meaning |
| --- | --- |
| `correction` | A player named the card (click, typed, voice) and the earlier name was different or missing: crops from before the rename get the corrected name (`previous` is the old one), on every span of the card, also after a move. Checked per crop: the reader's top 5 holds the card, or a later automatic event names it; otherwise the crop is `hard` with no label (and `proposed`). |
| `not-a-card` | Only when all hold: the watcher placed the card, a player removed it (explicit player mark) or undid the place, no player or unknown name, life of 30 s or less, no name or only a best guess from the watcher, no other card in the zone within 5 s, and no crop reads sure here. If a crop reads sure, the crops are `hard` with no label. |
| `agreed` | An automatic read (not a best guess) with trusted names that ended by removal, move or clip end and lay at least `--agree-seconds` (default 20) after its last name event. A crop is labelled only when the reader here gives the same card; else it is `hard` with no label. |
| `hard` | The watcher did not name the card, or only guessed: no label, the guesses are recorded. `hard.jsonl` lists every record with `hard: true`. |
| `empty-zone` | Sampled, capped crops of mat zones the events say are empty (5 s slack plus jitter). A crop is dropped if the reader finds any outline in the zone or the cell, even a partial, covered or face-down one. |

When unsure, the tool writes no label: a wrong label is worse than a missing one.

**Who did it.** An action is `auto` when `source` is `auto` or `cam.by` is `camera`; `player` when `source` is click, voice or typed, `cam.by` is `player`, or `cam.ui` is set; otherwise `unknown`. A source-less action is never taken as a person (the watcher itself sends undo and removes). Unknown names block `agreed` and `not-a-card`.

**Dropped cards.** A card gets no record (the summary `gaps` counts why) if it had an attach, detach, merge, control change, equip, pile lift or summon material; if an identify, move or remove was undone; if a move has no known place; if another card was put in its zone while it was open (overlap); or if players gave it several different names. A place or move in a zone with no slot (hand, pile) switches the empty-zone check off from then on.

**Margins.** A crop starts 1 s after the card was placed and stops 1 s + half the round trip + 1.5 s before the end event, because the server time of an end event is only known to about that much. The round trip comes from the sidecar (`clockSamples` when present, else `client.rttMs`).

Safeguards: at most 8 crops per card per match, spread over the time the card lay there; blurred crops are skipped (Laplacian variance, `--min-sharpness`); when the events cannot tie a correction to the earlier card, `summary.json` `gaps` says what is missing.

### Complete event list

The harvest needs every event of the room: seqs exactly 1..`lastSeq`. A list with holes, or one that starts after seq 1, is refused (the error names `export-room-events.ts` and `--allow-partial`). `GET /api/remote/<slug>` returns only the last 50 events unless `afterSeq` is used, so save the list with:

```sh
DD_SESSION_COOKIE='<Cookie header value of the player in that room>' \
  npx tsx scripts/vision/export-room-events.ts --base https://<app-domain> --slug <room-slug> --out room.json
```

The script pages `?afterSeq=N` (up to 200 events per page) and writes `{slug, lastSeq, exportedAt, events}` with mode 0600. It reads the cookie from the environment, never prints or writes it, and makes this one network read (the only network use of these tools). The output holds only the events that player's seat may see, so keep it local. It exits 1 when the list is not complete. With `--allow-partial` the harvest goes on with an incomplete list but writes only corrections with a second source and hard crops (no `agreed`, `not-a-card` or empty zones), and the summary says so.

Consent: only harvest recordings of people who agreed (the allowlisted test users). Use `--holdout` for a fixed test set: the `HOLDOUT` file marks the folder, and training or threshold tuning must never read a folder that has it. A player correction can be wrong, so a label counts only with a second source.

### Limits and event-format gaps

- The live card id is the watcher's own ref, so the link between an event and the video is by zone and time only. Zone matching needs the same calibration as the live run (`--calibration`); without it the whole frame counts as the mat.
- Correction events (a player naming, moving or removing a card, undo) carry no camera stamp, only the server time, so their video time uses the sidecar `clockOffsetMs` (about plus or minus half the round trip). Without that offset or the server start time the events are dropped and a gap is reported.
- The previous name before a correction is not in the event; it is taken from the earlier events of the same card.
- The harvest refuses an incomplete event list (see Complete event list above). `replay-recording.ts` accepts one but the summary says that phantom reads are not checked.
- A player removal that carries no player mark looks the same as a watcher removal, so it is `unknown` and never gives `not-a-card`. Newer optional fields (`cam.by`, `cam.ui`, `cam` on player actions, `clockSamples` and a live calibration in the sidecar) are read when present; their names must match the app change that adds them.
- Event card ids are numbers and index ids are strings; they are compared by id and by name. The sidecar has no decklist.
- Only the `current` reader was run for real in the checks of this change; the other kinds have a spec, a bank decoder and tests with fake readers, but no real model files were available.

## Prod

Set `REMOTE_RECORD_USERS=2,3` in the VM `.env` and recreate `web`. To stop, empty it and recreate `web`; files stay until deleted by hand or by the cap. The files can show the player's hands, room and screen glare: copy them off the VM only for the people who agreed.
