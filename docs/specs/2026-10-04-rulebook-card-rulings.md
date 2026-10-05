# Rulebook v1.4 card rulings

Owner approval: 2026-10-04. Source: Domain Format Complete Rulebook v1.4, General Card Rulings and Frequently Asked Cards (lines 251–368), and the accompanying card-rulings audit (gaps 1, 3, 7 and 8).

The implementation uses multiplayer Lua overlays, retaining stock 1v1 scripts and Tag's joined-field comparisons. Work is split into three commits: Mystic Mine's equality condition and proof records; resolution-time decision-only opponent picks and ADR-0002; Dangerous Machine Type-6 comment corrections. Each behavior change gets targeted live scenarios before implementation, followed by the catalog and strict coverage checks. Existing approved activation declarations for resource/action effects remain in effect.

## Mystic Mine

In FFA, each opponent with more monsters than the controller is locked independently. The controller is locked if at least one opponent has fewer monsters. Self-destruction requires equal monster counts for every living duelist, even when one or more other opponents already match. The condition visits every living opponent window and restores the window before returning; it does not request or inherit a chosen opponent.

Tag keeps its stock comparison of joined team counts, including the partner's monsters. Its equality case destroys the card; unequal joined counts keep it. The controller's partner remains able to activate its own monster effects.

Live proofs cover FFA3 partial and full equality, FFA4 partial equality (including a differing last opponent) and full equality, self-lock in both FFA sizes, and Tag equality, inequality and controller lock. `CARD_RULE_PROOF` and the catalog now record all three multiplayer formats.

## Resolution-time opponent decisions

ADR-0002 now has `R-COMMON-OPP-DECISION`. Pure decisions are separate from declarations affecting an opponent's resources and from causal responses such as Mirror Force or Lazion. Raigeki and Trishula still declare a targeted opponent at activation.

`aux.MPChooseOpponent(tp)` enumerates living duelists, excludes the activator's own side (including a Tag partner), restores the scope, and uses the existing `0xFFFE0000 | seat` option descriptors understood by `prompts.ts`. It binds the selected real seat with `MPBindSeat`, overriding a trigger's causal opponent only for these decision-only operations. A sole living opponent is bound silently; no opponents stops the operation. Existing core patch 0072 infers an activation declaration from opponent card-selection calls, and does not propagate this helper's binding back to its caller. New patch `0100-resolution-opponent-decisions.patch` summarizes only the reviewed helper's closure name, source and line span as an explicit resolution binding. The abstract success result stays unknown, so the operation's failure guard remains visible. Other card wrappers are still scanned. The catalog checks the helper span; two synthetic same-name wrappers verify that opponent damage still declares at activation. Both Standard and Domain multiplayer cores are rebuilt under the requested lock with at most two compiler jobs. Activation helpers `MPPick`, `MPTarget` and the core's declaration machinery are unchanged.

Painful Choice and Summonite already reached the stock core's lazy chooser at resolution, but that fallback could inherit a causal seat and was not an explicit rule. Their overrides now pick deliberately: Painful Choice after selecting five own Deck cards and before showing them to its deciding opponent; Summonite after targeting three own GY monsters at activation and selecting one of them at resolution. Vaalmonica Versare and Intonare incorrectly advertised opponent damage in their activation metadata; both now advertise damage to the activator, which removes the premature FFA declaration. Their opponent mode choices remain conditional on the presence of an own Pendulum Vaalmonica. Intonare uses the same selected opponent for its later monster choice, or picks one then if the activator selected/copied the first mode.

