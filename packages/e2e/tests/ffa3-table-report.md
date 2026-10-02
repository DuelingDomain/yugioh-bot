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

## Surrender and spectator proof (2026-10-02)

This section supersedes the historical surrender timing question and open-chain
surrender gap elsewhere in this report. The decided rule is **owner rule 2026-10-02:
surrender at end of turn**: with no open chain, a surrendered multiplayer seat stays
Leaving until the current turn ends, then is eliminated with its seat order retained.
The engine does not yet implement that timing. No engine rules were edited.

The old surrender test was moved from `duel-3p-ffa-table.spec.ts` into
`duel-3p-ffa-surrender.spec.ts` and extended with human UI actions, spectator choices,
and read-only `readTableTrace` prompt-log evidence. All seats are human; synchronization
uses bounded polling of real prompts rather than sleeps.

### Exact engine difference

In both FFA3 and FFA4, the last seat surrenders while seat 0 holds its turn-1 Main
Phase 1 action prompt with no chain. The seat remains pending after surrender and
after the Normal Summon answer opens the `places` prompt. Answering zone placement
eliminates the seat at the next adjustment: the next prompt is still seat 0's action
prompt in **turn 1, Main Phase 1**. Elimination is neither immediate on surrender,
nor at the first answer, nor deferred to the end of the turn. The recorded prompt
sequence is `choice/action -> places -> choice/action`, all at turn 1/main1/seat 0.

Each format has a separate `current engine: ... no-chain surrender lands after summon
placement in the same Main Phase` control and an owner-rule test marked
`test.fail(true, "owner rule 2026-10-02: surrender at end of turn pending engine change")`.
All four expected failures occur at the intended `eliminated === false` assertion;
none is a UI timeout. They demonstrate the unresolved rule difference.

### Proven behavior and limits

| New-spec test group | Run 1 | Run 2 | Exact evidence |
| --- | ---: | ---: | --- |
| current engine: queued surrender reaches a turn boundary, then the eliminated player watches live turns and placings | 1 pass | 1 pass | Leaving during Bob's held prompt; Bob ends turn 2; Alice is eliminated on turn 3 with empty owned zones and retained seat 0. Ending the turn is the next adjustment in this path, so this alone does not prove the owner timing rule. |
| an eliminated player can leave the room while the other duelists keep playing | 1 pass | 1 pass | Leave room navigates to `/duels`; remaining duel continues to turn 4 with original seat IDs. |
| current engine: FFA3/FFA4 no-chain summon-placement controls | 2 passes | 2 passes | Same-turn elimination described above, engine snapshots and full prompt logs. |
| FFA3/FFA4 owner rule: Leaving through a summon until end of turn | 2 expected failures | 2 expected failures | Engine eliminates before end of turn. |
| FFA3/FFA4 surrender during your own turn passes to the next live seat in order | 2 passes | 2 passes | Next action prompt is turn 2/seat 1 in FFA3; seat 2 in FFA4 after seat 1 was eliminated. Eliminated seat cannot act. |
| FFA3/FFA4 R-FFA-ELIMINATION: surrender during an open chain | 2 passes | 2 passes | Bob's chain-response prompt stays unchanged; Alice is Leaving and her monster remains while the chain is open. Bob clicks No, so no negation confounds the test. Alice's Pot of Greed link produces no two-card draw; after the chain ends Alice is eliminated and her monster is removed in engine and UI. |

The FFA3 watch path proves a clear **Stay and watch / Leave room** choice after actual
elimination and after reload. Watching uses the existing public worker projection and
a signed null-seat connection token, with spectator role, no prompt, no own hand,
and no private deck/side data. Live prompt-log turns are `[1,0], [2,1], [3,2], [4,1]`;
the spectator sees turns 3 and 4 and the final standings `[2,1,0]`, including after
reload. Watching submits zero action POSTs. Room membership and original standings
remain intact. Only eliminated FFA3/FFA4 players may opt into this projection;
living and Leaving players are rejected. Ordinary 1v1 projection is unchanged.

### Verification and screenshots

