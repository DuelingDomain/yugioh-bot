# Multiplayer rule proof audit

The first audit checked 28 rule IDs in ADR-0002 on 2026-10-01. The current owner
rules are in `DECISIONS-2026-10-01.md`, including the answers of 2026-10-02.
The test counts below record the old audit. They are not proof that the pending
core exports pass on installed P68.

The following rules replace the old readings:

- `R-FFA-OPP-ONE`: an activated effect on "your opponent" declares one opponent
  in FFA. A trigger binds the opponent that caused its event. A resource-free
  condition is satisfied by one eligible opponent. Tag keeps its team rules.
  The old `R-COMMON-OPP-FIELD` rule is retired. Book of Eclipse and Astromorrigan
  also declare one opponent. C3 and C4 provide the core changes.
- `R-COMMON-ONGOING`: a face-up continuous effect applies to every eligible
  player or card. A lasting lock from an activated effect is bound to one
  declared opponent. The legal Gravity Bind proof must run on both cores.
- First draw: Domain draws on each duelist's first turn in every format.
  Standard MR1 and MR2 also draw on turn 1. Standard MR3, MR4 and MR5 skip only
  the turn-1 duelist's draw. All later duelists draw on their first turn.
- `R-FFA-NO-ATTACK`: the last living duelist gets the first Battle Phase on
  turn n. C2 provides the change from P68's turn n+1.
- FFA4 shares Extra Monster Zones and columns between seats 0/2 and 1/3.
  FFA3 keeps separate zones. C1 and C6 provide the zone changes; the old FFA4
  separate-zone witnesses do not prove the current rule.
- Elimination keeps the seat numbers. Unresolved loser chain links and owned
  cards leave, except tokens. Cards owned by other duelists return to their
  owners, or go to their owners' GYs if no legal field zone is available.
  C5 provides the change. `R-FFA-RETURN-OWNED-CARDS` is for elimination only.
- Resource manipulation acts in turn order from the turn player. Creature
  Swap rotates each selected monster to the next living duelist; C7 provides
  that change. A singular opponent chooser is one declared duelist in Tag too.
- "Each player" includes each living Tag partner. The Law of the Normal
  needs another activator hand card and a hand card at one opponent for
  activation. An empty hand does nothing at resolution.

After integration, run the affected Standard and Domain witnesses and the
strict rule-coverage check before this page claims current proof completion.
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
- R-FFA-OPP-ONE: current one-opponent outcome witnesses depend on C3/C4 integration. The old Domain all-opponent clears are retired.

Some Domain cases are built in a test runner with `sources.map(domainVariant)`.
The coverage tool reads data modules, so a data-only search misses those cases.
This audit reads the runners too.

| Rule | Formats | Live witnesses in Standard and Domain |
| --- | --- | --- |
| R-COMMON-SEP-FIELDS | FFA3, FFA4, Tag | `scenarios/multiplayer/extra-monster-zones.test.ts`; Domain master zones in `domain-nseat-gaps.test.ts` and `domain-nseat-stress-control.test.ts` |
| R-FFA-OPP-ONE | FFA3, FFA4; Tag controls | `declared-opponent.test.ts`, `bound-lasting-effects.test.ts`, and the revised `rule-proof-opponent-field.test.ts`; C3/C4 integration and fresh runs are required |
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

The pending list was empty at the time of the old audit. That does not close
the current C1-C7 dependencies above. Two partial notes from the old audit remain: opponent Deck/draw clauses,
and a legal card for the Tag global turn count. Final Countdown proves the engine
rule, but the host refuses it in a legal multiplayer Deck.

The old EMZ tests found a core defect. The old FFA4 separate-zone cases are
replaced by the current C6 shared-zone witnesses. The Tag local-view defect
still requires C1. In the old proof, Card zone views used a team match in Tag, so
a member could use its partner's Link arrow or column. The fix resolves the view
to one seat when there are more than two duelists. The stock two-seat branch stays.
The unnumbered patch and commit message are in
`packages/duel-server/domain-core/.build/phase1/gap-rules/out/`.
The patch is not installed. Six Tag cases failed on the old installed P61 and passed on the
private patched Standard and Domain cores.

Historical verification (before the 2026-10-02 rule changes): 196 scoped tests pass across 19 files, including the 48 EMZ cases,
the 22 real host starts and the stock two-seat summon cases. The scoped TypeScript
check passes. Native zone and Link/column checks pass (6 cases, ASan and UBSan).
The review found no defect in these changes.

The wider run passes 337 cases and fails 16 older card cases. Those cases use
work that other agents are changing while the test overlay is a fixed snapshot.
A separate run of 33 unchanged Domain card witnesses passes. The shared package
TypeScript check also sees errors in other agents' scratch test files.

Do not regenerate `multiplayer-rule-coverage.md` in this task. `--check` reports
that page as old until the assigned agent updates it. Shared unfinished scenario
lists can also affect the strict coverage check. The owner confirmed R-TAG-ATTACK: a direct attack is legal when the
attacked member has no monster, even if the partner has monsters. This rule
was outside the 28 rule IDs in the old audit.
