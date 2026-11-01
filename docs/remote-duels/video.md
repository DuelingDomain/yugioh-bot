# Remote table video

Multiplayer tables use one LiveKit room per table: `remote-{slug}` (the public table identifier). Each seated app user has identity `remote-user-{users.id}`, signed immutable `{guildId,tableId:slug,userId,seat}` metadata and one `field-cam` camera track. Mic is off until enabled. Solo keeps the existing local camera/OCR flow, with no LiveKit import, credentials or media room.

## Local WSL2 / Docker

From the `feat/remote-video` worktree with Node 22:

```sh
export PATH=/home/sulman633/.nvm/versions/node/v22.23.3/bin:$PATH
npm ci
npm run build --workspace=packages/shared
# Confirm these listeners are free before starting (TCP 7880/7881, UDP 7882).
ss -ltnup | rg ':788[012]\b'
docker compose -f services/livekit/docker-compose.yml up -d
export LIVEKIT_URL=ws://127.0.0.1:7880
export LIVEKIT_API_KEY=devkey
export LIVEKIT_API_SECRET=secret
```

The pinned dev server advertises loopback ICE candidates and explicitly maps its ports to the host under WSL2. It exposes signaling/HTTP **7880 TCP**, WebRTC fallback **7881 TCP**, and multiplexed **7882 UDP** only to 127.0.0.1. No persistent volumes, recording or image storage. Dev credentials are public placeholders for this local server only. This works with Docker Desktop and WSL Linux Docker; it does not require Docker host networking or custom browser networking flags. Container loopback candidate gathering stays disabled: Docker forwards media to the container NIC, which must own the advertised socket. For browsers on another machine, use Cloud below.

For the focused reproducible proof (no engine/card-data download, web 3310, ws 3312, internal ws 4312):

```sh
npm exec --workspace=packages/e2e -- playwright test -c playwright.remote-video.config.ts
```

Playwright launches two isolated authenticated browser contexts with fake camera/mic flags, creates a real multiplayer lobby and joins both seats. It proves decoded video in both directions, owner-targeted recognition with broadcast results, an actual RTP frame stall and recovery, SDK reconnect, microphone controls and stop cleanup. The stack seeds only `packages/e2e/.stack-remote-video/video.sqlite` and stops its child processes by PID. It never starts the engine or touches port 3000. LiveKit must already be running; it is deliberately not stopped by the test.

For interactive use with existing sign-in, export the HTTP/WS environment from [contract.md](contract.md) with unused local ports, `REMOTE_DUELS=1`, a worktree-local absolute `DATABASE_PATH`, the same `DISCORD_GUILD_ID` and `WS_INTERNAL_SECRET` in both services, and the three LIVEKIT variables in web. Run Next dev on 3310 (`npm run dev --workspace=packages/web -- -p 3310`); use `WS_PORT=3312`, `WS_INTERNAL_PORT=4312`, `WS_INTERNAL_URL=http://127.0.0.1:4312`, `NEXT_PUBLIC_WS_URL=http://localhost:3312`, `WEB_URL=http://localhost:3310`. Run `npm run dev:ws` in a second terminal. Two accounts create/join a multiplayer table, then each clicks **Enable table video**. Video works in lobby, before deck setup. Choose a field camera, optionally enable mic; **Enable sound** recovers browser audio autoplay restrictions. **Enable table video** retries a terminal disconnect with new credentials. Stop releases camera/mic; navigation and table end do too.

```sh
# Stop only this media service when done.
docker compose -f services/livekit/docker-compose.yml down
```

## LiveKit Cloud / testers through a web tunnel

Change only the web server environment and restart it:

```sh
LIVEKIT_URL=wss://YOUR_PROJECT.livekit.cloud
LIVEKIT_API_KEY=YOUR_PROJECT_API_KEY
LIVEKIT_API_SECRET=YOUR_PROJECT_API_SECRET
```

The browser receives the URL and a short-lived token from the authenticated route; the API key/secret stay on web. Root app Compose forwards these three variables to web. No client build-time provider setting is needed. Serve/tunnel the web app via HTTPS for camera access, and expose the game-state websocket via WSS with its allowed `WEB_URL` matching the tunnel origin (`NEXT_PUBLIC_WS_URL` is a browser build/dev setting). Cloud carries media directly; an HTTP tunnel to local LiveKit's signaling port alone cannot carry its UDP/TCP ICE ports. Keep local dev credentials and loopback Compose off public networks. Self-hosted internet media needs separately configured public ICE/TURN/TLS; it is outside this local dev setup.

## Client integration / recognition

`src/lib/remote/video.ts` owns the SDK lifecycle. `RemoteVideo` exposes subscribe/getSnapshot, connect/stop/dispose, selectCamera(deviceId), setMicrophone, requestRecognition, and **rawLocalTrack**. Capture targets 1920×1080 at 24 fps with detail preference, simulcast and adaptation for receivers; recognition always reads the raw local capture. Track mapping checks token metadata against the current HTTP seat roster, so names and track labels cannot claim another seat. The provider/controls/tiles in `components/remote/remote-video.tsx` are replaceable without modifying the controller or routes.

`video-protocol.ts` uses `remoteDataMessageSchema`. Requests are reliable packets directed only to the feed owner's LiveKit identity. A separate `remote.recognition.pending.v1` announcement sends peers only `{requestId,feedOwnerSeat}` for correlation; it has no coordinates/frames. Results use the contract's `recognition.result` and broadcast on `remote.recognition.v1`. Every peer checks sender membership, requested owner, first result, ten-second deadline (60 seconds for a paired-phone feed), 128 pending cap and 8-KiB payload cap. The adapter throttles requests at 100 ms per sender. These are client checks on an SFU data channel; the existing WS fallback remains the server-enforced option for shared-across-tabs cooldown and adversarial relay validation. They are not persisted or automatically converted to game actions.

