# Approved multi core integration

P68 is installed in `data/duel-engine-next`. It includes patches 0001 to 0068.
The build has no fixed Lua seed. The `.prev` files retain the original P61 cores.
The legacy `data/duel-engine` directory was not opened or changed.

The owner Tag rules are recorded in ADR-0002: `R-TAG-UNIQUE` permits one
unique-on-field copy per team. `R-TAG-ATTACK` permits a direct attack at an
empty member while the partner has a monster. Eight live Standard and Domain
cases prove that direct attack rule. The rejected `0006-tag-direct-attack.patch`
and its scenarios were not integrated. `local-link-column-zones.patch` remains
under review and was not integrated.

Patch 0068 corrects the query order in approved patch 0062. Stock two-seat
code skips the Synchro material effect condition for an own monster. P67
queried it before checking the controller. The new patch checks controllers
or teams first. Ten real-duel counter and full-summon cases fail on P67 and
pass on P68, including Standard and Domain two-seat controls.

## Installed files

| File | SHA-256 |
| --- | --- |
| `ocgcore.multi.wasm` | `896d6528b16227e1702088c42da8570a6c394be9c0dd93ad4f2aac9951e5c22e` |
| `ocgcore.multi-domain.wasm` | `f1f8adaeaff21328970ffe894bf70cd86cc3afa18731a8aae4a397206824e2cb` |
| `ocgcore.domain.wasm` (unchanged 1v1) | `16f60edf2c1e246886d1962fad32238fde0dd969c36bc959251df488c83aefc7` |

Installed at `2026-10-02T04:48:45Z`. Series SHA-256: `441ed76499bd6a57fb6136c5c786c00fd7a2bd27c2925c9293baaf457a6b3096`.
The stock Domain 1v1 core was also rebuilt in a private data directory. Its
SHA-256 matches the installed stock core. Every replacement was prepared and
synced before an atomic rename. Both `.SOURCE` files contain the new tag and
SHA-256. The test helper and CLI examples now use P68.

## Verification

The P68 native library builds with ASan, UBSan and the index traps. It has no
compiler warnings. The gate passes the wasm build, native smoke check, Domain
pre/patch/post anchors, six fixed seeds and 100 random seeds. Each replay
checks parsed messages, raw message bytes and field state. There are zero
differences. `nduel --check` checks 20 golden rows, with zero skips and zero
mismatches.

The committed native checks pass 56 Standard checks, with six skipped or
pending rows, and three Domain checks. An uncommitted change by another agent
to `scripts/native/checks/elimination.cpp` expects a stolen monster to return
to its owner's field. The numbered core sends it to the owner's Graveyard.
That shared-tree check fails on P67 and P68. The committed check was run from
a private copy without changing the other agent's file.

The focused integration suite passes 158 tests on each installed core. It covers
the six approved fixes, the stock condition order correction, the direct attack
rule and the existing Heritage and Kaiho draw proofs. The prompt adapter suite
passes 194 Standard tests and 240 Domain tests (the latter also includes the
Graveyard and Heritage tests).

At the start, the full multiplayer suite collects every scenario test, root multiplayer and
N-seat test, the N-seat invariant tests and the forbidden host-rule tests. It
also includes tests that other agents have not committed. Both runs use the
installed P68 cores and the same complete committed overlay at `ef3302d`
(415 scripts). This avoids loading a half-written overlay manifest. Tests and
engine code remain the live shared files, and can change during a run.

| Core | Files | Passed | Failed | Skipped | Todo | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Standard multi | 179 | 4097 | 253 | 1 | 45 | 4396 |
| Domain multi | 179 | 3900 | 319 | 1 | 45 | 4265 |

The full suites are not green. Failures include pending Domain elimination,
the excluded Tag Link/column patch, new owner rules under implementation and
new overlay tests whose scripts are not in the committed overlay snapshot.
The shared first-FFA-draw engine change also breaks old hand-count tests.
All integration scenarios pass in the earlier focused runs. During the full
Domain run, another agent adds future opponent-rule prompts to the Graveyard
and Heritage files, and changes the first-draw helper. These changes cause
eight Graveyard and six Heritage failures. The committed files are checked
again in a private copy below. A read-only review found no
additional correction to the approved patches in the failed cases. The full
run cannot isolate a new core regression because the engine and test files
changed during the run. A later release gate must also fix those inputs.

