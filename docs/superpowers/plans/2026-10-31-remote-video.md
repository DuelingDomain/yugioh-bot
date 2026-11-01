# Remote video implementation plan

Goal: authenticated 2–4 seat field cameras using local LiveKit or Cloud, with raw local frames retained and no media for solo tables.

Architecture: keep the existing HTTP membership guard and game-state socket. Mint short-lived LiveKit credentials with immutable seat metadata. A browser controller owns media and recognition transport; a small React provider and tiles consume it without changing the workbench layout. Freeze detection observes presented frames, not pixel differences.

- [x] Extend existing route authorization tests, observe failure, implement scoped tokens (five-minute TTL, camera/microphone/data grants).
- [x] Add pinned dev Compose with localhost signaling/TCP/UDP on 7880/7881/7882. Check ports before startup.
- [x] Test and implement media controller, frame watchdog, bounded recognition channel and raw-track integration callback. SDK reconnect plus explicit retry with fresh HTTP credentials.
- [x] Render multiplayer per-seat tiles and controls; keep the solo camera path intact.
- [x] Add focused two-context fake-media Playwright proof on isolated web/ws ports 3310/3312/4312 and a disposable DB. Verify video in both directions, frozen warning/recovery, data relay, reconnect and cleanup.
- [x] Run only affected tests and typechecks, review, document local/Cloud runbook and remaining vision integration, commit small and push without PR or merge.

Recognition messages are ephemeral suggestions, never game actions. The integration callback receives the raw capture track and request coordinates. Credentials derive solely from the signed-in user's stored membership. LiveKit source grants exclude screenshare and participant metadata changes. No provider switch or public secret is introduced.