The accepted run began at **2026-10-02 22:43:47.917 UTC**, lasted **285.404 seconds**,
and ran the new spec with `--repeat-each=2 --workers=1 --retries=0` inside the exclusive
E2E stack lock, after a production stack build. Result: **16 ordinary browser passes,
4 expected owner-rule failures, 0 skips, 0 unexpected, 0 flaky**. Four authentication
setup passes make the Playwright summary **24 passed**; every result has retry 0.
Targeted web tests passed **65/65**, host spectator unit tests **5/5**, and web,
duel-server and E2E typechecks passed. The existing full 1v1 suite was not rerun.

The snapshot WASM SHA-256 remains
`896d6528b16227e1702088c42da8570a6c394be9c0dd93ad4f2aac9951e5c22e`.
`E2E_MANUAL=1` derives a verified wrapper manifest under the isolated `.stack` because
the snapshot's wrapper manifest differs from the installed wrapper; snapshot bytes
are unchanged. The run uses `E2E_DUEL_DATA_DIR=$PWD/data/duel-engine-snap`, the local
card-image source, and `E2E_BOT_STEP_MS=250`. Optional `E2E_SURRENDER_SHOT_DIR` exports
only the second repetition's screenshots; ordinary runs need no external directory.

Three 1440×900 PNGs were exported to
`/home/sulman633/repos/yugioh-bot/.fx-demo/three-way/shots/`:

| File | SHA-256 |
| --- | --- |
| `live-ffa3-r3-surrender-leaving.png` | `8e0f54cd2dcb396e25adeae15609ffeebb36d8ff2f9afbb2aa7b037d5521e34d` |
| `live-ffa3-r3-surrender-choice.png` | `03b09a31163527ea2255b86f24da711e40753e48d459fde7175f96d443b034f4` |
| `live-ffa3-r3-surrender-spectator-result.png` | `9764874678d531738cab4ecadbc2b5d2b48f37ff17d32fcfcde7ee66400e4fc4` |

After export, cleanup ran under the exclusive stack lock with all four isolated
stack ports stopped. Generated `.next`, web coverage, `.stack`, built
`packages/{duel-server,shared,ws}/dist`, and this worker's Playwright results/traces
were removed. The snapshot and three exported PNGs remain. No live stack, engine
owner worktree, rule implementation, push, PR or main merge was touched.

Remaining: the engine owner must defer no-chain surrender through all remaining
actions until end of the current turn. The UI follows actual engine state and cannot
claim this timing is implemented. Broader elimination clauses and the legacy 1v1
Domain `startGame`/`firstTurnDraw` decision remain outside this surrender task.

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

## Rules: three-seat opponent and chain browser proof (2026-10-02)

This additive section uses the newest local ADR-0002, including the restored
controller-damage rule and retired opponent-field ID. The earlier report remains
historical evidence; notably Standard MR5 now skips the turn-1 draw.

### Inventory before this task

Every `R-FFA-*` and `R-COMMON-*` ID in the ADR is listed below. Partial means only
the specific clauses in the earlier browser coverage table, not the whole rule.