Pass a `RecognizeRawFeed` callback to `RemoteVideo` to attach **@yugidraft/vision**. It receives `{track,request,signal}`; crop normalized `x/y` from that raw track, return at most five `{cardId,name,score}` guesses. The default returns zero candidates and the proof UI says vision integration is pending. No model/assets are loaded, and no frames are sent. A future UI must offer explicit candidate selection and submit `card.identified` through the existing authoritative action route.

Feed health uses `requestVideoFrameCallback` (decoded frame-count fallback). An unmoving board remains live; no presented frame for three seconds shows **Feed frozen**. It recovers on the next frame. This measures local playback, so hidden/background-throttled tabs can show a freeze until playback resumes. Connection quality is LiveKit's per-participant quality, distinct from frame health. The SDK handles temporary network reconnect/republish. A terminal disconnect exposes an explicit fresh-token retry; expired/ended/left memberships fail token issuance.

Token TTL is five minutes. JWT grants allow camera/microphone/data, subscribe-all in this room, and disallow changing participant metadata or screensharing. The client publishes exactly one field track; LiveKit source grants restrict track sources, not a hard per-source track count. Self-hosted token expiration governs new joins, not automatic removal of an already connected malicious client: production revocation on seat departure/table closure needs a server-side room/participant lifecycle integration. The current page stops its own room on end/unmount. Before untrusted public testing, add server-side revocation for departed seats and ended tables.

References: [local LiveKit](https://docs.livekit.io/transport/self-hosting/local/), [selective reliable data packets](https://docs.livekit.io/transport/data/packets/), [SDK](https://docs.livekit.io/reference/client-sdk-js/).

## Verified

On 2026-10-31 with Node 22.23.3, Docker Desktop under WSL2 and LiveKit 1.13.11:

- 58 targeted web tests passed: `duel-actor-auth`, `remote-recognition`, `remote-video`, `remote-solo-controls`, `remote-room-ordering`.
- Shared build and web/e2e TypeScript checks passed.
- The focused two-context fake-media browser test passed against real HTTP, Socket.IO and LiveKit services. Cloud/tunnel operation is configured and documented, but was not exercised with project credentials.

## Phone camera runbook

Use **Use phone as camera** in a table lobby or active table. Scan the QR on the phone, tap **Connect camera**, allow camera permission, then frame the mat. The desktop switches as soon as the signed phone track is accepted; a webcam on the desktop is unnecessary. Use **Scan mode** without a stand; choose a zone, tap **Scan card**, then choose the card on the desktop to announce/place it. **Re-pair phone**, **Revoke phone**, and **No camera (manual)** are available beside the seat camera controls.

For an actual phone, serve the web app on an HTTPS origin reachable by both devices. A QR pointing to `localhost` on a development desktop is only usable in that same machine's browser; the phone needs the reachable HTTPS/tunnel origin. Use a matching WSS game socket and public LiveKit Cloud or correctly configured public ICE/TURN. The loopback-only dev LiveKit cannot carry a real phone's media merely by tunneling the web app. Keep this page foregrounded/unlocked, especially on iOS. Unsupported lens/torch/focus/wake capabilities are hidden or report a best-effort fallback. The framing/light/detail checks are advisory; there is no browser thermal sensor claim.

Focused proof, from the phone worktree with Node 22 (web 3436, WS 3437, internal 4437; no engine or STT service):

```sh
export PATH=/home/sulman633/.nvm/versions/node/v22.23.3/bin:$PATH
npm ci
npm run build --workspace=packages/shared
# Reuse already prepared assets read-only, or prepare data/vision per its README.
VISION_DATA_DIR=/path/to/prepared/data/vision \
E2E_PHONE_FRAME=/path/to/prepared/data/vision/benchmark/photo-00.jpg \
E2E_PHONE_SHOTS=/path/to/phone-shots \
  npm exec --workspace=packages/e2e -- playwright test -c playwright.remote-phone.config.ts
```

`photo-00.jpg` in the existing vision benchmark is Sacred Sword of Seven Stars (`45725480`), centered at `.5,.5`. The fake phone camera alternates sharp/blurred frames; the test checks the burst selects the highest sharpness score, uses real JPEG/data packets and real desktop inference. The phone context is signed out, at 390×844 with 4× CPU throttle; landscape 844×390 is also captured. The desktop denies camera calls. API tests cover expiry/replay, simultaneous redemption/issuance, scope and re-pair/leave/end revocation. Device source grants and active reconnection/removal are checked against this test's own ephemeral LiveKit room. The stack never starts/stops/reconfigures the existing media server or reserved ports. App processes stop by child PID.

Artifacts and measured timings from this run are under the owner's requested `data/briefs/remote-duels/phone-shots/`, including `timings.json`. They measure a synthetic indexed-card fixture and mobile CPU emulation, not physical-phone accuracy, camera lens controls or thermal behavior. The default is still transfer + desktop recognition; optional phone inference/controller/STT remains follow-up work. See the [phone contract](contract.md#phone-field-cameras-and-handheld-scans) for the data path, bounds and pinned OSS revocation limitation.

Phone proof on 2026-11-01: **6 e2e tests + 36 existing targeted web tests passed**, with shared build and web/e2e TypeScript checks. At 4× phone CPU throttle, 1080p burst selection/JPEG transfer took **976–1,660 ms**; scan-to-desktop-confirmation took **14.61 s cold**, then **3.52 / 3.91 s warm** on the indexed fixture. The three-context opponent click returned the real card name from the owner desktop, including its first cold read. A scan-only phone can reload/resume without a camera track; replacement while a confirmation is open clears the previous scan.
