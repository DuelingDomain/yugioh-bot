# Round 6 bridge judging verification

Run date: 2026-10-28. Node 22.23.3, branch `feat/archetype-bridges`. These are real paid API replies from the opt-in `scripts/effects/check-bridge-judges-live.ts --live` diagnostic. Each pair received independent mechanic and skeptic reviews in a disposable in-memory database. No live approvals were imported into the application database.

All six final reviews returned valid for each model, and all three pairs passed the local gate. Haiku remains the default. Its explanations still contain rules errors; a valid verdict alone does not establish explanation quality. Sonnet correctly explains the core Odion and Snake-Eye interactions, at a higher price. Neither model is a deterministic rules engine.

Quality issues retained verbatim below: the final Haiku Odion mechanic lock note incorrectly says the Trap is only activatable on its Set turn; the Haiku Snake-Eye mechanic incorrectly limits the search trigger to a Normal Summon. The Sonnet Branded mechanic calls the discard a cost colloquially in one pro, despite correctly identifying it as a resolving effect in the cons. Do not read these statements as corrected rules guidance.

Costs are calculated from returned input, output (including thinking), cache-write and cache-read usage using [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing), rounded upward to a microdollar per request. These are standard online calls, not Batch calls. Each pair cost includes both framings.

| Model | Pair | Mechanic | Skeptic | Gate | USD per pair |
| --- | --- | --- | --- | --- | ---: |
| claude-haiku-5-5 | Odion -> Ashtra | valid | valid | shown | $0.002786 |
| claude-haiku-5-5 | Snake-Eye -> Fire King | valid | valid | shown | $0.002727 |
| claude-haiku-5-5 | Branded -> Despia | valid | valid | shown | $0.001940 |
| claude-sonnet-5-5 | Odion -> Ashtra | valid | valid | shown | $0.044745 |
| claude-sonnet-5-5 | Snake-Eye -> Fire King | valid | valid | shown | $0.039980 |
| claude-sonnet-5-5 | Branded -> Despia | valid | valid | shown | $0.031740 |

Prompt iterations: Haiku run 1 cost $0.007958; run 2 cost $0.006977; final run 3 cost $0.007453. Sonnet comparison cost $0.116465. Total diagnostic spend: **$0.138853**. Run 1 exposed missing curated source membership and a quoted-archetype false positive; run 2 exposed a possessive-apostrophe false positive. Both parser issues and the missing membership were fixed before the final run.

Validation: 55 targeted integration tests passed across bridge judging, Batch judging/publication, authenticated bridge API, deep-search jobs and bridge workers. Typechecks passed for shared, duel-server and scripts/effects. The diagnostic refuses paid calls without `--live`. No new unit tests were added.

## claude-haiku-5-5

### Odion -> Ashtra

Gate: **shown**. Pair cost: **$0.002786**.

#### mechanic: valid / good

Cost: $0.001355; reservation: $0.004334. Input: 2835; cache write: 2098; cache read: 0; output: 1618 tokens.

**Pros (full normalized reply):**

- Temple of the Kings lets Ashtra Divine Domain be activated the turn it was Set, a concrete Trap-permission bridge into the target engine
- Ashtra Divine Domain can Special Summon itself as a Level 1 Tuner Normal Monster, enabling a Synchro follow-up from the Extra Deck
- Ashtra Divine Domain's negate mode is also available on the same turn if the opponent controls no face-down cards

**Cons (full normalized reply):**

- Requires Temple of the Kings to be activated into a free Spell/Trap Zone first, and the permission lasts only while Temple stays face-up
- The Divine Domain Set must come from hand, since a normal Set cannot take a card from the Deck
- The Synchro Summon follow-up needs a suitable Synchro Monster in the Extra Deck and is optional, not part of the core bridge

**Lock note:** Temple's permission is a while-face-up effect and ends if Temple leaves the field; Ashtra Divine Domain is only activatable on the turn it was Set. Divine Domain is once per turn, and the Synchro step is optional.

**Line:** Temple of the Kings → Ashtra Divine Domain → Ashtra Divine Domain

#### skeptic: valid / good

Cost: $0.001431; reservation: $0.004338. Input: 2835; cache write: 2112; cache read: 0; output: 1767 tokens.

**Pros (full normalized reply):**

- Temple of the Kings lets you activate a Trap the turn it was Set, so Ashtra Divine Domain can be Set from hand and activated the same turn.
- Ashtra Divine Domain's Special Summon mode makes it a Level 1 Aqua Tuner Normal Monster, a Synchro enabler for the Ashtra engine.
- Ashtra Divine Domain's negate mode can answer an opponent's Spell/Trap activation when the opponent controls no face-down cards.

**Cons (full normalized reply):**