| Rule | Browser status before this task |
| --- | --- |
| R-COMMON-ALL-BOTH | Partial: Dark Hole clears all three fields. |
| R-COMMON-CONT-NEG | Untested in dedicated FFA3 browser gameplay. |
| R-COMMON-CTRL | Untested; restored owner rule, superseding the old report's obsolete-ID note. |
| R-COMMON-EACH-PLAYER | Untested. |
| R-COMMON-EMZ | Rendering only; Extra Deck placement untested. |
| R-COMMON-FL-LIST | Per-deck banlist rule untested in this browser proof. |
| R-COMMON-ONGOING | Untested. |
| R-COMMON-OPP-FIELD | Retired; all-opponent field behavior is current-engine evidence only. |
| R-COMMON-OPP-PICK | Partial: Mind Crush chooses one opponent's hand in FFA3/FFA4. |
| R-COMMON-SEAT-STATE | Untested. |
| R-COMMON-SEP-FIELDS | Partial: separate hands, field zones and Graveyards render and update. |
| R-FFA-ACROSS-EMZ | Pending engine change; real shared placement untested. |
| R-FFA-ACTIVATED-LOCK | Pending engine change; untested. |
| R-FFA-ATTACK | Partial: rival monster targets and confirmed direct attacks. |
| R-FFA-CHAIN | Partial: clockwise responses, turn-player priority, consecutive passes. |
| R-FFA-ELIMINATION | Partial: own-card cleanup, skipped seats and persistent placings; remaining clauses untested. |
| R-FFA-FIRST-DRAW | Standard MR5 first-draw browser test updated to hand 5/deck 35; other modes/MRs outside this proof. |
| R-FFA-LP | Partial: separate starting LP and battle damage. |
| R-FFA-NEGATE | Untested in a dedicated browser test. |
| R-FFA-NO-ATTACK | Expected ADR failure for turns 3/4, with separate current-engine controls. |
| R-FFA-OPP-ONE | FFA4 expected failure/current-engine pair; FFA3 absent. |
| R-FFA-OPP-RESPONSE | Monster-attack Mirror Force expected failure/current-engine pair; direct-attack eligibility absent. |
| R-FFA-ORDER | Partial: clockwise turns and eliminated-seat skipping. |
| R-FFA-RESOURCE-ROTATION | Pending engine change; untested. |
| R-FFA-RETURN-OWNED-CARDS | Pending engine change; untested. |
| R-FFA-TRIGGERS | Untested in a dedicated browser test. |
| R-FFA-WINNER | Partial: last living seat and persistent standings; simultaneous draw absent. |

Implementation sequence: add deterministic dev presets and an isolated browser
helper; assert supported rules through human UI actions and read-only prompt logs;
pair each pending assertion with a current-engine control; run the new spec twice,
without retries, under the exclusive stack lock; record evidence and clean artifacts.

### Added rule evidence

Only `duel-3p-ffa-rules.spec.ts`, its new helper, additive presets and preset
registrations belong to this task. Human-seat decisions use browser controls;
room and per-seat debug views are read-only evidence. Every room verifies the
snapshot's real `ocgcore.multi.wasm` hash. No engine rules, core or Lua overlays
are changed. The single FFA4 pair below is necessary to exercise the across-seat
rule; the other thirteen tests use exactly three seats.

| Rule | Engine and browser assertions | Status |
| --- | --- | --- |
| R-FFA-OPP-ONE | Raigeki's desired opponent-pick prompt is polled with the default timeout after `test.fail`; the intended follow-up chooses seat 2 and preserves seat 1. The separate current-engine control proves monster counts [1,0,0], exact per-seat GY identities/counts, LP and visible card identity. | Pending declaration; current-engine control only. |
| R-COMMON-OPP-FIELD | The same Raigeki control labels the retired all-opponent-field behavior explicitly. | Retired ID, not active ADR proof. |
| R-FFA-OPP-RESPONSE | A confirms a direct attack on B while both B and C hold Battle Fader and are scripted to activate it if offered. Every recorded Fader offer belongs to B; C keeps its Fader. The browser shows B's chain link and priority chips, then B summons Fader and stops the attack. All LP remain 8,000; GY and hand counts agree. | Direct-attack eligibility proven; the earlier Mirror Force effect-scope gap remains pending. |
| R-COMMON-OPP-PICK | Hinotama offers both rival chips, excludes self, and damages only the chosen seat 2: engine and `[data-lp-value]` show [8000,8000,7500]. Only the spent spell enters GY. | LP clause proven, complementing the earlier Mind Crush hand proof. |
| R-FFA-TRIGGERS | All three monsters leave together. On seat 0's turn, links form [0,1,2] and resolve [2,1,0]; on seat 1's turn, they form [1,2,0] and resolve [0,2,1]. Real chain events, prompt logs, visible three-link chains, choosing chips, human search selection, LP and GY counts agree. | Two turn origins proven. |
| R-FFA-NEGATE | Seat 2's Solemn Judgment negates seat 0's Raigeki. A human counter-trap window holds links [0,2] for chip/chain inspection; the human declines. Engine records link 1 negated; both rival monsters survive in engine and UI, seat 2 pays to 4,000 LP, and Raigeki/Solemn enter their own GYs. | Third-seat spell activation negation proven. |
| R-FFA-ACTIVATED-LOCK | Dweller's detach cost is proven before the expected failure at the missing declaration prompt. The current control resolves Dweller, destroys it and both rival trigger monsters with Dark Hole, and proves neither rival GY trigger activates; GY counts are [3,1,1], LP/fields agree. Desired follow-up permits the undeclared seat's trigger. | One-opponent lock pending; current all-opponent lock proven. |
| R-FFA-RESOURCE-ROTATION | The human answers real selection/placement prompts before annotation. Intended monster order is [Silver Fang, Mystical Elf, Battle Ox]. Current engine gives [Battle Ox, Mystical Elf, Silver Fang]; per-card controller, browser art identity, LP and GY counts agree. | Three-seat rotation pending; current pair swap proven. |
| R-COMMON-EMZ | Both rival left EMZ start occupied. The human really Link Summons Spider using Elf into its own left or right EMZ, then Imduk using Battle Ox into its own arrow-linked main zone 1 or 3. Both rivals' Spiders remain; the second own EMZ stays empty. Summon events, zones, art identity, Extra Deck count, LP and GY counts agree. | Real independence and local-arrow placement proven for both own EMZ. |
| R-FFA-ACROSS-EMZ | A real FFA4 Link summon reaches placement before annotation. The intended assertion excludes seat 0's left EMZ because seat 2's right EMZ is occupied. Current engine offers both own EMZ and permits the left placement; engine/UI identity, LP and GY counts agree. | Across-seat blocking pending; current independent placement proven. |

