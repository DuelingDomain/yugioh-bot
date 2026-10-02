# Multiplayer browser proof, review corrections (2026-10-02)

This report replaces the earlier u9 proof. It distinguishes ADR assertions, current-engine
behavior, and API-driven preset smoke runs. No engine rules, core files, Lua overlays,
or web files were edited by this worker. ADR-0002 was copied from the read-only engine
owner worktree. The local snapshot core matches its source (P68, SHA-256
`896d6528b16227e1702088c42da8570a6c394be9c0dd93ad4f2aac9951e5c22e`).

## Browser coverage

The names below are from `duel-3p-ffa-table.spec.ts` unless a format is specified.
A row proves only the clauses listed, not every clause in the rule.

| Rule | Proven assertions | Pending or absent browser coverage |
| --- | --- | --- |
| R-FFA-FIRST-DRAW | At the first turn-1 action prompt, seat 0 has hand 6/deck 34 in the prompt log and room; the UI hand/deck metadata agrees. | Other modes/Master Rules are outside this browser proof. |
| R-FFA-ORDER | Complete worker prompt log checks action prompts for turns 1–4 at seats 0,1,2,0; painted ring/who-pill observations agree. Elimination skips seat 1. | Simultaneous eliminations are not tested here. |
| R-FFA-LP | Three 8,000 panels; exact LP value nodes after direct damage (6,000) and monster battle (4,400); untouched seats have exact LP and no damage chip. Four-seat direct damage agrees on all four browsers and engine LP. | Other LP resource effects are absent. |
| R-FFA-ATTACK | Both rivals appear as monster targets. Direct attacks offer both living rivals, require explicit confirmation, and damage only the pick; with one rival left the engine attacks without a seat picker. Selection generates zero action POSTs and confirmation exactly one, rechecked after damage resolves. | Attack replay and other battle responses are not covered. |
| R-COMMON-ALL-BOTH | Dark Hole clears the human and both rivals in UI and engine, with the human monster in the Graveyard; a later summon supplies the direct attacker. | Other all-field effects are absent. |
| R-COMMON-OPP-PICK | FFA3 Mind Crush offers seats 1 and 2, discards only the selected seat's Sangan, opens its UI Graveyard showing Sangan, and leaves the other seat's Graveyard at zero and its Sangan in hand. FFA4 has a separate human-seat test. | Deck, Extra Deck, and draw effects are absent. |
| R-FFA-CHAIN | Rival links arrive clockwise; the turn player has priority after a rival link; the human MST response resolves. When the turn player adds the link, recorded responses are [1,2,0], the UI marks seat 0 last, and the chain remains open until its final No click. | Simultaneous trigger and negation rules have no dedicated browser proof. |
| R-FFA-ELIMINATION (partial) | LP loss empties the loser's own hand/monster/spell/Graveyard in engine; UI monster/spell zones and Graveyard are empty after reload; out chip, ring, skipped turns, and elimination order persist. | Already-open links, cards controlled by others, ongoing effects, deck-out, tokens, and cut-short-turn counters are absent. Queued surrender timing is current-engine evidence only. |
| R-FFA-WINNER (partial) | Human win and standings seat order [0,2,1] persist after reload. A complete API-driven human auto-pass simulation ends with the human's lose screen; result seat IDs and names match engine order. | Simultaneous 0-LP draw is absent. The complete simulation is not proof of a human playing through UI controls. |
| R-COMMON-EMZ (render only) | Exactly two separately addressed EMZ nodes per FFA3 seat render. | No Extra Deck summon proves placement independence or non-blocking behavior. FFA4 shared/across-seat EMZ is pending. |

## ADR expected failures and current-engine controls

Every pending ADR test asserts the intended engine behavior before its UI follow-up.
The separate current-engine test asserts today's actual result. Expected failures are
not counted as successful ADR behavior.

| ADR test | Intended assertion | Separate current-engine control |
| --- | --- | --- |
| R-FFA-NO-ATTACK: last duelist gets Battle Phase on turn 3 | FFA3 turn 3 offers `to_bp`; turns 1–2 do not. | current engine: mounts three own-EMZ fields, draws first, and has no BP on turns 1-3 |
| R-FFA-NO-ATTACK: last duelist gets Battle Phase on turn 4 | FFA4 turn 4 offers `to_bp`, followed by an enabled Battle button. | current engine: no BP on turns 1-4 |
| R-FFA-OPP-ONE: Raigeki asks for one opponent and clears only that field | Engine opponent-pick prompt, UI seat choice, and only seat 2's field cleared. | current engine: Raigeki hits all opponents (R-FFA-OPP-ONE pending) |
| R-FFA-OPP-RESPONSE: third duelist's Mirror Force affects only the attacker | C receives Mirror Force when A attacks B; only A's monsters leave, B's monster survives in engine and UI. | current engine: third duelist can use Mirror Force but it destroys both rivals' monsters |