- Needs a free Spell/Trap Zone for Temple of the Kings and another free zone to Set Ashtra Divine Domain.
- The Synchro Summon follow-up needs a Synchro Monster in the Extra Deck that is not among the supplied cards.
- The same-turn Trap permission depends on Temple of the Kings staying face-up; if it leaves the field, the permission ends.

**Lock note:** No lock metadata is supplied. Temple of the Kings' permission applies only while it is face-up and only to a Trap Set this turn; Ashtra Divine Domain is limited to one activation per turn.

**Line:** Temple of the Kings → Ashtra Divine Domain

### Snake-Eye -> Fire King

Gate: **shown**. Pair cost: **$0.002727**.

#### mechanic: valid / niche

Cost: $0.001343; reservation: $0.004255. Input: 2487; cache write: 0; cache read: 2098; output: 2146 tokens.

**Pros (full normalized reply):**

- Snake-Eye Ash's Normal or Special Summon trigger can add Legendary Fire King Ponix, a Level 1 FIRE monster, from the Deck to hand, which is a concrete search into the Fire King engine.
- Ash's search does not require sending cards to the GY, so the Snake-Eye side keeps its face-up cards.

**Cons (full normalized reply):**

- Ash must itself be Normal Summoned from hand as the standard setup; the search is only available on that Summon.
- The proposed second step, Legendary Fire King Ponix searching Fire King Island, is not established: Ponix's search requires Ponix to be Normal or Special Summoned, and it reaches the Summon only from hand, which the supplied cards do not provide.
- Ash's Special Summon effect can only target a Snake-Eye monster, so it cannot Summon Ponix to enable that second search.

**Lock note:** No lock metadata applies to the accepted line. Ash's search adds Ponix to hand without Summoning it, so Ponix's own search and the Fire King Island route are not established.

**Line:** Snake-Eye Ash → Legendary Fire King Ponix

#### skeptic: valid / niche

Cost: $0.001384; reservation: $0.004259. Input: 2487; cache write: 0; cache read: 2112; output: 2227 tokens.

**Pros (full normalized reply):**

- Snake-Eye Ash's Normal or Special Summon trigger adds Legendary Fire King Ponix from Deck to hand, since Ponix is a Level 1 FIRE monster, which is a legal concrete search into the Fire King engine.
- The search costs nothing and needs only Snake-Eye Ash on the field after a Normal or Special Summon, with no send-to-GY cost.

**Cons (full normalized reply):**

- Snake-Eye Ash must first be Normal or Special Summoned, and Normal Summoning it uses the turn's Normal Summon, so Ponix cannot then be Normal Summoned.
- The second step, Ponix searching Fire King Island, requires Ponix itself to be Normal or Special Summoned, which no supplied Snake-Eye effect does, so that step is not established.
- The Snake-Eye Ash search is limited to once per turn per effect, so it yields only one target card per turn.

**Lock note:** No lock metadata is supplied for these cards. Snake-Eye Ash's search is limited to once per turn for each of its effects, and it is not a cost. Ponix's Spell/Trap search is not established because Ponix is never Summoned in the accepted line.

**Line:** Snake-Eye Ash → Legendary Fire King Ponix

### Branded -> Despia

Gate: **shown**. Pair cost: **$0.001940**.

#### mechanic: valid / niche

Cost: $0.000955; reservation: $0.004282. Input: 2617; cache write: 0; cache read: 2098; output: 1343 tokens.

**Pros (full normalized reply):**

- Branded Opening, a Quick-Play Spell, can take Despian Tragedy from the Deck and add it to hand without any Summon, which is a concrete search into the target engine.
- The Extra Deck Special Summon restriction on Branded Opening does not block this search, because the search adds to hand and Despian Tragedy is not an Extra Deck monster.
- Branded Opening's search is a direct source-to-target bridge, so the line works even though the Branded Banishment mention is only ancillary.

**Cons (full normalized reply):**

- The discard is part of the resolving effect rather than a cost, so you need at least one other card in hand to discard for the full effect to work.
- Despian Tragedy's own follow-up effect needs it to be sent to the GY or banished by a card effect, which this search line does not establish.
- Branded Opening can only use each of its effects once per turn, and the Extra Deck Special Summon restriction lasts for the rest of that turn.

**Lock note:** After Branded Opening resolves, you cannot Special Summon Extra Deck monsters for the rest of the turn except Fusion Monsters. The accepted search only adds Despian Tragedy to hand, so the restriction does not stop it. No whole-turn restriction applies.

**Line:** Branded Opening → Despian Tragedy

#### skeptic: valid / good

Cost: $0.000985; reservation: $0.004286. Input: 2617; cache write: 0; cache read: 2112; output: 1403 tokens.

**Pros (full normalized reply):**