Expected failures establish an unresolved rule difference, not accepted ADR
behavior. Their intended UI follow-ups are not reached while the engine assertion
fails. Setup failures remain unexpected: detach cost and summon-placement state
are validated before annotation. No pending case shortens the default assertion
timeout. Synchronization uses prompt-log transitions, `expect.poll` and bounded
UI-response loops, with no fixed sleeps.

The direct-attack proof restricts **Battle Fader eligibility**, not every generic
quick-effect window: the attacker can still use MST and all duelists retain their
normal chain priority. The engine records B's trigger offer and activation choice
separately; the assertion checks the set of offered seats rather than assuming one
log entry.

Remaining clauses outside this new proof: opponent Deck/Extra Deck/draw effects;
the earlier Mirror Force effect scope; other trigger classes and negation types;
resource rotation with full fields or eliminated seats; FFA4 shared columns and
across-seat Link arrows; Extra Link permitting a second own EMZ; Domain/Tag and
the full 1v1 regression. Untested rules in the inventory above are not promoted
to proven by these additions.

### Accepted runs for the new rules spec

Both full runs used one Chromium worker, reduced motion at 1440×900, the same
snapshot and the exact exclusive lock specified by the task. Each supervised
stack stopped before releasing the lock. Both used `--retries=0`. Earlier focused
diagnostic runs are excluded. The spec and presets were unchanged between the
two accepted runs.

| Run | UTC start | Duration | Ordinary passes | Expected failures | Skips | Unexpected/flaky |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 1 | 2026-10-02T22:40:57.095Z | 133.678 s | 11 | 4 | 0 | 0 / 0 |
| 2 | 2026-10-02T22:54:03.953Z | 203.173 s | 11 | 4 | 0 | 0 / 0 |

The spec totals **22 ordinary passes and 8 expected failures**. Eight separate
authentication setup passes give the two Playwright summaries **19 passed** each
(38 accepted outcomes overall, including expected failures). Every result has
retry 0. Expected failures are not counted as ordinary ADR passes.