`npm run typecheck` reports 53 errors in 24 other-agent files and scratch files.
None is in an integration file. The requested live coverage command is
blocked by the untracked `df-first-battle-phase.ts`: it exports the same IDs
in `DF_FIRST_BATTLE_FFA_SCENARIOS` and `DF_FIRST_BATTLE_PHASE_SCENARIOS`.
Those files were not changed or deleted by this task.

A stable copy of the committed engine, tests and overlay at `ef3302d` is
also used for both full multiplayer suites. This copy excludes untracked
tests and keeps the committed engine rules.

| Stable core run | Files | Passed | Failed | Skipped | Todo | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Standard multi | 164 | 3964 | 27 | 2 | 45 | 4038 |
| Domain multi | 164 | 3964 | 27 | 2 | 45 | 4038 |

All integration proofs and prompt adapters pass in the stable Standard run.
The remaining failures are listed after the shared-tree failure table.


The committed coverage snapshot reports 37 rules: 30 have an outcome test and
seven are pending. The core-path helper also passes 13 tests. `R-TAG-UNIQUE` and `R-TAG-ATTACK` are covered. It generates
the coverage document and its `--check` exits zero. Existing warnings include
unknown `R-COMMON-CTRL`, weak refusal scenarios and scenario lists with no
runner. These do not belong to the approved patch integration.

Counts differ between cores because other agents changed test files during
the runs. The failures below are the observed results, not a frozen comparison.

| Test file | Standard failures | Domain failures |
| --- | ---: | ---: |
| `all-player-extra.test.ts` | 2 | 2 |
| `all-player-zone-gaps.test.ts` | 0 | 2 |
| `arcana-target-controller.test.ts` | 0 | 2 |
| `astromorrigan.test.ts` | 6 | 6 |
| `attack-direct-all.test.ts` | 11 | 0 |
| `attack-direct.test.ts` | 4 | 0 |
| `audit-controller.test.ts` | 2 | 2 |
| `book-of-eclipse.test.ts` | 6 | 6 |
| `bound-lasting-effects.test.ts` | 4 | 7 |
| `catalog.test.ts` | 20 | 20 |
| `compare-extra.test.ts` | 3 | 3 |
| `compare-gaps.test.ts` | 2 | 2 |
| `compare.test.ts` | 1 | 1 |
| `cross-fixes-domain.test.ts` | 0 | 26 |
| `declared-opponent.test.ts` | 14 | 14 |
| `df-local-zone-viewer.test.ts` | 2 | 2 |
| `domain-nseat-stress-control.test.ts` | 1 | 1 |
| `domain-nseat-stress-core-compat.test.ts` | 2 | 2 |
| `domain-nseat-stress-core.test.ts` | 2 | 2 |
| `domain-variants.test.ts` | 1 | 0 |
| `duel-style.test.ts` | 1 | 0 |
| `each-player-lp-amounts.test.ts` | 0 | 2 |
| `each-player-lp-responses.test.ts` | 0 | 2 |
| `each-player-lp-triggers.test.ts` | 0 | 8 |
| `elimination-returns.test.ts` | 26 | 28 |
| `engine-nseat-domain.test.ts` | 2 | 0 |
| `engine-nseat.test.ts` | 3 | 0 |
| `event-binding-staples.test.ts` | 0 | 16 |
| `extra-monster-zones.test.ts` | 6 | 6 |
| `ffa4-variants.test.ts` | 2 | 2 |
| `foolish-trap-hole.test.ts` | 0 | 4 |
| `gift-exchange-pair.test.ts` | 2 | 0 |
| `grass-deck-counts.test.ts` | 3 | 3 |
| `host-rule-forbidden.test.ts` | 14 | 14 |
| `local-controller-lp.test.ts` | 0 | 4 |
| `local-controller-summons.test.ts` | 24 | 24 |
| `monster-rebirth.test.ts` | 0 | 8 |
| `multi-scripts-manifest.test.ts` | 2 | 3 |
| `multi-scripts-table.test.ts` | 12 | 12 |
| `multi-scripts.test.ts` | 2 | 2 |
| `native-recipient-proofs.test.ts` | 2 | 2 |
| `nseat-live.test.ts` | 0 | 2 |
| `opponent-field-effects.test.ts` | 20 | 0 |
| `owner-field-returns.test.ts` | 0 | 4 |
| `player-all-lp-pairs.test.ts` | 18 | 12 |
| `r2-checks.test.ts` | 1 | 1 |
| `rotate-control.test.ts` | 16 | 17 |
| `rule-proof-ffa-attack.test.ts` | 1 | 0 |
| `rule-proof-ffa-chain.test.ts` | 0 | 4 |
| `rule-proof-ongoing.test.ts` | 0 | 2 |
| `rule-proof-opponent-field.test.ts` | 0 | 8 |
| `seats-r2.test.ts` | 0 | 2 |
| `seats.test.ts` | 2 | 0 |
| `superconductive-plasma-blast.test.ts` | 6 | 2 |
| `swiftwind-panther-warrior.test.ts` | 0 | 4 |
| `table-cards.test.ts` | 1 | 1 |
| `tag-grave-material-review.test.ts` | 0 | 8 |
| `tag-partner-source.test.ts` | 4 | 4 |
| `true-draco-heritage.test.ts` | 0 | 6 |
| `worm-controller.test.ts` | 0 | 2 |