- Branded Opening is a Quick-Play Spell that can be activated from hand and searches the supplied Despian Tragedy from the Deck to hand, a concrete Branded-to-Despia bridge.
- Despian Tragedy is a Level 1 Despia monster, so the searched card is cheap to add and does not require a Summon to count as a bridge.
- Branded Opening's rest-of-turn restriction only blocks non-Fusion Extra Deck Special Summons after it resolves, so it does not interfere with the search itself.

**Cons (full normalized reply):**

- Branded Opening requires a card in hand to discard as part of its resolving effect, so the line needs at least one other card in hand.
- The search only adds Despian Tragedy to hand; it does not Summon it, and its own effects need a separate card effect that sends or banishes it.
- After Branded Opening resolves, Extra Deck monsters other than Fusion Monsters cannot be Special Summoned for the rest of that turn.

**Lock note:** Branded Opening's restriction applies only after it resolves, for the rest of the turn, and blocks Special Summons from the Extra Deck except Fusion Monsters. It does not restrict adding Despian Tragedy to hand. The mention line through Branded Banishment is ancillary and not needed.

**Line:** Branded Opening → Despian Tragedy

## claude-sonnet-5-5

### Odion -> Ashtra

Gate: **shown**. Pair cost: **$0.044745**.

#### mechanic: valid / good

Cost: $0.023025; reservation: $0.086680. Input: 2835; cache write: 2098; cache read: 0; output: 1211 tokens.

**Pros (full normalized reply):**

- Temple of the Kings lets Ashtra Divine Domain be activated the same turn it is Set, so the Trap works straight from hand.
- Ashtra Divine Domain Special Summons itself as a Level 1 Tuner and may then Synchro Summon, so the source Spell opens the Ashtra Synchro plan immediately.

**Cons (full normalized reply):**

- Needs both cards in hand, plus two free Spell/Trap Zones: one for the face-up Temple of the Kings and one for the Set Ashtra Divine Domain.
- The Special Summon needs a free Monster Zone. The optional Synchro Summon also needs a Synchro Monster in the Extra Deck and suitable non-Tuner material, and none is supplied.
- This line does not search or Set any extra Ashtra card. It only enables a same-turn Trap activation.

**Lock note:** No lock applies. Temple of the Kings must stay face-up when the Trap is activated, so do not use its send-to-GY effect first. Ashtra Divine Domain is limited to one activation per turn. The chosen effect must be the self-Summon, because the negate effect needs an opponent's activation.

**Line:** Temple of the Kings → Ashtra Divine Domain

#### skeptic: valid / good

Cost: $0.021720; reservation: $0.086750. Input: 2835; cache write: 2112; cache read: 0; output: 1077 tokens.

**Pros (full normalized reply):**

- Temple of the Kings lets a Trap be activated the turn it was Set, so Ashtra Divine Domain can be Set from hand and activated the same turn.
- Ashtra Divine Domain's first effect Special Summons itself as a Level 1 Tuner, which lets the Ashtra deck get a Synchro Summon going immediately.
- Temple of the Kings is a Continuous Spell, so its permission applies as soon as it is face-up, with no separate effect activation or cost.

**Cons (full normalized reply):**

- Ashtra Divine Domain has to be in hand, because a normal Set cannot take it from the Deck, and Temple of the Kings has to be activated first.
- The follow-up Synchro Summon is optional and needs a free Monster Zone, a suitable non-Tuner monster and a legal Synchro Monster.
- Ashtra Divine Domain can only be activated once per turn, and the line does not use Temple of the Kings' own Special Summon effect.

**Lock note:** No lock applies to the accepted interaction. The permission lasts only while Temple of the Kings is face-up, so it must stay on the field until Ashtra Divine Domain is activated. The once-per-turn limit on Ashtra Divine Domain applies.

**Line:** Temple of the Kings → Ashtra Divine Domain

### Snake-Eye -> Fire King

Gate: **shown**. Pair cost: **$0.039980**.

#### mechanic: valid / good

Cost: $0.016514; reservation: $0.085095. Input: 2487; cache write: 0; cache read: 2098; output: 1133 tokens.

**Pros (full normalized reply):**

- Snake-Eye Ash, when Normal or Special Summoned, adds a Level 1 FIRE monster from the Deck. Legendary Fire King Ponix is a Level 1 FIRE Winged Beast, so it is a legal search target.
- The search puts a Fire King card in hand from a Snake-Eye starter with no Fire King card needed on the field.
- Ponix could later search a Fire King Spell/Trap such as Fire King Island once it is Summoned, but that is an optional follow-up.

**Cons (full normalized reply):**

