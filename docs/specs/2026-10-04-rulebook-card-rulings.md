# Rulebook v1.4 card rulings

Owner approval: 2026-10-04. Source: Domain Format Complete Rulebook v1.4, General Card Rulings and Frequently Asked Cards (lines 251–368), and the accompanying card-rulings audit (gaps 1, 3, 7 and 8).

The implementation uses multiplayer Lua overlays, retaining stock 1v1 scripts and Tag's joined-field comparisons. Work is split into three commits: Mystic Mine's equality condition and proof records; resolution-time decision-only opponent picks and ADR-0002; Dangerous Machine Type-6 comment corrections. Each behavior change gets targeted live scenarios before implementation, followed by the catalog and strict coverage checks. Existing approved activation declarations for resource/action effects remain in effect.

## Mystic Mine

In FFA, each opponent with more monsters than the controller is locked independently. The controller is locked if at least one opponent has fewer monsters. Self-destruction requires equal monster counts for every living duelist, even when one or more other opponents already match. The condition visits every living opponent window and restores the window before returning; it does not request or inherit a chosen opponent.

Tag keeps its stock comparison of joined team counts, including the partner's monsters. Its equality case destroys the card; unequal joined counts keep it. The controller's partner remains able to activate its own monster effects.

Live proofs cover FFA3 partial and full equality, FFA4 partial equality (including a differing last opponent) and full equality, self-lock in both FFA sizes, and Tag equality, inequality and controller lock. `CARD_RULE_PROOF` and the catalog now record all three multiplayer formats.
