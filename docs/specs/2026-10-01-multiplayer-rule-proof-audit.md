# Multiplayer rule proof audit

This audit checks the 28 accepted rule IDs in ADR-0002 when this task started.
FFA3, FFA4 and Tag must work in Standard and Domain. A Domain proof uses
`mode: "domain"`, the Domain core and a Deck Master at every seat.
The paths in the table are under `packages/duel-server/tests/`.
The table names live witnesses. It does not claim that one case proves every
card that can use a rule. The partial coverage list keeps those limits.

The missing proofs were:

- R-COMMON-EMZ: full EMZ, Link arrow, co-link and column proof at all three formats and both modes.
- R-COMMON-FL-LIST: the real lobby and table-start path at every seat and both modes.
- R-TAG-VISIBILITY: real private-card views of all four members in both modes.
- R-TAG-RESPONSE: a stale pending entry; also no explicit Domain-mode runner.
- R-COMMON-ONGOING: FFA4 in both modes.
- R-FFA-LP, R-FFA-ORDER, R-FFA-NO-ATTACK, R-FFA-CHAIN and R-FFA-WINNER: complete Domain witnesses at both FFA formats.
- R-FFA-TRIGGERS: FFA3 and explicit Domain witnesses at both FFA formats.
- R-FFA-ATTACK: a Domain FFA4 witness.
- R-TAG-SHARED-CARDS and R-TAG-TURN-COUNT: explicit Domain witnesses.
- R-TAG-ORDER: a Domain witness of all first-turn clauses, including the first battle.
- R-COMMON-OPP-FIELD: explicit Domain field clears at all three formats. The older Domain Breaker cases showed a single target.

Some Domain cases are built in a test runner with `sources.map(domainVariant)`.
The coverage tool reads data modules, so a data-only search misses those cases.
This audit reads the runners too.

| Rule | Formats | Live witnesses in Standard and Domain |
| --- | --- | --- |
| R-COMMON-SEP-FIELDS | FFA3, FFA4, Tag | `scenarios/multiplayer/extra-monster-zones.test.ts`; Domain master zones in `domain-nseat-gaps.test.ts` and `domain-nseat-stress-control.test.ts` |
| R-COMMON-OPP-FIELD | FFA3, FFA4, Tag | Standard field-card cases; Domain `rule-proof-opponent-field.test.ts` |
| R-COMMON-OPP-PICK | FFA3, FFA4, Tag | `lp-pair-cards.ts`; its Domain variants in `cross-fixes-domain.test.ts`; hand choices in `domain-variants.test.ts` |
| R-COMMON-ONGOING | FFA3, FFA4, Tag | `rule-gaps.test.ts`; FFA4 `rule-proof-ongoing.test.ts` |
| R-COMMON-EACH-PLAYER | FFA3, FFA4, Tag | Each-player card cases; `domain-variants.test.ts` and `domain-nseat-stress-control.test.ts` |
| R-COMMON-ALL-BOTH | FFA3, FFA4, Tag | `rule-gaps.test.ts`, including its Domain variants |
| R-COMMON-EMZ | FFA3, FFA4, Tag | `extra-monster-zones.test.ts`, 48 cases with the exported fix |
| R-COMMON-FL-LIST | FFA3, FFA4, Tag | `host-rule-forbidden.test.ts`, 22 real host-start cases; explicit host exception in the coverage tool |
| R-COMMON-SEAT-STATE | FFA3, FFA4, Tag | Seat-state card cases; `domain-variants.test.ts` and `cross-fixes-domain.test.ts` |
| R-TAG-LP | Tag | `lp-pair-cards.ts` and its Domain variants; `domain-nseat-stress-control.test.ts` |
| R-TAG-ORDER | Tag | `rule-proof-tag-order.test.ts` |
| R-TAG-SHARED-CARDS | Tag | `rule-proof-tag-shared-cards.test.ts`, including the Domain own-hand controls |
| R-TAG-PARTNER-COST | Tag | `tag-partner-cost.test.ts` and `tag-partner-cost-domain.test.ts` |
| R-TAG-PARTNER | Tag | Partner card cases; `domain-variants.test.ts` and `cross-fixes-domain.test.ts` |
| R-TAG-VISIBILITY | Tag | `tag-visibility.test.ts`; every seat and the spectator checked |
| R-TAG-RESPONSE | Tag | `tag-response-order.test.ts` and `rule-proof-tag-response.test.ts` |
| R-TAG-LOSS | Tag | `tag-team-loss.test.ts`; Domain loss cases in `domain-nseat-stress-control.test.ts` and `cross-fixes-domain.test.ts` |
| R-TAG-TURN-COUNT | Tag | `turn-count.test.ts` and `rule-proof-tag-turn-count.test.ts`; Final Countdown is supplied by setup |
| R-FFA-LP | FFA3, FFA4 | `rule-proof-ffa-lp.test.ts` |
| R-FFA-ORDER | FFA3, FFA4 | `rule-proof-ffa-order.test.ts` |
| R-FFA-NO-ATTACK | FFA3, FFA4 | `rule-proof-no-attack.test.ts`, including an early loss |
| R-FFA-CHAIN | FFA3, FFA4 | `rule-proof-ffa-chain.test.ts` |
| R-FFA-TRIGGERS | FFA3, FFA4 | `rule-proof-ffa-triggers.test.ts`, with first and later turn players |
| R-FFA-NEGATE | FFA3, FFA4 | `rule-gaps.test.ts`, including its Domain variants |
| R-FFA-ATTACK | FFA3, FFA4 | `attack-direct.test.ts`, FFA3 Domain variants in `domain-variants.test.ts`, FFA4 `rule-proof-ffa-attack.test.ts` |
| R-FFA-ELIMINATION | FFA3, FFA4 | `nseat-live.test.ts`; Domain `cross-fixes-domain.test.ts` and `domain-nseat-stress-control.test.ts` |
| R-FFA-WINNER | FFA3, FFA4 | `rule-proof-ffa-winner.test.ts`, including draws |
| R-COMMON-CONT-NEG | FFA3, FFA4, Tag | `rule-gaps.test.ts`, including its Domain variants |

The pending list is empty. Two partial notes remain: opponent Deck/draw clauses,
and a legal card for the Tag global turn count. Final Countdown proves the engine
rule, but the host refuses it in a legal multiplayer Deck.

The EMZ tests found a core defect. Card zone views used a team match in Tag, so
a member could use its partner's Link arrow or column. The fix resolves the view
to one seat when there are more than two duelists. The stock two-seat branch stays.
The unnumbered patch and commit message are in
`packages/duel-server/domain-core/.build/phase1/gap-rules/out/`.
The patch is not installed. Six Tag cases fail on installed P61 and pass on the
private patched Standard and Domain cores.

Verification: 196 scoped tests pass across 19 files, including the 48 EMZ cases,
the 22 real host starts and the stock two-seat summon cases. The scoped TypeScript
check passes. Native zone and Link/column checks pass (6 cases, ASan and UBSan).
The review found no defect in these changes.

The wider run passes 337 cases and fails 16 older card cases. Those cases use
work that other agents are changing while the test overlay is a fixed snapshot.
A separate run of 33 unchanged Domain card witnesses passes. The shared package
TypeScript check also sees errors in other agents' scratch test files.

Do not regenerate `multiplayer-rule-coverage.md` in this task. `--check` reports
that page as old until the assigned agent updates it. Shared unfinished scenario
lists can also affect the strict coverage check. Another agent added a proposed
R-TAG-ATTACK rule during this task; it awaits owner confirmation and is outside
the 28 accepted rules audited here.
