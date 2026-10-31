# Bridge host failures and owned packages

Goal: diagnose the live deck 9 request, retain meaningful host failure diagnostics,
and identify complete bridge packages without changing UI components.

- [x] Read the live service configuration, journals, detector and projection code.
- [x] Copy the actual live database through a read-only connection; reproduce only
  read operations against the running host. All other checks use scratch data.
- [x] Add targeted integration regressions for cancellation with Next's empty
  error, empty host bodies, and complete/partial packages including copy counts.
- [x] Preserve host status and bounded body in diagnostics. Treat caller aborts
  as cancellation, and ensure every constructed host error has a message.
- [x] Project `alreadyInDeck` and `missing` for bridge rows and engine packages;
  compare Main+Extra only, keeping Deck Master in detection and point accounting.
- [x] Update host/web validation, exported client types and the API contract.
- [x] Run targeted integration tests and package type checks, replay deck 9 on
  the scratch database, commit explicit paths, and remove generated build output.

The existing detection thresholds remain: deck 9 has Chaos and Sinful Spoils as
engines and Azamina as light. A failed HTTP request must not be confused with a
successful empty detection. Complete packages remain inspectable with an explicit
ownership flag; packages with missing cards remain actionable.

Evidence: the running services use `.worktrees/domain-multiplayer/data/bot.sqlite`,
not root `data/bot.sqlite` (the latter has no `saved_decks`). Signed live host
engines, corrected engines, saved-deck list and Sinful Spoils → Azamina lookup
all returned 200. The fixed host replay against a scratch backup returned Chaos
(6) and Sinful Spoils (4) as engines; Diabell (3, one distinct Main identity) and
Azamina (2, one Main plus two Extra identities) are light. Azamina's combined
suggestion still lacks 2006591, 20934683 and 38511382; the forward bridge alone
lacks 20934683. Adding the missing package on scratch produces `alreadyInDeck:
true`. No live service restart or deployment was performed.

Next's actual `ResponseAborted` class reproduces `{status: 0, text: ""}` against
the running host. Previously `callDuelHost` rewrapped this as `Error("")`, exactly
matching the journal's uninformative shape. The old log omitted the status/body,
so it cannot independently prove the historical response status. Current live
detection is nonempty; the UI's empty chip fallback after a request failure is
distinct from a successful empty detector result.

Review corrections: ownership preference and combined Genesys affordability run
before path/group deduplication and limits. A real-artifact Performapal regression
keeps a useful ninth package when eight higher-ranked packages are owned. The
`main-extra-packages-v1` deep-work namespace rejects old subscriber arrays whose
Side/Deck Master zones cannot be recovered, while preserving review caches.

Validation: four targeted shared/host integration files (36 tests); the web bridge
route integration file (22 tests); signed fixed-host replay using a scratch backup
of the live deck, plus web response validation (one temporary integration test).
Shared and duel-server builds and shared/duel-server/web typechecks also pass.
