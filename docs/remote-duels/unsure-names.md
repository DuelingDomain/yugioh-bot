# Unsure card names

Local work from `121d26528617359175fffec1b85190df43d17394`, 15 November 2026. No commit, deployment, model training, footage download or recording-pipeline change.

## Decisions

- **Part 1 — KEEP, default ON.** Unanswered/resting weak names now have bounded fresh retries. The replay scores do not improve; controlled tests prove recovery when a later sure answer arrives.
- **Part 2 — KEEP.** The own-deck path is wired. Main, Extra and Side were already present; the omitted Deck Master is now included. Other seats still receive no private registration.
- **Part 3 — KEEP, switch OFF by default.** One new correct tentative arrival passes the full replay gates. No new wrong name, phantom, preview episode or stale source was found. This single gain is not established general improvement.

## Background reading

Previously, a new front could get a first read, the existing 420 ms voting window, and one retry for an unsettled crop. Once it asked its name question, `needsRead` was false and an unchanged resting outline did not restart recognition. Automatically shown “Best match” names also stopped reading.

Unanswered field fronts and automatic Best matches now retry after 1, 2, 4, 8, 16 and then 30 seconds. A shared limit waits nine times the preceding background request's duration after it completes, including an interrupted request. Thus background identity work has at most a 10% duty share across tracks; detector work and initial reads have their existing budgets. A slow read can require a wait longer than 30 seconds. Fresh candidates take priority. Only a still, sharp, uncovered, resting front without nearby hands or connected contact supplies a retry. The current frame is used, rather than a retained “best” crop.

These requests use the existing voting/fusion path, including its fast-reader limit and bounded frame clones. Only a sure, clean result settles a question or corrects an automatic name. The .77 sideways guard remains. Weak subsequent results leave the question in place, without asking it again. A face change or identity-check episode cancels the old retry. A pending sure name survives the preceding server snapshot until its save acknowledges it.

Player confirmation/dismissal cancels pending work. Tap corrections retain the existing ref/cell holds and the queue's stale-evidence checks. These protections apply before a camera write, including a result already in flight. The experimental marked guesses do not teach the session gallery; the older Best-match gallery behavior is preserved for existing card-return matching.

## Where a real table's deck prior comes from

The saved deck is copied into `RemoteDeckRegistration` by `packages/shared/src/services/remote-duels.ts:363`, stored/synchronized to `remote_seats.deck_json` by `:228`, and loaded by `:73`. The normal room response at `:241` projects it through `privateSeats` (`:250`). These are the same room-building paths used by live tables.

`packages/shared/src/remote/privacy.ts:53` exposes the actual registration only to its private seats. Other seats receive `deckRegistered`, not the list. State registrations (`:10`) and deck events (`:63`) are filtered too; spectators have no registrations (`:114`). Solo ownership can include the owner's bot seats. This policy is unchanged.

The owner path is:

1. `packages/web/src/lib/remote/recognition-priors.ts:60` collects that seat's Main, Extra and Side cards, now also its Deck Master.
2. `packages/web/src/components/remote/ui/recognizer.ts:117` maps passcodes, image aliases and related aliases to index IDs; `:129` constructs the reader priors.
3. `ownFieldResources` (`:399`, `:426`) supplies the current mapped priors. `components/remote/field-watcher.tsx:886` creates it from the current room and **my seat**. The watcher passes them to `recognize`; the bridge forwards those options at `ui/recognizer.ts:411`.
4. `packages/vision/src/pipeline.ts:154` constructs the explicit deck set. Existing full-catalog/off-list guards and confidence rules remain unchanged.

The actual omission was **Deck Master**, not Main/Extra/Side. Both `recognitionPriorsFor` and the shared UI helper `deckIdsOf` now include it. A regression test uses the real in-memory saved-deck/table service, both seat projections, real index-ID mapping and the owner reader bridge. Only inference is stubbed. The original prior fails that test because 401 is absent; the corrected prior passes. This is local wiring proof, not a production-camera observation.