The 33-card stock script scan covered explicit opponent choice/announcement calls, their local player aliases and card-text choice descriptions. These overlays redefine only the named operation (and the two Vaalmonica metadata targets or Rescute Rescue's condition where needed). Their `DECISION` manifest class keeps this reviewed set separate from the older pinned compare/chooser census. “Randomly pick” cards implemented by a stock opponent `Group.Select` use the same mechanical pattern and are included.

| Changed decision-only card | Code | Redefined functions |
|---|---|---|
| Vaalmonica Scelta | 5605529 | `activate` |
| The Monarchs Revolt | 9283801 | `thtgop` |
| Draco Face-Off | 14733538 | `activate` |
| Chosen One | 21888494 | `activate` |
| Pantheism of the Monarchs | 22842126 | `thop` |
| Monster Assortment | 23270035 | `operation` |
| Lilith, Lady of Lament | 23898021 | `thop` |
| Gunkan Suship Daily Special | 24393683 | `activate` |
| Beginning of Heaven and Earth | 32360466 | `activate` |
| The Despair Uranus | 32588805 | `setop` |
| Amaze Attraction Thrill Train | 36591747 | `setop` |
| Question | 38723936 | `activate` |
| Spellbook Library of the Crescent | 40230018 | `operation` |
| Voici la Carte (Today's Menu) | 41773061 | `activate` |
| Vaalmonica Versare | 42193638 | `activate`, `target` |
| Weights & Zenmaisures | 42548470 | `activate` |
| Monster Reborn Reborn | 50213848 | `activate` |
| Crowley, the First Propheseer | 50756327 | `thop` |
| Painful Return | 57902193 | `activate` |
| Reasoning | 58577036 | `operation` |
| Super Quantal Fairy Alphan | 58753372 | `spop` |
| Earthshaker | 60866277 | `operation` |
| Rare Value | 60876124 | `activate` |
| Kozmo Tincan | 64280356 | `thop` |
| Tool Box | 70508653 | `thop` |
| Fifty Fifty? | 71275181 | `activate` |
| Painful Choice | 74191942 | `activate` |
| Vaalmonica Intonare | 78598237 | `target`, `activate` |
| Gunkan Suship Catch-of-the-Day | 83008724 | `operation` |
| Intimidating Ore - Summonite | 91592030 | `spop` |
| Bingo Machine, Go!!! | 93437091 | `operation` |
| Emerging Emergency Rescute Rescue | 97926515 | `condition`, `activate` |
| Guiding Ariadne | 98301564 | `regop` |

### Other matches retained for separate work

| Card | Reason it cannot use the same operation-only change |
|---|---|
| Pixie Knight | The stock opponent chooses a targeted own-GY Spell during the target callback. Moving that decision also changes target timing and card-target semantics. |
| D.D. Guide | The End Phase opponent chooses a target at activation; the monster also changes controller and requires careful handling of the effect controller's GY. |
| Spell Chronicle | The opponent selects a card target while counters are spent at activation. Moving only the seat pick would leave the card choice at activation. |
| Guts of Steel | The chooser is followed by an optional summon to an opponent's field; that destination is another player action and cannot be replaced by only a decision binding. |
| Book of Eclipse | Retained owner decision, 2026-10-02: affected opponent declared at activation. Rulebook v1.4 explicitly chooses during the End Phase effect's resolution and prefers a face-down field. ADR-0002 records this exception. |

Cards that require an opponent's own cards, LP, attack or response are excluded from the decision-only set: for example Dark Coffin, Half or Nothing, Changing Destiny, Ordeal of a Traveler, Silent Wolf Calupo, DNA Checkup, Onikuji, One or Eight, Hatsugai, Hallo/Ween, Infernity Doom Slinger, Geo Gremlin, Mimighoul Fork and the existing resource chooser overlays. Their declaration or event binding remains unchanged.

Automatic `Group.RandomSelect` cases use a different mechanism: the Danger! reveal effects (Bigfoot, Chupacabra, Dogman, Mothman, Nessie, Ogopogo, Thunderbird, Jackalope and Tsuchinoko), Number 78: Number Archive, A Hero Emerges, Hero Counterattack and Tribe Drive remain unchanged. Their random selection does not ask a human to decide. Pure stock `Group.Select` reveals, including Bingo Machine, Go!!!, do ask the chosen opponent and are changed above.

Live decision proofs cover response windows before resolution, own-card preparation before the seat pick, the actual last-seat chooser, both Intonare mode-selection paths with one opponent pick, a destroyed Guiding Ariadne whose deciding opponent differs from its destroyer, Reasoning's Level declaration, both Summonite outcomes, Earthshaker's Attribute choice and all-field destruction, elimination before a resolution pick, the sole surviving opponent without a seat prompt, and surrender while a resolution seat prompt is open (the departing option is removed without reindexing; elimination lands after the chain). Rescute Rescue proves a different opponent can decide from the one who satisfies its LP condition. All applicable cases run in FFA3, FFA4 and Tag. This is representative live coverage; the other copied operations have their stock behavior preserved around the inserted picker, but do not yet have individual live proofs.

Verification: 163 targeted tests passed on the rebuilt Standard multiplayer core and 163 on the rebuilt Domain multiplayer core (one Vitest worker; unrelated scenarios filtered out and 36 existing catalog sketches remain TODO). The selected controls cover resource/action activation timing, Raigeki, third-party Mirror Force and the approved Book of Eclipse exception. All 33 stock-plus-overlay Lua chunks compile. The overlay generator check passes; regenerated rule coverage passes `--strict --check` with 45/45 rules covered. Read-only review found no blocking issue.