| Exact test name in `duel-3p-ffa-rules.spec.ts` | Run 1 | Run 2 |
| --- | --- | --- |
| current engine: R-COMMON-OPP-FIELD retired, three-seat Raigeki clears both opponent fields | Pass | Pass |
| R-FFA-OPP-ONE: three seats declare one opponent before Raigeki clears only that field | Expected failure | Expected failure |
| R-COMMON-OPP-PICK: Hinotama declares one rival and changes only that rival's LP | Pass | Pass |
| R-FFA-OPP-RESPONSE: A attacks B directly, only B receives Battle Fader, C does not | Pass | Pass |
| R-FFA-TRIGGERS: all three simultaneous triggers form [0,1,2] and resolve [2,1,0] | Pass | Pass |
| R-FFA-NEGATE: third duelist's Solemn negates A's Raigeki, pays LP, and preserves B's field | Pass | Pass |
| R-FFA-TRIGGERS: seat 1's turn forms [1,2,0] and resolves [0,2,1] | Pass | Pass |
| current engine: Abyss Dweller locks both rivals' Graveyard triggers without an opponent declaration | Pass | Pass |
| R-FFA-ACTIVATED-LOCK: Abyss Dweller declares one rival and leaves the other GY trigger available | Expected failure | Expected failure |
| current engine: Creature Swap exchanges a pair and leaves the third monster alone | Pass | Pass |
| R-FFA-RESOURCE-ROTATION: Creature Swap rotates monsters 0 to 1 to 2 to 0 | Expected failure | Expected failure |
| R-COMMON-EMZ: real Link summons into own EMZ 5 ignore rival EMZ and use only the local arrow | Pass | Pass |
| R-COMMON-EMZ: real Link summons into own EMZ 6 ignore rival EMZ and use only the local arrow | Pass | Pass |
| current engine: FFA4 across EMZ remain independent during a real Link summon | Pass | Pass |
| R-FFA-ACROSS-EMZ: FFA4 across seat 2 blocks seat 0's matching EMZ during a real Link summon | Expected failure | Expected failure |

Expected failures occur at these engine assertions: Raigeki and Dweller return
no opponent declaration; Creature Swap gives the pair-swap identities rather
than the three-seat rotation; FFA4 offers both EMZ rather than excluding the
blocked matching zone. None is accepted because of a UI timeout.

Additional checks: E2E and duel-server typechecks passed; all 37 then-registered
preset boards compiled in the focused unit run (39 unselected tests skipped);
all ten new presets passed registration, uniqueness, bot-seat and checklist
validation. Shared and production web builds plus diagnostic duel-server
rebuilds passed. The WebSocket service reused its existing compiled output.
The web build emitted its existing dynamic file-tracing warnings. Read-only
code review found no important issues after the prompt-transition corrections.

The package-wide registry check is not green: one pass and one failure at
`ffa3-elimination-ongoing-loss`, a concurrent preset with a two-item checklist
where the check requires more than two. It stops before the registry
assertion that enumerates a fixed older preset list. This task does not edit
that worker's preset or the existing unit-test file. This is separate from the
ten successful validations of this task's new presets.

The retained snapshot WASM SHA-256 is
`896d6528b16227e1702088c42da8570a6c394be9c0dd93ad4f2aac9951e5c22e`.
The WASM and the inspected Battle Fader/utility overlay hashes remained unchanged
after both runs. No live stack, engine-owned worktree, engine rule logic, core or
Lua overlay was changed by this task. No push, PR or main merge was performed.


## Elimination, Domain and 1v1 regression proof (2026-10-02)

This section updates the earlier elimination and Domain gaps without changing the
historical evidence above. The new spec is `duel-3p-ffa-elimination.spec.ts`, with
an isolated browser helper and twelve additive real-card presets. Human seat 0
acts through UI controls; bot scripts only act for seats 1 and 2. Read-only room
views and `readTableTrace().promptLog`, bounded response loops and `expect.poll`
supply synchronization. No fixed sleeps, engine rule changes, core changes, Lua
changes or changes to other browser specs were made by this task.

### Proven elimination clauses and pending differences