| Case | What reaches this reader |
|---|---|
| Attached saved deck | Own Main + Extra + Side + optional Deck Master, mapped to available index IDs. |
| No attached deck, or deck removed | Empty explicit list; ordinary catalog/seen/context fallback. Merely owning a saved deck does not attach it. |
| Guest without a signed-in Remote Duels seat | No owner room/reader capability; `requireRemoteActor` rejects that access. A seated player with no registration uses the empty-list case. |
| Side or Extra Deck card | Already in the union, even before siding; section swaps do not remove its membership. |
| Token | Usually absent from the registered list. Generic twins carry token stats, not a guessed catalog identity. The physical index intentionally allows catalog Field Tokens (`physical-index.ts:16`); those can use catalog fallback. |
| Opponent's card on my field | My list is still my list. Public opposing cards add seen/context at `recognition-priors.ts:39`; a clear off-list catalog result remains possible. Opposing hidden hands, Sets, Deck and Extra contents supply no private list. |
| Missing metadata/index entry | An unmapped ID is omitted. An unavailable reader returns no resources; a list cannot create an artwork row. |

## Experimental “place as unsure”

`REMOTE_UNSURE_NAMES_USERS` is a **web server runtime** list of comma-separated database `users.id` values. Empty/unset is OFF for everyone. `*` grants nobody. IDs must match exactly; `0101` and `101x` do not grant 101. Remote Duels access and a seated, non-spectator viewer are also required. For example, `REMOTE_UNSURE_NAMES_USERS=101,102` enables those two owners only. Reload/restart the table camera after changing the server environment. No public build variable is used.

`docker-compose.yml:167` forwards `${REMOTE_UNSURE_NAMES_USERS:-}` with an empty default. `lib/remote-duels.ts:32` reads the list; the room gets only a boolean capability. Private socket snapshots preserve that boolean. The HTTP action endpoint also rejects tentative annotations from unlisted clients. Existing marked cards can still be confirmed/corrected after the switch is disabled.

For a new unbound front which passes the other admission gates, an otherwise unusable name can be placed with a small **Unsure** mark if its unboosted visual top score is at least .60 and leads the distinct runner-up by **.115**. The visual winner must also be the reader's final winner. Backs, missing runners, partial/covered/fallback reads, occupied/held/stack restrictions and the existing rest/plane checks retain their holds/questions. This is not a new Set-admission path.

The twin stores two or three public candidates with IDs, names and scores. Both seats see the same mark. The owner's existing zone-actions popup offers candidate buttons; one tap chooses a name. There are no new colors or layouts. A sure background result removes the mark and confirms or corrects the same ref. A correction is one `card.identified` action and one Undo entry; no remove/place pair or automatic row relocation is introduced by settling the name. Setting the card clears the old front candidates. Player choices keep their existing holds.

## Margin evidence

Calibration uses **104 unsure reads** from the pooled main and Part 1 traces, including repeat reads of the same physical card. The final ledger also includes all 54 unsure reads from the experimental run.

| Margin | Would-place read decisions | Right | Wrong | Unknown |
|---|---:|---:|---:|---:|
| 0.050 | 39 | 24 | 11 | 4 |
| 0.100 | 22 | 18 | 4 | 0 |
| 0.110 | 20 | 18 | 2 | 0 |
| 0.115 | 16 | 16 | 0 | 0 |
| 0.120 | 8 | 8 | 0 | 0 |
| 0.150 | 6 | 6 | 0 | 0 |
| 0.200 | 2 | 2 | 0 | 0 |

`unsure-reads.json` contains every non-sure read plus sure sideways reads below .77: top and runner-up scores/IDs, unboosted margin, the reader's ranked winner, track state, matching label and right/wrong/unknown verdict. Missing label identity stays unknown; directly inspected exceptions carry a review note. The table is a threshold sweep over weak, clean read candidates with score >= .60 and matching raw/final winners. It is **not** a count of physical admissions: rest, occupancy, origin and hand gates still decide those. The full replay below checks actual admissions.