- Snake-Eye Ash must first be Normal or Special Summoned. Its search needs this trigger and is limited to once per turn.
- If Snake-Eye Ash used the Normal Summon, Ponix cannot be Normal Summoned that turn. Its Special Summon from hand needs an originally FIRE monster destroyed by battle or effect, and Snake-Eye Ash sending cards to the GY is not destruction.
- Ponix only searches Fire King Island if it is Normal or Special Summoned, and the supplied cards do not establish a Summon of Ponix. The second step is therefore not accepted. Ponix costs 7 Genesys points.

**Lock note:** No restrictions apply to the accepted search. Ponix and Snake-Eye Ash are each limited to once per turn, and the Ponix search into Fire King Island is not established.

**Line:** Snake-Eye Ash → Legendary Fire King Ponix

#### skeptic: valid / good

Cost: $0.023466; reservation: $0.085170. Input: 2487; cache write: 0; cache read: 2112; output: 1828 tokens.

**Pros (full normalized reply):**

- Snake-Eye Ash's Summon trigger adds a Level 1 FIRE monster from the Deck, and Legendary Fire King Ponix is a Level 1 FIRE Winged Beast, so it is a legal search into Fire King.
- Once Ponix is in hand and Summoned, it can search Fire King Island, a Fire King Spell/Trap, so the line can extend toward Island's destroy-and-search effect.

**Cons (full normalized reply):**

- Ash only adds Ponix to hand. Ponix still has to be Summoned for its own search, and Ash's Special Summon effect only targets other Snake-Eye monsters, so it cannot do that.
- If Ash was Normal Summoned, Ponix cannot also be Normal Summoned, and the supplied cards give no way to destroy a FIRE monster to Special Summon it from hand. The Ponix to Fire King Island step therefore needs Ash to have been Special Summoned (leaving the Normal Summon free) or an unlisted destruction enabler.
- Ash's search is once per turn and needs Ash to be Summoned first. Ponix carries 7 Genesys points, which count toward a deck budget that was not supplied.

**Lock note:** No locks are listed on the supplied cards. Each Ash and Ponix effect is once per turn, but the accepted Ash to Ponix search does not conflict with them. The Ponix to Fire King Island extension is not accepted because its Summon requirement is not established.

**Line:** Snake-Eye Ash → Legendary Fire King Ponix

### Branded -> Despia

Gate: **shown**. Pair cost: **$0.031740**.

#### mechanic: valid / good

Cost: $0.016404; reservation: $0.085635. Input: 2617; cache write: 0; cache read: 2098; output: 1096 tokens.

**Pros (full normalized reply):**

- Branded Opening is a Quick-Play Spell that can be activated from hand. It lets you take 1 Despia monster from the Deck, and Despian Tragedy is a Despia monster, so it can be added to hand.
- The only cost is a discard, so no Summoned searcher, GY target or Set card is needed. This gives Branded a way to reach Despia from the Deck.
- The lock only blocks non-Fusion Extra Deck Special Summons, so Despia Fusion Monsters such as Masquerade the Blazing Dragon can still be Fusion Summoned afterward.

**Cons (full normalized reply):**

- You need a second card in hand to discard. The discard is part of the resolving effect, not a cost, and it is not free.
- Branded Opening can be used only once per turn. This line only adds Despian Tragedy to hand and does not Summon it or complete a Fusion.
- After resolution, you cannot Special Summon Extra Deck monsters other than Fusion Monsters for the rest of the turn.

**Lock note:** Branded Opening restricts the rest of the turn after it resolves: no Extra Deck Special Summons except Fusion Monsters. This does not affect the search itself, and Fusion Summons remain allowed afterward.

**Line:** Branded Opening → Despian Tragedy

#### skeptic: valid / good

Cost: $0.015336; reservation: $0.085710. Input: 2617; cache write: 0; cache read: 2112; output: 989 tokens.

**Pros (full normalized reply):**

- Branded Opening searches Despian Tragedy from the Deck to hand, since Despian Tragedy is a Despia monster. This is a concrete Branded-to-Despia bridge.
- Branded Opening is a Quick-Play Spell, so it can be activated from hand and is not tied to a specific Summon or board state.
- The post-resolution Extra Deck restriction still allows Fusion Monsters, so Despia Fusion Monsters such as Masquerade the Blazing Dragon are unaffected.

**Cons (full normalized reply):**

- Branded Opening requires another card in hand to discard. The discard is part of the resolving effect, not a cost.
- The line only adds Despian Tragedy to hand. It does not Summon it, and nothing in these cards makes it a strong standalone follow-up.
- Branded Opening is limited to once per turn for each of its effects, and the card is spent on this one search.

**Lock note:** Branded Opening only restricts the rest of the turn after it resolves: no Extra Deck Special Summons except Fusion Monsters. The search itself is unaffected, and Despia Fusion Monsters remain legal afterward.

**Line:** Branded Opening → Despian Tragedy