| Rule or clause | New evidence | Status |
| --- | --- | --- |
| R-FFA-ELIMINATION: cards owned by the loser but controlled elsewhere leave the game | Change of Heart transfers Gemini Elf to the human; Hinotama eliminates its owner. The Elf leaves the human field, is absent from both living seats' hands/GYs/banishment, and neither living Deck gains a card. Exchange separately proves the loser's Celtic Guardian leaves a living hand. Out chips/fields and reload agree. | Proven for a transferred monster and exchanged hand card. |
| R-FFA-RETURN-OWNED-CARDS: monster returns with its position | A bot takes the human's defense-position Elf with Change of Heart and is eliminated by Just Desserts before End Phase. Desired assertion requires the Elf in its living owner's monster zone with controller 0 and position 4. Current engine sends it to that owner's Graveyard. | Expected failure plus passing current-engine control. |
| R-FFA-RETURN-OWNED-CARDS: hand returns to its owner | Exchange puts the human's Axe Raider in the bot's hand. Eliminating the bot should restore Axe Raider to the human hand. Current engine sends it to the human Graveyard; the loser's Celtic Guardian correctly leaves the human hand. | Expected failure plus passing current-engine control. |
| R-FFA-ELIMINATION: ongoing effects stop immediately | Losing the Swords owner removes its attack restriction; the human Elf attacks seat 2 for 1,900 damage in the same turn. A living-owner control still has Swords and offers no attack. | Proven with a positive and negative control. |
| R-FFA-ELIMINATION: must draw from an empty Deck | Pot of Greed empties seat 1's Deck on turn 2; its zero-Deck action prompt proves it stays live. The required draw on turn 5 eliminates only seat 1, with all LP still 8,000 and no duel result. Action origins continue through seats 2 and 0; the UI agrees. | Proven; empty Deck alone does not lose. |
| R-FFA-ELIMINATION: cut-short own turn counts as ended | Seat 2 uses self-lethal Destruction Ring on its own turn 3. The next live seat 0 starts turn 4. Nightmare's Steelcage expires after that second opponent turn without reaching a normal End Phase. Prompt log, card locations, out chip, active ring arc and LP agree. | Proven for the Steelcage turn counter. |
| R-FFA-ELIMINATION: already-open links have no effect after loss | Lethal Just Desserts resolves above the losing seat's Heavy Storm; seat 2's Burden survives. The living-seat control destroys it. A surrendered seat's Dust Tornado also leaves the human's Burden intact; the matching living Dust control destroys it. | Proven for lethal damage during resolution and surrender during chain construction. |
| R-FFA-ELIMINATION: flagged cards and ongoing effects remain until the chain ends | After seat 1 surrenders with Dust Tornado open, seat 2 adds Jar of Greed while loss is pending. With all three links still open, current engine has already eliminated seat 1, removed its cards and raised the human Elf from 1,500 to 1,900 ATK by removing Burden. Desired assertion requires pending=true, eliminated=false, the rival Elf present and human ATK 1,500 until chain end. | Expected failure plus passing current-engine control; the trigger is adding another link after surrender. |
| R-FFA-WINNER: simultaneous last-two loss is a draw | Hinotama eliminates seat 2; Destruction Ring then takes both remaining seats from 1,000 to 0 in one resolution. Engine elimination groups are [[2],[0,1]], every seat is out, engine and room winnerSeat plus room winnerPlayerId are null, and result UI says DRAW before and after reload. | Proven and persisted. |
| R-FFA-LP and R-FFA-ORDER | Exact per-seat LP nodes show independent burn/battle damage and unchanged LP on deck-out. Complete first-action logs show clockwise origins, skipping the eliminated seat; painted turn ring, who-pill and active arc agree. Seats keep their original numbers. | Sanity coverage proven alongside the elimination cases. |

All three pending tests use `test.fail(true, "<ADR id> pending engine change...")`
and assert the desired engine state. Setup, human clicks and common UI checks
run before that annotation; each fails at its specific engine-state equality,
not a timeout. The separate `current engine: ...` test proves the observed
behavior. Expected failures do not establish that the desired rule works.

### Two accepted elimination repetitions

One focused locked session ran `--repeat-each=2 --retries=0` with one Chromium
worker and reduced motion at 1440x900. UTC start was
2026-10-02T22:58:35.067Z; Playwright duration was 269.825 seconds. Every test
result has retry 0. Both repetitions ran identical spec, board and bot code;
earlier diagnostic runs are excluded.

