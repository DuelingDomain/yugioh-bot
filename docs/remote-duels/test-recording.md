# Test recording

Real webcam footage is the missing piece for card-reader decisions. Test recording saves the table camera of a few named players on the server, so the models can be replayed on it later.

## What it does

- Off unless `REMOTE_RECORD_USERS` lists the player. The value is a comma list of `users.id` values. `*` does nothing here. Unset or empty = off for everybody. It is separate from `REMOTE_VISION_FEEDBACK` and the diagnostics flags, which stay off on prod.
- Only a seated player is recorded, and only their own table camera track (the one the field watcher reads). Video only, no audio. Not the opponent, not spectators, not the phone-scan view.
- The browser learns the setting from the room response (`recordingEnabled`), never from an env. While a file is open the player sees a red `REC` badge next to the recognition badge in the camera status row.
- The browser records with `MediaRecorder` (VP9, else VP8, else MP4), at most 2 Mbps, in 10 s chunks, and uploads them in order to `POST /api/remote/<slug>/recording`. It never changes the camera. When the network is slow it drops the oldest chunks quietly. It starts a new file when the camera track changes, when the server forgot the recording (restart), or when a file lost its header. If the recorder cannot start, it waits 5 s, 30 s, then 2 min before it tries again, and stops after a few failures until reload.
- Every board action now also carries a camera stamp `cam` (`seenAt` = the detector's first outline, `namedAt` = the end of the last read, `sentAt` = the moment the action was made; all on the client clock `performance.timeOrigin + performance.now()`, plus the build id `v` on watcher actions), and an automatic `twin.remove` has `source: "auto"`. Two fields say who made the change: `by` is `camera` (the watcher on its own) or `player` (a click, a typed or spoken command, a choice in a watcher prompt, or any button on the board), and `ui` names the control (`popup-remove`, `undo`, `auto-undo`, `voice`, `typed`, `stale-recover`, `prompt-choice` and so on; many player actions have no `ui`). A player action gets its stamp once per idempotency key and keeps the same stamp on every retry, because the server compares a repeated key with the saved action. Only `side.timeout` (a timer) is not stamped. This is evidence only: no rule reads `cam`, `by` or `ui`, and `source` stays the field that matters to the game. The stamps are stored in the room events for every Remote Duels player, not only recorded ones; old events without them stay valid.

## Files

`<REMOTE_RECORDINGS_DIR>/<table slug>/<userId>-<seat>-<start time>.webm` (or `.mp4`) and a sidecar `.json` with the same name: table, user, seat, start time (server), client clock at the start request, `videoStartDateNow` / `videoStartPerfNow` (the clock when the recorder really started, sent with chunk 0: video time 0; with `timeOrigin` it matches the camera stamps), clock offset and round trip of the start request, `client.clockSamples` (one `{n, serverMs, offsetMs, rttMs}` per uploaded chunk, at most 1000 per file, about 110 bytes each in the file, so the sidecar stays under 200 KB: before each chunk the browser times a tiny `?action=clock` round trip, so the offset can be followed over a long match; chunk 0 uses the start sample; a chunk whose ping failed has none), `calibrations` (the mat the field watcher reads with: corners, orientation, zone spacing and zone boxes, the table format, and whether the mat is placed or still needed; sent with the start request and again about 2 s after each change, whitelisted fields only, at most 4 KB each, at most 20 kept: the first and the latest), video size and fps, mime, app version, user agent, recognition backend, chunk and byte counts, end reason. The sidecar is rewritten at the start, after every chunk and at the end. A closed tab sends no end call: the file then has no end reason, but the counts are current.

The browser sends the calibration and clock pings on the same route (`POST /api/remote/<slug>/recording?action=calibration&id=` with a JSON body, `?action=clock&id=` with no body); there is no other endpoint. Both only work for the recorded user's own open recording.

### Export the event list right after the match

The room event list (every action, with its `cam` stamp and server `at`) is not copied into the sidecar. Export all of it right after the match by paging `GET /api/remote/<slug>?afterSeq=<last seq>` until no new events come back, and save it next to the video (PR #604 documents the loop and the `--events room.json` input of the replay tool). Nothing in the recording code does this for you.

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

## Prod

Set `REMOTE_RECORD_USERS=2,3` in the VM `.env` and recreate `web`. To stop, empty it and recreate `web`; files stay until deleted by hand or by the cap. The files can show the player's hands, room and screen glare: copy them off the VM only for the people who agreed.