## Commits

| Commit | Title |
| --- | --- |
| `28d2f72` | core: in Tag a monster of the partner is a Synchro material of the team, at n > 2 |
| `9b77056` | core: count unique cards across the Tag team |
| `b403cf4` | core: permit Xyz attach by effect for a Tag partner monster |
| `66194b8` | core: include the Tag partner GY in extra material lists |
| `1f53fa9` | core: include Tag partner monsters for SELF_ATTACK |
| `30d2710` | core: send hints without an opponent pick |
| `4f0dfad` | test: prove direct attacks at an empty Tag member |
| `c4f1d88` | test: prepare self-attack card data in a private test folder |
| `aae3a79` | core: preserve the stock Synchro material effect order |
| `ff84979` | test: follow the single legal Tag Kaiju procedure |
| `ef8e641` | test: remove the opponent pick after Pendulum Evolution hints |
| `e8675ec` | test: select the Tag Synchro before its team materials |
| `19481e2` | test: keep the FFA Graveyard refusal fixture below Ritual levels |

Coverage table commit: `e98dfe9` (docs: refresh coverage for the approved Tag rules).

## Failure triage, 2026-10-02

The stable Domain run is complete. It uses the same frozen engine, tests,
and overlay as the stable Standard run: commit `ef3302d`. The local Vitest
and TypeScript setup comes from the integrator's fixed snapshot. Both runs
have the same 27 failed test names. The Domain run has no additional failed
test. The frozen engine keeps the old first-draw rule. Thus these results
exclude failures caused only by the shared first-draw work.

The triage task repeats its five assigned files on P61 and P68 with the same
frozen inputs. Each run has 115 passes, 14 failures and 45 todo tests.
All 14 failed test names and failure causes match. No assigned failure is
a regression from patches 0062 through 0068. No new core fix is exported.