Engine rules also remain pending for R-FFA-ACTIVATED-LOCK, R-FFA-RESOURCE-ROTATION,
R-FFA-ACROSS-EMZ, R-FFA-RETURN-OWNED-CARDS, and the elimination token exception.
They have no dedicated browser tests here. Browser gaps also include R-FFA-TRIGGERS,
R-FFA-NEGATE, R-COMMON-EACH-PLAYER, R-COMMON-ONGOING, R-COMMON-SEAT-STATE,
R-COMMON-CONT-NEG, direct-attack responses restricted to the attacked seat, and Domain/Tag gameplay.

**Owner question:** with no chain open, should a surrendered seat leave after the next
answered prompt, at the next adjustment/step, or at the end of the turn? The current
FFA3 and FFA4 tests record Leaving until a turn boundary; this report does not choose
an ADR rule for that delay.

## Opus re-check gaps and deferred decisions

The re-check fixes test reliability and table layout; it does not extend engine-rule
coverage. These gaps remain explicit:

- There is no FFA3 pending `R-FFA-OPP-ONE` test; the pending Raigeki assertion is FFA4 only.
- `R-FFA-OPP-RESPONSE` has no direct-attack case proving that only the attacked seat
  receives a response. The third-duelist Mirror Force case covers a monster attack.
- `R-COMMON-EMZ` checks rendered zones only; no Extra Deck summon proves independent placement.
- Elimination sub-rules are untested: flagged duelists' Chain Links resolving without
  effect, owned cards controlled by others leaving, ongoing effects ending, empty-Deck
  draw loss, cut-short turns counting as ended, token exceptions, and return of others'
  owned cards.
- `R-FFA-TRIGGERS` and `R-FFA-NEGATE` have no dedicated browser tests.
- Domain FFA3 and the full 1v1 regression are not rerun in this re-check.

Surrender timing, the obsolete `R-COMMON-CTRL` scenario tag, full-UI match proof, and
the "No attack until turn 4" chip remain with their product/engine owners. The chip
currently matches the engine; changing it to the ADR rule is outside this re-check.
The optional N6 cosmetic work is omitted.

## Scope of preset runs

`duel-presets-multi.spec.ts` uses API decisions and browser render/evidence checks.
Its pass is a preset smoke result. Individual checklist items marked `unchecked` or
`not-reached` are not proof. In particular the new direct/third-response preset runner
has no attack driver; the dedicated FFA3 UI tests, not that runner, prove the attacks.
Raigeki and surrender preset tests are explicitly named `current engine: ...`.
Four Tag tests are skipped per run. FFA3 shots use Chromium at 1440×900 with reduced
motion; the FFA4 start test also checks 1280×720. Other browsers/sizes and full-motion
animations are not covered. The ten ordinary FFA3 tests assert zero page/console errors
across their opened pages; expected failures are not counted as console-error proof.

## Verification

The accepted final batch ran on 2026-10-02 from 20:03:03 UTC for 761.154 seconds
(12.7 minutes), after a fresh production stack build, against the snapshot above.
One worker, `--repeat-each=2`, `--retries=0`; every result has retry 0. Earlier
diagnostic batches, including one deliberately interrupted after finding an FFA4
hand-discard setup issue, are excluded from these counts.

| Spec | Run 1 ordinary passes | Run 1 expected failures | Run 1 skips | Run 2 ordinary passes | Run 2 expected failures | Run 2 skips |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `duel-3p-ffa-table.spec.ts` | 10 | 2 | 0 | 10 | 2 | 0 |
| `duel-4p-ffa.spec.ts` | 6 | 2 | 0 | 6 | 2 | 0 |
| `duel-presets-multi.spec.ts` | 12 | 0 | 4 | 12 | 0 | 4 |

Across the requested specs: **56 ordinary passes, 8 expected failures, 8 skips**.
Four authentication setup passes give the Playwright summary **68 passed, 8 skipped,
0 unexpected, 0 flaky**. Expected failures are the four named ADR cases above,
each twice. They fail at actual engine assertions: missing Battle Phase on turns 3/4,
Raigeki returns an action prompt rather than an opponent pick, and Mirror Force leaves
monster counts [0,0,1] rather than the ADR's [0,1,1]. None fails at a UI timeout.

The added gap tests `Dark Hole clears every field including self, then a direct attack
damages only the picked rival after reload` and `the turn player responds last and the
chain resolves only after consecutive passes` pass twice. The third-duelist response
has a passing current-engine control and the expected ADR failure twice.

Additional verification: E2E helper unit tests **31/31**; E2E and duel-server typechecks
passed; shared, ws, duel-server, and production web builds passed. The web build emitted
existing dynamic file-tracing warnings. The local ADR still equals the owner's file,
and the snapshot WASM hash is unchanged.

Two checks are **not green** and need their respective owners:

- `packages/duel-server/tests/presets.test.ts`: **33 passed, 1 failed**. Its registry
  assertion at line 83 expects 9 multiplayer presets; the four authorized additive
  presets make 13. This test file is outside this worker's assigned paths and was not edited.
