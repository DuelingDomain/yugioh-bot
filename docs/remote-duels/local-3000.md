# Remote Duels on the owner's local server

Deployed 2026-11-01 using the requested 20261102 backup labels. Open **http://localhost:3000/duels/remote** and sign in normally with Clerk. Use `localhost` consistently.

## Test today

1. For a solo test, select **Solo test with bots**, choose two, three or four seats, and click **Create table**. Decks are optional when omitted in solo. Click **Ready**, then **Start table**. **Turn camera on** enables local webcam preview; allow camera access. Try LP changes, phases, undo, commands, and board editing. Click a visible card in the video to recognize it; allow the initial model/index load to finish. Voice uses the local STT service.
2. For two human players, use two separate browser profiles or browsers signed in as different app users. The host creates a table with Solo disabled and shares the table URL. The other player clicks **Join available seat**. Each player selects a valid saved deck and clicks **Ready**; the host clicks **Start table**. Each enables their camera. Confirm video, shared LP/phase changes, undo and recognition from the other feed. The local database currently has one Clerk-linked user, so a second distinct human account was not exercised in this deployment smoke test.
3. For face-down tracking, activate a supported search/Set effect, then choose the resulting card. **Cards Set from Deck are shown to all** defaults on and also covers searches to hand. Turn it off before starting to test private choices and explicit public reveal. Candidate lists remain controller-only.
4. **Use phone as camera** creates a five-minute QR/link and short code. Keep the signed-in desktop open: it runs recognition. The phone camera shell needs no sign-in. **Revoke phone** removes access; **No camera (manual)** retains normal table controls. Phone **Scan mode** sends stills to the desktop for confirmation.

## Real phone over LAN

The current QR contains `localhost`, which refers to the phone itself when opened there. A physical phone therefore cannot use this URL as deployed. It needs an HTTPS address reachable from the phone (camera permission requires a secure context), a reachable application WebSocket endpoint, and reachable LiveKit signaling plus working WebRTC ICE/media routes. Current LiveKit ports and advertised media addresses are loopback-only. Changing the QR hostname alone is insufficient. A later tunnel setup must configure those URLs/origins; an HTTP tunnel to LiveKit signaling alone does not carry its media. LiveKit Cloud or a correctly configured ICE/TURN deployment can supply the media path. Phone voice controls are not implemented. No firewall or port exposure was changed for this deployment.

## Integration and configuration

Backup branch `test/local-main-backup-2026-11-02` preserves `65e078328637aaaf0c7125253a9ed8061929b73d`.

| Source branch | Source SHA | Local merge |
| --- | --- | --- |
| `origin/feat/remote-ui` | `0a96a709c23289d488dfcccdb4e6399c4ce9cd6d` | `718ec73218f15230d0af0f20854f5591a4d64863` |
| `origin/feat/remote-facedown` | `28b805bc418269cc78880229c2dfbfd855325faa` | `3f15a23345d9fb48946af6d8c1dfe01ce36470d0` |
| `origin/feat/remote-phone` | `7c6aa3d03b701f3d6a4acb119bce24ae670d23fe` | `73e366199bc0160c8544dda8d6572f00aa951fd8` |

Remote UI merged cleanly. Face-down conflicts affected the browser harness/tests, recognizer, table, overlay types and CSS. Phone conflicts affected the example env, lockfile, contract, shared exports, feed, recognizer, table, video hub and media protocol/controller. Resolutions preserve the reviewed UI's buffering, recognition flags, reconnect reporting, request cleanup, layout and deck controls together with face-down privacy and phone pairing/scan/manual modes. Explicit recognition targets take precedence over existing-copy matching. Peer webcam and phone guesses cannot use private deck priors. Test fixtures were updated for the current feature gate, physical-card filtering and recognition options; the feedback CLI runtime test no longer pulls its browser-oriented module graph into shared's NodeNext typecheck.

Each of `yugidraft-web-local`, `yugidraft-ws-local` and `yugidraft-duel-server` loads the new `zzzzzzzz-remote-duels.conf` drop-in, which adds `/home/sulman633/repos/yugioh-bot/data/services/remote-duels.env`. Added environment names: `REMOTE_DUELS`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `VISION_DATA_DIR`, `REMOTE_VISION_FEEDBACK`, `REMOTE_VISION_AI`, `NEXT_PUBLIC_REMOTE_STT_URL`, `WEB_URL`, `WS_INTERNAL_URL`, `NEXT_PUBLIC_WS_URL`. AI was enabled after checking that the existing web env contains an Anthropic key; no key was printed or copied. Public URLs and Clerk's public key were exported during the web build.

Vision models/index remain in `/home/sulman633/repos/yugioh-bot/.worktrees/remote-vision-feedback/data/vision`; its worker/runtime was rebuilt from the integrated code. SQLite was backed up using SQLite's backup API and checked before migrations: `/home/sulman633/repos/yugioh-bot/.worktrees/domain-multiplayer/data/bot.sqlite.bak-before-remote-duels-20261102` (163,733,504 bytes).

## Verification

- Node 22 real `npm ci`; shared, vision, WS, duel-server and web standalone builds passed.
- Shared, web, WS, duel-server, vision and E2E typechecks passed.
- Shared: 139 tests (129 remote plus 10 feedback). Web: 118 tests across remote recognition, video, AI route, actor auth and vision lab. WS: requested remote/recognition filter passed, then the complete 18-test duel-events file passed. Duel-server legality/admission: 159. Vision: 52. Total distinct tests: **486**.
- Playwright on the deployed `:3000`, using a temporary genuine Clerk development session and fake media: remote lobby and active solo table loaded, camera frames decoded, LP updated, strict Deck publicity persisted, room WebSocket joined, solo local-preview and multiplayer LiveKit token paths worked, LiveKit signaling connected, and STT returned ready from the page origin.
- Signed-in vision worker, index, both models and WASM returned 200. Phone pairing used a separate unsigned browser, redeemed successfully, delivered video and was revoked. Browser reported zero page errors. Temporary Clerk sessions were revoked and smoke tables were closed.
- Home, `/duels`, `/decks/new` and remote lobby returned 200 without isolation headers. The table had COOP `same-origin` and COEP `credentialless`; the vision lab had COEP `require-corp`. Phone camera shell had neither isolation header. Clerk sign-in returned 200 with its SDK loaded; unsigned remote API returned 401.
- All three units remain active, duel `/healthz` returns `ok`, and ports 3000, 3002, 4002 and 4003 listen. LiveKit/STT containers, the stopped bot, protected checkouts and reserved ports were not changed.

Smoke evidence is saved locally in `data/remote-duels-local-smoke-20261102.json`. The integration web build copy and runtime-unneeded route trace manifests were removed (about 2.8 GiB); the web unit serves the 341 MiB `web-live` copy. Future web changes require rebuilding, packaging standalone, copying to `web-live` and restarting the unit. No PR or push was created.