| File | Failures per full run | Cause | Action |
| --- | ---: | --- | --- |
| `domain-nseat-stress-core-compat.test.ts` | 2 | Pending elimination cleanup patch | Keep the tests. The elimination task must include `remove-eliminated-chain-cards.patch`. |
| `domain-nseat-stress-core.test.ts` | 2 | Same pending cleanup patch | Keep the raw core queries. |
| `domain-nseat-stress-control.test.ts` | 1 | Stale Tag Standby Phase expectation | Fixed in `5d5219b`. |
| `catalog.test.ts` | 3 | Thirteen stale live scenario names | Fixed in `b8e74bc`. |
| `extra-monster-zones.test.ts` | 6 | Pending local zone viewer patch | Keep the tests. Apply the local zone viewer patch. |
| `multi-scripts-manifest.test.ts` | 1 | Overlay validation | The overlay task owns this failure. |
| `multi-scripts-table.test.ts` | 12 | Overlay validation | The overlay task owns these failures. |

The raw elimination failures query the real Graveyard of seat 1. Dust Tornado
remains there after that seat loses during a chain. The failure already
exists on P61. `field::eliminate` removes the card but does not clear
`core.leave_confirmed`. Later chain cleanup sends the card to the Graveyard
again. The existing proposal clears the queue and the leave status. Its prior
live proof and export are in `phase1/gap-domain/out`. The elimination task
must merge it with the new card-return patch. A view that hides eliminated
cards must not replace the raw queries.

The six zone failures are these three cases, each in Standard and Domain:
`emz-tag-columns-stay-on-each-seat`, `emz-tag-arrow-viewer-p0`, and
`emz-tag-arrow-viewer-p3`. All 48 zone cases pass with the existing private
local zone viewer cores: 24 Standard and 24 Domain. These private cores use
P67 plus `01-local-zone-viewer.patch`; they predate the wave 2 P68 rebuild.
Their exact hashes are in the triage proof record. The patch keeps the own
Link and column viewer on the acting seat. These failures are not stale
tests. This task makes no zone test change.

Dark Snake Syndrome acts only in its owner's Standby Phase. The old Tag test
stops at the partner's turn. The corrected test reaches the owner's next
turn. It first checks the prompt, LP, field, Graveyard, banishment and Deck
Master of every seat in the partner's turn. It then checks the draw result
and every final seat. The complete control file passes 25 tests per P68
core. The corrected Tag case also passes in the current shared tree on
both installed P68 cores.

The catalog still names thirteen negation cases with `homunculus` in their
IDs. The live cases now negate The Calculator and use `calculator` in their
IDs. Only those thirteen proof references are committed. The catalog rule
changes owned by the overlay and opponent tasks stay uncommitted. After
this correction, the catalog has 41 passes and 45 todo tests per P68 core.
The related event-binding file has 48 passes per core. Together with the
control file, the focused fixed run has 114 passes and no failures per core.
Both corrections retain the original failed runs as proof.

These two test fixes remove four failures from the frozen baseline. The
other 23 failures need the pending patches or the overlay task. A full run
after these fixes is not claimed. The later integration gate must repeat
the full suites with the complete patch chain and overlay.

The final package TypeScript check exits 2 with six errors in three other
files: `df-shared-zones.ts`, `extra-monster-zones.ts`, and
`opponent-count-gates.ts`. It has no error in either file changed by triage.
The zone test data needs a `Seat[]` type for the selected target list. This
task leaves it unchanged because the brief requires zone tests that need
the local viewer patch to stay unchanged. The shared-zone and opponent-count
owners must correct their fixture types too.

The earlier P68 core checks remain the integration evidence: six fixed
seeds and 100 random seeds pass; the Standard native checks have 56 passes
and six skipped or pending checks; the Domain native checks have three
passes; `nduel --check` checks 20 rows with no skip or mismatch. Triage does
not repeat these checks because it changes no core. The installed Standard,
Domain multi and Domain 1v1 hashes are unchanged.

Triage proof files are in
`packages/duel-server/domain-core/.build/phase1/triage/out/`.
The compact record is `triage-proof.json`. It has the full failure names,
counts, error text, core hashes and comparison results. The full Domain
JSON report, focused JSON reports and logs are kept there. Private test
copies and temporary index files are removed after the report is complete.

Triage commits:

| Commit | Title |
| --- | --- |
| `b8e74bc` | test: use the current negation scenario names |
| `5d5219b` | test: wait for the owner turn before the Tag loss check |