The reviewed Dragon Master Lords guess for Epurrely Plump leads by about .111, so .10 and .11 are unsafe. The .115 choice is above that observed wrong read and retains reviewed correct .117–.119 leads that a .12 cutoff would withhold. This is a fitted operating point on these clips, not a probability or proof for unseen cameras.

## Full replay results — ran

| Set / build | On time | Late | Missed | Wrong zone | Placements | Questions | Reads | Wrong names | Phantoms | Hand/search/Extra preview | Stale sources |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| v2 / main | 27 | 6 | 26 | 3 | 39 | 4 | 100 | 0 | 0 | 0 | 0 |
| v3 / main | 3 | 4 | 20 | 1 | 17 | 5 | 56 | 0 | 0 | 3 | 0 |
| v2 / Part 1 | 27 | 6 | 26 | 3 | 39 | 4 | 101 | 0 | 0 | 0 | 0 |
| v3 / Part 1 | 3 | 4 | 20 | 1 | 17 | 5 | 59 | 0 | 0 | 3 | 0 |
| v2 / Parts 1 + 3 | 27 | 6 | 26 | 3 | 39 | 4 | 101 | 0 | 0 | 0 | 0 |
| v3 / Parts 1 + 3 | 4 | 4 | 19 | 1 | 18 | 4 | 59 | 0 | 0 | 3 | 0 |


The supplied **score-v4** scorer supplies on-time, late, missed and source-clearance values. The headline excludes auxiliary/context rows; v2 has 62 scored headline rows and v3 has 28. Wrong-zone/other outcomes therefore also matter when summing the headline. Named pile updates are not new arrivals. Placement counts are watcher callbacks, including updates to an existing ref, rather than a physical-card count.

All **56 main** placement callbacks were inspected in frame/crop sheets. Part 1 has 56 callbacks: 52 exact transfers and four directly inspected re-timings of real Yubel-family cards/pile tops. Parts 1+3 have 57 callbacks: the same four re-timings, the new Purrely, and 52 exact transfers. Transfers require the same identity, zone, face, pose, event/capture time and quad; polygon IoU is at least .7. Every new or re-timed frame was viewed. The new sideways **Purrely at 70.318 s** in `retro-purrely` is distinct from the existing Purrelyly; it matches the 69 s rest label and remains a real field card. Its visual top/runner are **.786230/.583393**, margin **.202838**. Its adjusted reader score is **.751230**, below the .77 sideways guard; the candidate margin uses the unboosted visual scores. It is the only marked admission. It does not get a later sure upgrade within the retained clip.

The three existing v3 preview episodes remain: the opening Chundra hand display, Happy Memory search fan and initial Dracossack Extra preview. The opening Unicorn is still ambiguous; two white physical token markers are still treated as Sets. These are not excused as correct game actions. No new persistent duplicate was found. Source clearance is established for eight v2 sources and one v3 source; all nine clear, with zero stale sources. The other departure labels do not establish their source on the board.

Placement latency median/p95 (seconds) is **.920/10.904 → 1.008/10.904 → 1.008/10.904** on v2 and **4.854/8.074 → 4.854/8.074 → 3.157/8.074** on v3. The last median includes the additional success; it is not a paired speedup.

All successful comparisons use the same frozen 10 v2 / 5 v3 inputs and labels, actual local ONNX inference, a single inference thread per lane, and fixed virtual detector/reader costs of 170/228 ms. The existing multi-frame retry pays for all frame reads and redetection. Deck lists were **not supplied to these clip replays**: there are no real registered player lists for the supplied footage. The deck wiring test above is separate. Browser queues, HTTP persistence, summons and departures are modeled by the supplied offline board sink; the real reducer/UI tests cover serialization, correction and Undo. No recording code was modified.

## Verification and limits

Node **22.23.4**. Final commands/results:

- `npx tsx --test packages/vision/src/*.test.ts`: **356/357 pass**. Only unchanged `mat-fit.test.ts:78` fails its CPU budget (**1952.911 ms > 1500 ms**).
- The 18 requested/touched web and watcher files with `-c packages/web/vitest.config.ts --maxWorkers=1`: **362/363 pass**. The one failure is the existing missing `double-metaphone` import in `remote-recognition.test.ts`.
- The owner-camera integration file separately passes **126/126**. New retry/candidate tests pass **15/15**, including the final corrected-embedding regression.
- `npm run typecheck --workspace=packages/vision`, the shared build and `git diff --check`: pass. The extra web typecheck reports only the same missing voice dependency. No package download was attempted.

The native bundles precede a final fix of two private metadata assignments in the already-identified name-correction branch: a corrected name must learn its **fresh sure embedding**, not the old weak crop. That regression fails before the fix and passes after it. `final-audit.json` proves the final source differs from the frozen replay source only by those two assignments, and finds no prior non-sure named field placement followed by a sure placed callback on the same ref in either trial. That callback is necessary for the changed branch to execute. Thus these observed replay executions are equivalent; **the new correction branch itself is proved by controlled tests, not native footage**. No extra final-source native replay is claimed.

Fail-before receipts cover the stopped background-read behavior and the omitted Deck Master. New tests cover backoff/duty, sure recovery, fusion, still/hand/missing gates, manual answers during a read, old server snapshots during save, the closed runtime list/API gate, same-ref tentative correction, candidate taps, both-seat rendering, face-down cleanup and Undo. Existing state-transition tests use explicit comparison switches where their contract requires immediate reads or no background retry; default-on behavior has its own behavioral tests.

These are agent-labeled local clips, not human-reviewed ground truth or owner-camera/device tests. The existing v3 search/hand/Extra-preview failures and ambiguous opening Unicorn remain visible in the receipts. Zero wrong names/phantoms here does not establish safety on unseen glare, sleeves, decks or phones. Small score changes are below the scorer README's provisional six-net-success noise floor; no general recall or speed improvement is claimed.

Local evidence and source snapshots are under gitignored `data/replay/unsure-20261115/`. Completed comparisons run serially. During cache recovery, two failed v3 attempts briefly overlapped accidentally; both were stopped and excluded. A gallery-suppression prototype was also stopped after the known-return regression and is excluded. Retained-cache incompatibilities are recomputed locally. New tensors are capped, and all new files/cache writes stay in this worktree. Final run-folder usage is **3.3 GiB (3.51 GB)** with approximately **38 GiB free**, below the 4 GB folder limit and above the 8 GB free-space stop. The evaluation/hybrid worktrees are read-only inputs.

## Tracked files

- `.env.example`
- `docker-compose.yml`
- `docs/remote-duels/unsure-names.md`
- `packages/shared/src/remote/actions.ts`
- `packages/shared/src/remote/games/ygo.ts`
- `packages/shared/src/remote/live-deck-checks.ts`
- `packages/shared/src/remote/privacy.ts`
- `packages/shared/src/remote/types.ts`
- `packages/shared/src/remote/undo.ts`
- `packages/vision/src/board.test.ts`
- `packages/vision/src/field-name-retry.test.ts`
- `packages/vision/src/field-watcher.ts`
- `packages/vision/src/unsure-names.test.ts`
- `packages/vision/src/unsure-names.ts`
- `packages/web/src/components/remote/field-watcher.tsx`
- `packages/web/src/components/remote/ui/holo-field.tsx`
- `packages/web/src/components/remote/ui/model.ts`
- `packages/web/src/components/remote/ui/use-remote-room.ts`
- `packages/web/src/components/remote/ui/zone-actions.tsx`
- `packages/web/src/components/remote/ui/zone-placement.ts`
- `packages/web/src/lib/remote-duels.ts`
- `packages/web/src/lib/remote/field-proposals.ts`
- `packages/web/src/lib/remote/recognition-priors.ts`
- `packages/web/tests/remote-deck-prior.test.ts`
- `packages/web/tests/remote-name-voting.test.ts`
- `packages/web/tests/remote-unsure-names.test.tsx`
- `packages/web/tests/remote-unsure-runtime.test.ts`
- `packages/web/tests/vision-lab.test.tsx`