- `npx tsx packages/duel-server/scripts/rule-coverage.ts --strict --check`: exit 1,
  unknown rule ID `R-COMMON-CTRL`. The owner ADR removed it, but existing engine
  scenarios still declare it. The generated document is fresh and reports 37 rules,
  31 covered (including explicitly partial coverage) and 6 pending. Engine coverage
  labels are not browser proof; the browser matrix above is the exact scope of this run.

## Exported screenshots

Eight untouched PNGs from the second FFA3 repetition were copied byte-for-byte to
`/home/sulman633/repos/yugioh-bot/.fx-demo/three-way/shots/`, all 1440×900.
The eight older `live-ffa3-u9-*.png` files were deleted. Hashes verify the copies.

| File | SHA-256 |
| --- | --- |
| `live-ffa3-r2-20261002-first-round-complete.png` | `008cdb2d5e5c435816b3a2054aeff698a536ff10a7258a2a5fa1eceaaba66a88` |
| `live-ffa3-r2-20261002-direct-seat-choice.png` | `1bab144eeb1b544247170a911f182fd852182d35b1ade7ed4661cb7915ae11bb` |
| `live-ffa3-r2-20261002-direct-damage.png` | `83b138b832e856e625320bce61717ae83d328dcfd9ab4011149565c31cedd9b7` |
| `live-ffa3-r2-20261002-monster-targets.png` | `44d2bb65ed3e9e026cb96bca1ecceaeab6f43aec80ceadced8759dcdd935cd23` |
| `live-ffa3-r2-20261002-chain-clockwise.png` | `12e9b2343d2dca03553a656909c525133d5bcbe5bb56ece13b84d672ccd719bc` |
| `live-ffa3-r2-20261002-leaving.png` | `f28e9ea027077db9647bf22c1a166b62d5b9b3a0a375a754757171b176215cec` |
| `live-ffa3-r2-20261002-reload-after-elimination.png` | `b8b37ee0dec1336b9984f9cebb966b8c5ada8da792fc5e08dcd09950b33bef87` |
| `live-ffa3-r2-20261002-final-placings.png` | `2bdd6ef24038d18fb6f5c0f0820932c88a94965f06420d46fb7baf2bb2e49028` |

## Cleanup and remaining work

The supervised stack exited and 3300/3302/4302/4303 have no listeners. Generated
`packages/web/.next`, `packages/e2e/.stack`, Playwright results/reports/auth,
this worker's `.status/e2e-multi` run directories, and the built
`packages/{duel-server,shared,ws}/dist` were removed after export. The snapshot remains.
No live stack, engine-owned worktree, engine rules, Lua scripts, or core bytes were changed.
No push, PR, or main merge was performed. Concurrent web work is outside this report;
this worker's commits contain no web files. Full 1v1 regression was not rerun.

Pending engine rules and missing browser clauses remain listed above. In particular,
expected failures demonstrate an unresolved difference, not accepted ADR behavior.
Queued surrender timing remains an open owner question.

## Implementation commits

The following are this worker's commits, excluding concurrent web commits and the
closing documentation commit that records this report and regenerated coverage.

| Commit | Subject |
| --- | --- |
| `35e6159` | docs: refresh multiplayer rules from owner ADR |
| `87a6251` | test: record every multiplayer prompt for browser proof |
| `bf512f0` | test: separate pending battle rules and prove first draw |
| `b6f6d09` | test: correct direct attack and pending opponent effect proof |
| `b7af801` | test: prove Mind Crush opponent selection on three seats |
| `a6c3777` | test: prove elimination cleanup and standings by seat |
| `4e9d1df` | test: bound chain setup and prove turn player responds last |
| `4bbebe0` | test: label surrender timing and API simulation evidence |
| `71b24d4` | test: add pending third duelist response proof |
| `4f0ec48` | test: wait for live target prompts and first draw responses |
| `c2134e8` | test: fail pending rules on engine assertions before UI checks |
| `e177e56` | test: reject duplicate attack submissions after damage resolves |
| `4ebb31a` | test: handle first draw hand size in surrender proof |


Reproduce in this worktree after building shared and `npm run stack:build --workspace=packages/e2e`:

```sh
E2E_MANUAL=1 \
E2E_DUEL_DATA_DIR="$PWD/data/duel-engine-snap" \
E2E_CARD_IMAGE_SOURCE_DIR="$PWD/data/card-images" \
E2E_WORKERS=1 E2E_MULTI_MAX_SHOTS=8 E2E_BOT_STEP_MS=250 \
E2E_MULTI_RUN_ID=ffa3-r2-final-proof \
npm run e2e:nobuild --workspace=packages/e2e -- \
  duel-3p-ffa-table.spec.ts duel-4p-ffa.spec.ts duel-presets-multi.spec.ts \
  --repeat-each=2 --retries=0
```

Manual mode derives a verified wrapper manifest in the isolated stack directory; the
snapshot bytes stay unchanged. This command uses only 3300/3302/4302/4303.
