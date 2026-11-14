# Remote Duels voice commands

Voice changes phases and proposes ending the turn for a seated player. It does not name cards, change LP, declare attacks, or run game effects. The physical game and the normal table controls remain authoritative. Player talk is separate and currently off.

The mic starts muted. Press **Unmute** in the table voice dock to enable it. **Mute**, leaving the table, ending the game, or losing the server capability closes the listener, workers and microphone tracks. Push-to-talk captures command audio only while V is held; otherwise the existing energy gate separates utterances. Only this browser's own microphone feeds the models. Audio is processed in memory in the browser and is never uploaded by voice commands or diagnostics. Models and workers load only after the server enables voice and the player unmutes. The lobby's **Test microphone** is an explicit, local level-meter check and loads no voice model.

## Methods

The **Voice method** selector in the existing voice dock restarts the listener. Its choice is saved in localStorage (`dd-remote-voice-method`); blocked storage does not prevent switching.

- **Keyword gate + verify** (default): sherpa-onnx listens for the fixed phase/turn vocabulary. Moonshine loads on the first keyword hit and decodes flagged utterances only. A whole-phrase match and the existing game-state checks must confirm the command.
- **Keywords only**: the same small keyword model and fixed vocabulary, without the speech verifier. Existing bare-word/chatter filtering and `interpret()` still apply.
- **Speech model**: Moonshine decodes each gated utterance, followed by the unchanged phase/turn matcher and `interpret()`.

Examples: “standby phase”, “main phase one”, “battle phase”, “main phase two”, “end phase”, “next phase”, “go back a phase”, “end turn”. All three methods are limited to phases and turns. Other words cannot become card/LP/attack actions through this listener. Spoken “undo” is not included in this vocabulary; use the Undo button or Ctrl+Z.

A phase command uses the existing phase action directly. An end-turn command shows **Pass turn** and requires a click or Enter. Cancel or Esc discards it. A changed table sequence or muted mic invalidates a pending voice confirmation. Off-turn commands are refused; solo tables retain their existing control of the current turn seat.

## Switches

These are **web runtime environment variables**, read on the server. Recreate web after changing deployment environment; no rebuild is needed for these switches. The browser receives `voiceEnabled` and `voiceDiagnosticsEnabled` as viewer capabilities in its room response, alongside `recordingEnabled`. Socket snapshots preserve that viewer's capabilities; they do not grant them to other seats.

| Variable | Default and exact meaning |
| --- | --- |
| `REMOTE_VOICE_USERS` | Unset or empty: off for everyone. Comma-separated application `users.id` decimal strings, whitespace trimmed. `*` grants nothing. A user must also pass `remoteDuelsEnabledFor`: `REMOTE_DUELS=1` and the existing `REMOTE_DUELS_USERS` rules. Only seated viewers receive voice enabled. |
| `REMOTE_VOICE_DIAGNOSTICS_USERS` | Same list syntax and default-off behavior. Only meaningful for a user already enabled for voice. Does not grant voice or table access. |
| `REMOTE_VOICE_DIAGNOSTICS_DIR` | `<folder of DATABASE_PATH>/remote-voice-diagnostics`. Compose fixes it to `/app/data/remote-voice-diagnostics` on the writable data mount. |
| `REMOTE_VOICE_DIAGNOSTICS_MAX_BYTES` | `209715200` (200 MiB). A positive safe whole number overrides it; missing, zero, negative or invalid uses the default. Total managed-file cap, enforced on every append. Oldest file by modification time is deleted first, including the current file if necessary. A single batch larger than the cap is refused. |

Example: `REMOTE_VOICE_USERS=2,3`, `REMOTE_VOICE_DIAGNOSTICS_USERS=2`. User 2 gets voice and text diagnostics, user 3 gets voice only. Other users get both fields false. The retired `REMOTE_VOICE_RECOGNITION`, `NEXT_PUBLIC_REMOTE_STT_URL` and external speech WebSocket client are no longer used.

Workers use `/dev/vision-assets/kws/worker.js` and `/dev/vision-assets/asr/worker.js`, with assets from the same subtrees. The existing asset route requires Remote Duels access outside the public development lab; it already admits a voice-listed Remote Duels user. Its access rule is unchanged: other authorized Remote Duels users can request those URLs just as they can vision assets, but their table never requests voice workers or models. In development or with `DUEL_FX_LAB=1`, the existing lab rule makes these assets public. Keep the lab switch off in production. Packaging those files in the production image is a separate change.

## Undo and visibility

A voice action has `cam.by=player` and `cam.ui=voice`. Every seated viewer's normal event log shows **· voice** on its phase/turn line. The speaking player also gets a local voice log entry. Other seats never get transcripts or diagnostics through the room response.