Each repetition has **13 ordinary passes and 3 expected engine failures**:
**26 ordinary passes, 6 expected failures, no skips, no unexpected failures and
no flaky results** in total. Four authentication setup passes ran once for the
session. Playwright's aggregate **36 passed** includes those authentication
passes and the six expected failures.

| Exact test name in `duel-3p-ffa-elimination.spec.ts` | Repetition 1 | Repetition 2 |
| --- | --- | --- |
| R-FFA-ELIMINATION: the eliminated owner's monster leaves another duelist's field; LP and clockwise UI stay independent | Pass | Pass |
| current engine: a survivor's stolen monster goes to its owner's Graveyard when the controller is eliminated | Pass | Pass |
| R-FFA-RETURN-OWNED-CARDS: a survivor's stolen monster returns to its monster zone with its position kept | Expected failure | Expected failure |
| current engine: the loser's exchanged card leaves a living hand, but the survivor's card goes to its Graveyard | Pass | Pass |
| R-FFA-RETURN-OWNED-CARDS: an exchanged card returns to its living owner's hand while the loser's card leaves | Expected failure | Expected failure |
| R-FFA-ELIMINATION: continuous Swords stops immediately and an attack works in the same turn | Pass | Pass |
| R-FFA-ELIMINATION control: a living duelist's continuous Swords still prevents an attack | Pass | Pass |
| R-FFA-ELIMINATION: an empty Deck stays live until a required draw eliminates only that seat | Pass | Pass |
| R-FFA-ELIMINATION: a turn cut short by its duelist's loss starts the next live seat and expires Steelcage | Pass | Pass |
| R-FFA-ELIMINATION: a duelist eliminated mid-chain has its already-open Heavy Storm link resolve without effect | Pass | Pass |
| R-FFA-ELIMINATION control: a living duelist's open Heavy Storm link resolves | Pass | Pass |
| R-FFA-ELIMINATION control: a living Dust Tornado destroys its target in the same chain setup | Pass | Pass |
| current engine: another chain link eliminates the surrendered seat early, and its Dust Tornado has no effect | Pass | Pass |
| R-FFA-ELIMINATION: a flagged duelist keeps its cards and continuous effects until the open chain ends | Expected failure | Expected failure |
| R-FFA-WINNER: the last two duelists reach zero LP together and the persisted result screen says DRAW with no winner | Pass | Pass |
| Domain FFA3: a legal singleton deck starts on the Domain core with three Deck Masters; the human summons and reloads | Pass | Pass |

### Domain FFA3 can run on this snapshot

Both Domain repetitions passed. The browser creates a Domain FFA3 table,
uploads a legal singleton 60-card deck built from the read-only catalog, readies
it with validation enabled, adds two practice bots and starts the duel. Engine
and UI show three Axe Raider Deck Masters in their own master zones. The human
summons Axe Raider through its normal-summon button and a legal zone prompt;
its field placement and master state persist after reload. The smoke has no
dependency on a manually seeded saved deck.

Every Standard preset room verifies `ocgcore.multi.wasm`, SHA-256
`896d6528b16227e1702088c42da8570a6c394be9c0dd93ad4f2aac9951e5c22e`.
Domain verifies `ocgcore.multi-domain.wasm`, SHA-256
`f1f8adaeaff21328970ffe894bf70cd86cc3afa18731a8aae4a397206824e2cb`.
Final hashes match the initial snapshot. `E2E_MANUAL=1` provides the verified,
derived wrapper manifest required for this snapshot; source manifests, WASM
and scripts remain unchanged. Every session uses the requested snapshot and
exclusive stack lock, with its supervised stack stopped before lock release.

### 1v1 regression run once at the implementation HEAD

