# Multi-player duels use separate fields per duelist, official TCG Tag rules for 2v2, and "field hits all, hand/Deck picks one" for free-for-all

**Status:** accepted (2026-09-30, product owner)

We are adding three multi-player formats next to the current 1v1 duel: **2v2 Tag**, **3-player free-for-all** and **4-player free-for-all**. All three work in both Standard and Domain duels, with the same rules. Every duelist always has their own full field. The EDOPro shared-field tag (one field and one LP total per team, partners swap each turn) was considered and rejected: it is what the core supports today, but it is not the game the players want.

Konami publishes official rules only for Tag Duels (TCG, revised 5 December 2019: https://www.yugioh-card.com/en/play/tagduel/). There are no official Battle Royal (free-for-all) rules, so the free-for-all rules below are ours. They reuse the Tag Duel logic wherever it applies.

## Rules common to every multi-player format

- `[R-COMMON-SEP-FIELDS]` **Separate fields.** Each duelist has their own Main Monster Zones, Spell & Trap Zones, Field Zone, Pendulum Zones (per the Master Rule), Graveyard, banishment, hand, Deck and Extra Deck. In Domain, each duelist has their own Deck Master and Deck Master zone.
- `[R-COMMON-OPP-FIELD]` **"Opponent" on the field.** An effect that refers to "your opponent", "your opponents", or "your opponent's field / Graveyard / banishment" applies to **all** opponents, whether the text says "all" or not. Examples: Raigeki and Harpie's Feather Duster clear every opponent's field. Count and compare cards are the exception (see "Answers to the ten triage questions", question 2).
- `[R-COMMON-OPP-PICK]` **"Opponent" for hand, Deck, Extra Deck, draws and LP.** When an effect affects an opponent's hand, Deck or Extra Deck, makes an opponent draw, or targets an opponent's LP, the activating duelist **picks one opponent when they activate it**. The pick is part of the activation.
- `[R-COMMON-ONGOING]` **Ongoing effects.** An ongoing restriction on "your opponent" applies to all opponents.
- `[R-COMMON-EACH-PLAYER]` **"Each player" / "both players".** Applies to every duelist in the duel.
- `[R-COMMON-ALL-BOTH]` **"All" and both sides of the field.** An effect that affects "all" cards, or cards on both sides of the field (for example Dark Hole: "destroy all monsters on the field"), affects every duelist, you and your 2v2 partner included. An effect on "your opponent" affects only opponents, never your partner.
- `[R-COMMON-EMZ]` **Extra Monster Zones.** Each duelist has their own two Extra Monster Zones (EMZ) on their own field. As in 1v1 (Master Rule 4 and 5), a duelist may use one of them. A second monster goes into the other EMZ only when the 1v1 rules allow it (for example, a Link Monster points to that zone). The EMZ of different duelists do not block each other.
- `[R-COMMON-FL-LIST]` The Forbidden & Limited List applies per duelist (per Deck).
- `[R-COMMON-SEAT-STATE]` **Per-player flags and counters (owner decision Q6).** A flag or counter that a card keeps for each player (for example Curse of the Circle, Wiseman's Chalice, Fatal Abacus) has one slot per seat in free-for-all and one slot per team in Tag. The key is the team in Tag and the seat in free-for-all (rule R2 of the triage).

## 2v2 Tag (official TCG Tag Duel rules)

- `[R-TAG-LP]` Two teams of two duelists. **Each team shares one LP total**, equal to the sum of its members' starting LP (16,000 with the default 8,000).
- `[R-TAG-ORDER]` Turn order is 1A, 2A, 1B, 2B. The first duelist does not draw on their first turn. The first three duelists cannot attack; the first Battle Phase is turn 4.
- `[R-TAG-SHARED-CARDS]` "You control", "your field" and "your Graveyard" include your partner's cards. "Your hand" and "your Deck" mean only your own.
- `[R-TAG-PARTNER-COST]` You may use your partner's cards for costs, Tributes, materials and summon conditions. You cannot activate your partner's cards or effects.
- `[R-TAG-PARTNER]` Your partner is not your opponent. Your effects on "your opponent" do not affect your partner, and a card that works only on an opponent's card (for example Effect Veiler or Infinite Impermanence) cannot be used on your partner's card. A card that negates an activation, an effect or a summon (for example Solemn Judgment, Solemn Warning or Ash Blossom & Joyous Spring) cannot negate your partner's activation, effect or summon. It can negate the activations and summons of the opposing team, and your own, as in 1v1.
- `[R-TAG-VISIBILITY]` Partners may see each other's hands and Set cards.
- `[R-TAG-RESPONSE]` After a Chain Link, the opposing team gets the first chance to respond. Simultaneous triggers resolve in the order turn player, turn player's partner, then the opposing team.
- `[R-TAG-LOSS]` A team loses when its LP reaches 0, or when either of its duelists must draw from an empty Deck.
- `[R-TAG-TURN-COUNT]` Turn-count effects (for example Final Countdown) count every duelist's turn.

## 3-player and 4-player free-for-all (our rules)

These are the defaults. The organizer may later get options for LP.

- `[R-FFA-LP]` Each duelist has their own LP (default 8,000).
- `[R-FFA-ORDER]` Turn order is clockwise in seat order. The first duelist does not draw on their first turn.
- `[R-FFA-NO-ATTACK]` **No duelist attacks until every duelist has had one turn.** Clarification: the window ends when every **living** duelist has had a turn. A duelist who is eliminated before their first turn never has one, and does not keep the window open. In a game of 3 the first attack is possible on turn 3 and in a game of 4 on turn 4, when one duelist was out before their first turn.
- `[R-FFA-CHAIN]` **Chain responses.** After a duelist adds a Chain Link, the turn player gets the first chance to respond, because the turn player has priority. Then the chance goes clockwise from the turn player, and the duelist who added the link also gets a chance in their place in that order. When the turn player added the link, the first chance goes to the next duelist clockwise, and the turn player responds last. The chain resolves when every duelist passes in a row.
  - Example (4 players, player 1 is the turn player): player 1 activates a card. Players 2, 3, 4 and then 1 may respond. Player 2 chains. Player 1 responds first, then players 2, 3 and 4.
- `[R-FFA-TRIGGERS]` **Simultaneous triggers** go on the chain in turn order: the turn player first, then clockwise.
- `[R-FFA-NEGATE]` A card that negates an activation, an effect or a summon (for example Solemn Judgment or Ash Blossom & Joyous Spring) can negate the activation, effect or summon of any duelist, as in 1v1.
- `[R-FFA-ATTACK]` The attacking duelist picks any opponent's monster, or makes a direct attack on an opponent who controls no monster.
- `[R-FFA-ELIMINATION]` A duelist loses at 0 LP or when they must draw from an empty Deck. **Their cards leave the game**, including their cards that another duelist controls, and their ongoing effects stop. **Their Chain Links that are already on the chain resolve with no effect.** This holds from the moment the loss is flagged, also for a duelist who gives up while the chain is open: the loss lands after the chain, but the Chain Links of that duelist must not act. This sentence is only about Chain Links. Until the chain ends, the other cards of a flagged duelist stay on the field and their ongoing effects still apply. A Chain Link that has already started to resolve when its duelist gives up finishes with its effect, because the check is made once, when the link starts to resolve.
- **A turn cut short by an elimination counts as an ended turn** for every turn count (for example `RESET_OPPO_TURN`): when the turn player loses in its own turn, a card such as Nightmare's Steelcage ends exactly as if that turn had reached its End Phase.
- `[R-FFA-WINNER]` The last duelist left wins.

## Decisions added on 2026-09-30 (product owner)

- Chain response order in free-for-all: the turn player responds first after each Chain Link, then clockwise (see above). 2v2 keeps the official Tag rule (the opposing team responds first).
- Each duelist has their own two EMZ (see above).
- The Chain Links of an eliminated duelist resolve with no effect.
- A partner is never "your opponent". "All" and both-side effects include the partner.
- Negation and partners: in 2v2 Tag, a card that negates an activation, an effect or a summon cannot negate the partner's. In free-for-all it can negate any duelist. Your own activation stays as in 1v1.
- `[R-COMMON-CONT-NEG]` Continuous negation and lock effects (for example Jinzo, which negates all Traps) apply to every duelist at every table, the partner included. The partner rule above is only for a card that negates one activation, effect or summon.

## Card decisions (2026-10-01, product owner)

- **"You win" cards are forbidden in free-for-all and in Tag.** The deck check refuses all 17 cards that end the duel with a plain win: True Exodia, Relay Soul, Exodius the Ultimate Forbidden Lord, Holactie the Creator of Light, Number iC1000: Numerounius Numerounia, Exodia, the Legendary Defender, Ghostrick Angel of Mischief, Number C88: Gimmick Puppet Disaster Leo, Flying Elephant, F.A. Winners, Summer Schoolwork Successful!, Vennominaga the Deity of Poisonous Snakes, Jackpot 7, Destiny Board, Musical Sumo Dice Games, Phantasm Spiral Assault and Number 88: Gimmick Puppet of Leo. Exodia the Forbidden One, Final Countdown and Last Turn were already forbidden, so every script that calls `Duel.Win` is now on the list.
- **Kaiju and Lava Golem: the card goes to the field of the player whose monster was Tributed.** This holds for every card that has the "Tribute a monster of an opponent, Special Summon to that field" procedure: the 7 Kaiju (Gameciel, Radian, Kumongous, Gadarla, Thunder King, Jizukiru, Dogoran), Lava Golem, Volcanic Queen, Alien Skull, Santa Claws, Surgical Striker - H.A.M.P. (for its opponent-field procedure), and The Winged Dragon of Ra - Sphere Mode (added 2026-10-01: all Tributed monsters come from ONE opponent, and it goes to that field). Lava Golem must Tribute 2 monsters of the same opponent. In Tag, the Tributed monster belongs to an opposing member, so the card goes to that member's field. The Kaiju summon with no Tribute needs a Kaiju on the field of any opponent and goes to your own field.
- **Pineapple Blast and Evenly Matched: one opponent in free-for-all, joined fields in Tag.** In free-for-all, the activating player picks ONE opponent when they activate it (R-COMMON-OPP-PICK). The card compares you with that opponent's field only, and only that opponent's cards are affected. That opponent chooses their own cards, as in 1v1. In Tag, the fields of the two opposing members are joined: the count uses the cards of both together against the cards of your own team. The picked opposing duelist makes the choice from the joined field (one chooser, see question 5 below). This is the rule for all count and compare cards (question 2 below).
- **A summon to the field of an opponent: the summoning player picks one opponent.** This holds for every card whose Special Summon puts the card, or its tokens, on the field of an opponent. Examples: Jormungardr the Nordic Serpent, Fenrir the Nordic Wolf, Grinder Golem and Fallen of Argyros (summon procedures), and the cards with an effect that summons to an opponent's field (for example the Ojama token cards). The pick is made when the player summons. In Tag, the opponent is an opposing member. The Kaiju and Lava cards keep the Tribute rule above. The Winged Dragon of Ra - Sphere Mode is not in this group: it follows the Tribute rule (question 8 below).
- **The other cards use the defaults.** Messenger of Peace: the 100 LP is paid only in your own Standby Phase (in Tag, the Standby Phase of your own duelist turn, and the team LP pays). Royal Tribute: every opponent discards the monsters in their hand, and in Tag 'both players' means every duelist, the partner included. Soul Exchange: you may Tribute 1 monster of any opponent. Snatch Steal: the owner of the monster gains the LP, in the own Standby Phase of that owner.

### Answers to the ten triage questions (2026-10-01, product owner)

The triage of 457 cards that needed a product decision is in `.status/multiplayer-triage.md`. The owner answered its ten questions. Questions 2 and 5 are answered with a different rule than the one proposed there.

1. **Turn count (Q1): option (a), rule R3.** Every turn of any opponent counts as one opponent turn. In Tag, only a turn of the two opposing duelists counts. About 30 cards use `RESET_OPPO_TURN` with a count of 2 or more, and they get shorter in rounds (N/2 rounds with 3 players and in Tag, N/3 rounds with 4 players). The review `.status/multiplayer-turncount-review.md` rated all 30 cards and 24 more cards with an own counter: **no new bans**. Some cards are on a WATCH list (stronger but fair, for example Double Payback, Magical Spring, Memory of an Adversary, Steel Scorpion, Extinction on Schedule, Clock Tower Prison, Life Shaver, Vain Betrayer). They stay legal. **The 5 existing free-for-all turn-count bans stay**: Swords of Revealing Light, Doom Virus Dragon, The Wicked Avatar, Grisaille Prison and Million-Century Ice Prison. The owner did not ask to change them. Destiny Board is already forbidden (alternative win). R3 is not the same as `[R-TAG-TURN-COUNT]`, which counts every duelist turn, own team included.
2. **Count and compare cards (Q2): changed meaning.** "Your opponent controls more ..." and the cards that compare field, hand or card counts (about 50, for example Evenly Matched and Pineapple Blast) do **not** add all opponents together. In free-for-all, the activator **picks ONE opponent** when they activate the card (bind), and the card compares with that opponent only. In Tag, the card compares with the **combined** field or hand of the two opposing duelists (the opposing team). This replaces the proposal "add all opponents together". The "field hits all" rule above stays for every other card.
3. **"Each player" (Q3): accepted.** "Each player" is every living duelist, the Tag partner included (rule R1, `[R-COMMON-EACH-PLAYER]`).
4. **Duel-style cards (Q4): accepted.** Ante, Dragged Down, Dice Jar, Reversal Quiz, Trading Places and the other cards of this kind (about 80) act on you and one picked opponent. The other opponents do nothing. Tag uses the team LP.
5. **"Your opponent chooses" (Q5): changed meaning.** When the card text says "your opponent" in the singular, **ONE opponent chooses**: the picked or bound opponent, in free-for-all and in Tag. Only when the card text says "all" or "each" opponent do all of them choose. This replaces rule R4 of the triage ("each affected opponent chooses from their own cards"). The core design rule is the same: `Select*(1-tp)` makes the bound opponent choose.
6. **Per-player flags and counters (Q6): accepted.** The key is the team in Tag and the seat in free-for-all (rule R2).
7. **Swap of control (Q7): accepted.** The activator may pick a monster of any opponent. The swap is always between one of your own monsters and that monster. Mirror Gate needs a script fix (see question 10).
8. **Tribute of an opponent monster (Q8): accepted, with more.** The "Tribute a monster your opponent controls" effects (`EXTRA_RELEASE`, rule R5) work for the monsters of any opponent. This is a core fix: the engine found only the monsters of seat 1 before. It includes the Kaiju, Lava Golem and **The Winged Dragon of Ra - Sphere Mode**. For Ra Sphere Mode, all Tributed monsters come from ONE opponent, and the monster goes to the field of that opponent. Ra Sphere Mode therefore follows the Kaiju and Lava Golem rule (the Kaiju bullet above). It does not follow the rule "the summoning player picks one opponent". The earlier text put it in that group and said it Tributes your own monsters. That was wrong.
9. **Defeated duelists (Q9): accepted.** "Each player" effects skip a duelist who has lost, as `[R-FFA-ELIMINATION]` says.
10. **New bans (Q10): none.** The owner said "make those fixes now". Five cards get a per-card script fix: Contract with Don Thousand, Tsumuha-Kutsunagi the Lord of Swords, Infernoid Tierra, Two-for-One Team and Mirror Gate (it needs a check that the attacked monster belongs to the activating duelist). Two cards get a label fix, because the label must keep the real seat: Curse of the Circle and Wiseman's Chalice. The 5 turn-count bans above are not new. The ban list of the deck check does not change.

These cards stay legal in the deck check. Their rules are listed in `MULTIPLAYER_CARD_RULES` (`packages/duel-server/src/banlists/multiplayer.ts`). `engine: "native"` means that the engine does the rule and a live scenario proves it for that card (the proven tables are in `proven`). `engine: "pending"` means that no live scenario proves it for that card yet. The details, and the list of proven cards, are in `docs/specs/2026-09-30-multiplayer-card-scenarios.md`.

## Open points for the engine test

- The app flow for a team response window in 2v2: both partners see their own options, the team passes only when both pass, and the first activation becomes the Chain Link.
- Which cards need a per-card rule because their text does not fit "field hits all, hand/Deck picks one". The automatic card test suite (ADR-0003) finds and tracks them.

## Consequences

- The EDOPro core supports only two sides. Separate fields for 3 or 4 duelists need core changes; the engine design is a separate decision (see `docs/roadmap.md`, step 1).
- The app model moves from "two seats" to "N duelists in teams": LP per team, one winner or a winning team, N clocks, per-seat privacy with a partner rule, and a multi-field layout.