For a false phase change, press **Undo** once (or Ctrl+Z). For an accidental end-turn proposal, press Cancel before confirming; if it was confirmed, press Undo once. The ordinary undo action restores the previous phase, turn number and turn seat and broadcasts the correction to other seats; the original event remains in the history alongside the undo. There is no special voice undo transaction or extra log action to undo first. The current server rule is the player's last 20 actions in the current/previous turn, with normal conflicts and game boundaries; it is not the historical five-second rule described in older contract sections. If a newer own action intervenes, undo it first or use recent actions where allowed. A conflict shows the server's reason. No voice-specific bypass is added.

## Diagnostics and tester labels

Only diagnostic-listed, voice-enabled seated users send records to `POST /api/remote/<slug>/voice-diagnostics`. **VOICE LOG · text only** is visible while their table mic is enabled. It indicates that diagnostics are being collected, not confirmation that storage succeeded.

Each utterance records method, text, stage-1 keyword hits (score null when unavailable), stage work milliseconds, stage-2 transcript/passes, canonical command, outcome/reason, turn/phase/turn-seat/own-seat snapshot, speech/audio duration, and end-of-speech-to-model-decision latency. End-turn proposals initially record `needs-confirm`, then a later decision records confirmation, cancellation or refusal. Sent actions carry their room action ID; a later observed undo adds a linked record and milliseconds since the action. The action-to-undo interval uses the browser clock and can include notification delay.

Every roughly five seconds a perf record stores worker busy ms per stage and elapsed window ms. `idle=true` means no detected speech or delivered utterance in that window; active windows include speech, chatter and false hits. These are observed worker work/wall-time shares, not OS CPU measurements or hand-labelled silence. Worker results supply the measurements; diagnostics never run a model again.

**Wrong** labels the last voice result: pick an intended phase/turn command, **nothing (I did not say a command)**, or **Other words…** and enter text. A command marked nothing is a false-activation label. **It missed me** records what was said without requiring a fired result, with up to five recent utterance IDs as context. Labels are diagnostic evidence only and do not undo or execute a command.

Records are lossy and best effort: at most 100 records / about 48 KiB queued, oldest first dropped; batches at most every five seconds and on page hide via beacon/keepalive. A failed batch is discarded silently. The server accepts strict Zod-validated JSON only, at most 64 KiB / 100 records, and at most 24 requests per user per minute across tables. Access refusals return 404. There is no read/download API.

Files are JSON Lines at `<dir>/<table slug>/<userId>-<seat>.jsonl`. Each line also has server epoch time, user ID, seat, table slug and build ID (`SENTRY_RELEASE`, then `GIT_SHA`, else `unknown`). Table folders are created with mode 0700 and new files with 0600. The normal production web process is uid/gid 1000: its parent data directory must already be writable by that identity, as for test recordings. Existing directory/file modes are not changed, and storage failures return a quiet 503. No database migration or transcript table is created.

## Export and analyse

Copy files only for participating testers. From a trusted machine with VM SSH access, adapting the deployment path:

```sh
umask 077
ssh <vm> 'sudo tar -C /path/to/app/data -czf - remote-voice-diagnostics' > voice-diagnostics.tgz
chmod 600 voice-diagnostics.tgz
mkdir -p voice-diagnostics
tar -xzf voice-diagnostics.tgz -C voice-diagnostics
export PATH="$HOME/.nvm/versions/node/v22.23.4/bin:$PATH"
./node_modules/.bin/tsx scripts/voice/analyse-diagnostics.ts voice-diagnostics/remote-voice-diagnostics
./node_modules/.bin/tsx scripts/voice/analyse-diagnostics.ts <file1.jsonl> <file2.jsonl> --json
```

Use the already-installed local `tsx`; no download or model is needed. The analysis reports per-method utterances, final acted/rejected counts by reason, wrong/missed/false-activation marks, frequent transcript-to-intended pairs, undo-within-10-seconds rate among acted commands, mean/nearest-rank p95 latencies, and wall-time-weighted stage busy shares for idle versus active windows. No observations produces null rates/latencies, not zero. Malformed records fail with file/line context. Because uploads and cap eviction are lossy, results describe the retained sample and are not a complete usage count. Do not export unrelated voice text publicly.

## Turn off

Empty `REMOTE_VOICE_DIAGNOSTICS_USERS` and recreate web to stop diagnostics while keeping voice. Empty `REMOTE_VOICE_USERS` and recreate web to close both. Existing clients receive the changed capabilities on their next room refresh; reload open tester tabs for immediate shutdown, or press Mute locally. `REMOTE_DUELS=0` also closes access. Existing diagnostics stay until manual deletion or cap eviction; turning off a switch does not delete files.

Users outside the voice list have no new mic capture, voice worker/model request, or diagnostics record. Diagnostic text can include incidental speech picked up by the tester's own mic; it is still sensitive even without audio. This feature never captures an opponent's remote audio track and never writes PCM, audio blobs or recordings to diagnostics. The development audio test-set page is a separate, explicit recording tool.