The build/run began at `f7499136b0e21d2e4d51387c14e7fcbe96a729b0`
(`test: cover three-seat elimination and Domain play`). All eleven 1v1 duel
spec files listed below ran once with one worker and `--retries=0`, inside one
exclusive lock. UTC start was 2026-10-02T23:07:50.733Z; duration was 200.762
seconds. The result is **10 duel-test passes and 2 failures**, plus four auth
setup passes: Playwright reports **14 passed, 2 failed**, no skips or flaky
results. This task does not modify 1v1 source or specs.

| Spec | Exact test name | Result |
| --- | --- | --- |
| `card-chain-hand-trap.spec.ts` | a hand trap chained to a searcher negates it and both players see the chain | Pass |
| `card-face-down-privacy.spec.ts` | face-down cards stay hidden from the opponent and a spectator | Pass |
| `card-pendulum-summon.spec.ts` | a Pendulum Summon is shown as a Pendulum Summon on every screen | Pass |
| `card-trap-battle.spec.ts` | Mirror Force destroys the attackers and both screens show them in the graveyard | Pass |
| `duel-1v1-match.spec.ts` | two players join, duel, surrender, and find the match in history and replay | Pass |
| `duel-domain.spec.ts` | a Deck Master is summoned from its zone, destroyed, recalled, and summoned again for a Life Point cost | Fail |
| `duel-practice-bot-spectator.spec.ts` | host plays one action against the practice bot and a spectator sees no hand faces | Pass |
| `duel-prompts.spec.ts` | a number prompt and an order prompt can be answered and do not stick | Fail |
| `duel-prompts.spec.ts` | a card-name prompt for one duelist and a card pick for the other both work | Pass |
| `duel-reconnect.spec.ts` | both duelists can reload during a chain and keep playing | Pass |
| `duel-win-spectator.spec.ts` | a battle win shows win, lose and spectator screens | Pass |
| `live-tables-rules.spec.ts` | an open lobby shows only to its players and Close removes it | Pass |

The Domain lifecycle failure is at `duel-domain.spec.ts:64`, inside the existing
`endTurn` helper: Turn 4 was expected after End Turn, but the screen remained
on Turn 3 for the 15-second assertion timeout. The number/order failure is at
`duel-prompts.spec.ts:23`: the order group never displayed the expected
`0 of 3 selected` text within 15 seconds. These are observed failures; this run
does not establish their causes. No repair or rerun was made.

Concurrent worker commit `b26124d63fb36bae94a4619a065b0fdd6affdd24`
added separate multiplayer rule tests/presets during this session. The
1v1 build began at the HEAD recorded above, and no concurrent 1v1 source change
was observed. The later `c80f017c` commit only adds a third checklist item to
the two Swords presets; boards and bot scripts are identical to the accepted
browser proof.

### Additional checks, limits and cleanup

Fresh E2E and duel-server typechecks passed after rebuilding shared declarations
under the lock. All twelve new presets passed registration, unique-ID,
bot-seat, rule-ID, checklist and real-card board-compilation validation. The
existing focused preset suite had **39 passes, 1 failure and 38 unselected
skips**: all 38 registered boards compiled, and availability passed; the
registry's fixed older list at `tests/presets.test.ts:83` omits the new presets.
That existing test is outside this task's owned files and remains unchanged.
The earlier two-item Swords checklist failure described in the rules section
above is resolved by `c80f017c`. Production stack builds passed with the
existing dynamic file-tracing warnings.

Remaining engine work: same-kind monster/hand return and pending loss landing
only after the open chain ends. Broader return cases (spell/trap zones,
Graveyard/banishment, occupied-zone fallback), the token exception, surrender
after a link has already begun resolving, every other ended-turn counter,
Domain recall/elimination mechanics, Tag and FFA4 elimination are outside this
spec's proof. Domain coverage is a startup/summon/reload smoke, not a full match.
The two 1v1 failures and the obsolete package registry inventory need follow-up.

Generated web builds/coverage, shared stack state, this task's Playwright
traces/test-results and rebuilt shared/ws/duel-server dist directories were
removed under the exclusive lock. Compact result summaries, validation logs and
read-only JSON observations remain in the ignored `.status/ffa3-elimination-evidence/`
directory. The core snapshot is retained. No live stack, engine-owned worktree,
push, PR or main merge was used.
