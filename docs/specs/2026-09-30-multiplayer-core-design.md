# Multiplayer core design: one ygopro-core for 1v1, 2v2 Tag, 3FFA and 4FFA

Status: implemented. This is the design rationale. The core is built as 91 patches in `packages/duel-server/domain-core/patches` (numbered 0001 to 0100, with gaps). The Standard and Domain multi cores (`ocgcore.multi.wasm`, `ocgcore.multi-domain.wasm`; `src/engine.ts`) are deployed and run behind `MULTIPLAYER_TABLES` (Compose default on). Architecture overview: `docs/architecture.md`.
Date: 2026-09-30.
Rules source: `docs/adr/0002-multiplayer-duel-rules.md` (this document follows it exactly).
Test source: `docs/adr/0003-duel-test-layers.md`.

All core citations are `file:line` in edo9300/ygopro-core at the pinned commit
`efc21aa433b88cd35b7c37db4072a35c58d9d435` (`packages/duel-server/domain-core/pins.json`).
All script citations are files in `data/duel-engine/card-scripts/official/` (13,541 `c*.lua` files;
22,754 across all script directories). No native compile experiment was run. All numbers below come
from reading the core source and from grep over the script tree.

---

## 0. Summary and verdict

The proposed architecture is sound and should be built, with four changes:

1. **Keep the two-sided perspective (P to 0, opponents to 1), but fold the partner into "me" for all player values.**
   Script statistics decide this (section 1.3). Exact partner identity is available through a new API and
   through core legality checks, not through the raw player number.
2. **Store all player references inside the core as absolute duelist ids. Translate only at the Lua boundary.**
   A single "perspective scope" object is pushed on every core-to-Lua entry and popped on exit. It is restored when a chain link
   coroutine resumes.
3. **Bind the single opponent lazily, stored on the chain link.** Precedence: explicit pick, then event opponent, then a
   prompt on first single-opponent access. Operation-info players are stored absolute and translated per reader.
4. **Replace the text patcher (`apply-domain-patch.mjs`, 1007 lines) with a forked core branch and a `git am` patch series.**
   The N-duelist change touches about 1,000 lines across 15 files. A string patcher cannot carry that safely.

Estimated script outcome on the 13,541 official scripts (grep-based, section 1.4):
about 47% work unchanged, about 40% work through core-level rules, about 7% need a per-card override, and about 5% are unknown
until a scenario or fuzz run shows them. The per-card override list is the main long-term cost. It is bounded and testable
(Layer 1 scenarios, Layer 2 fuzz).

The hardest parts, in order: (a) Lua player translation for "each player" and global-state scripts,
(b) 2v2 response order and team LP, (c) the wire ABI (zone masks are 32-bit and hold only 2 players),
(d) keeping 1v1 byte-identical with stock.

---

## 1. Verdict on the perspective approach

### 1.1 What the approach is

Every script is written for two players. The script calls `Duel.Draw(tp, ...)`, `Duel.GetFieldGroup(tp, 0, LOCATION_MZONE)`,
`rp == 1 - tp`, and so on. The core has N duelists. At each core-to-Lua call the core chooses a perspective player P
(the controller of the running effect). The fold function maps:

- every duelist on P's team (including P) to 0;
- every duelist on another team to 1;
- `PLAYER_NONE` (2) and `PLAYER_ALL` (3) stay unchanged.

Every value that goes into Lua is folded. Every player value that comes back from Lua is unfolded:
0 becomes P (or the team member the context names), 1 becomes "the opponent set" or "the bound opponent" by the rule of the API
(section 4).

### 1.2 Why it works

- The scripts already contain one implicit rule: only tests `x == tp`, `x == 1 - tp`, `x ~= tp`, and arithmetic on 0 and 1.
  A two-sided fold preserves all of them.
- Field queries (`GetFieldGroup(tp, 0, ...)`) are sets. The union of opponents is the natural meaning of "opponent's side".
  ADR-0002: "opponent effects hit all duelists on the field".
- Script code does not need to change for any card that does not select a single opponent for a hand, Deck, draw or LP action.

### 1.3 The partner decision (recommended: fold the partner to 0 everywhere)

The request was that `rp == tp` should mean "I activated". The partner cannot be both "me" for `rp == tp` and "not me" for
`rp ~= tp` without breaking one class. Script grep shows which class is larger:

| Pattern (official scripts) | Files | Meaning |
|---|---|---|
| `ep ~= tp` or `rp ~= tp` | 356 | opponent test |
| `ep == 1-tp` or `rp == 1-tp` | 622 | opponent test |
| `ep == tp` or `rp == tp` | 283 | self test |

The opponent tests are more than three times the self tests. Two designs are possible:

- **Fold the partner to 0.** A partner activation then looks like "my own activation" to the script. Effect Veiler
  and Infinite Impermanence (`c97268402.lua`, `c10045474.lua`) target only an opponent's monster, so they cannot target
  the partner's monster. Ash Blossom (`c14558127.lua`) and Solemn Judgment (`c41420027.lua`) have no player check. The
  fold alone would let them negate the partner's activation or summon. The product rule (2026-09-30) forbids that in Tag,
  so a core rule blocks it (see requirement 3 below). In FFA they negate any duelist.
- **Fold the partner to 1.** A partner's activation triggers every "opponent activated" card on the team. This is wrong for the
  majority of tests and would need an override on more than 900 scripts.

Decision: fold the partner to 0. The partner becomes "me" for `ep`, `rp`, turn player, summon player, handler,
controller and owner. ADR-0002 says the partner's cards count for "you control", "your field" and "your GY", and this
matches. Three exact-identity requirements are then handled outside the fold:

1. **"Cannot activate partner cards."** The core legality check uses the absolute id.
   `chain.triggering_player` stays absolute inside the core. A new predicate (`effect::is_activate_by_duelist`) runs at
   activation in `is_activateable` and in the chain-selection code path. No script is involved.
2. **Cards that need exact identity** (for example `GetControl(tc, tc:GetOwner())`, scripts that return a card to
   its owner). Add `Card.GetOwnerDuelist()`, `Card.GetControllerDuelist()` and `Duel.GetDuelistOf(p)`
   for overrides. The fold of `GetOwner()` maps a partner-owned card to 0. `GetControl(tc, 0)` then gives the
   card to P, not to the partner. That is a rules mistake for 311 scripts that use `GetOwner()`
   (most only compare it). These go in the "unknown" bucket until the fuzz layer flags them.
3. **"Cannot negate the partner" (Tag only, product owner 2026-09-30).** A card that negates an activation, an effect or
   a summon cannot negate the partner's. In FFA it can negate any duelist, and in all tables it can negate the own
   activation, as in 1v1. The core rule: in Tag, an effect with `CATEGORY_NEGATE`, `CATEGORY_DISABLE` or
   `CATEGORY_DISABLE_SUMMON` whose code is `EVENT_CHAINING`, `EVENT_SUMMON`, `EVENT_FLIP_SUMMON` or `EVENT_SPSUMMON` is not
   activatable when the absolute `event_player` of that event is the partner of the activating duelist. For
   `EVENT_CHAINING` the core raises the event with `event_player = triggering_player` of the link. For the summon events it
   is the summon player. The check runs in `effect::is_activateable` next to requirement 1, before the script condition.
   A script grep finds about 260 scripts with a negate category, a chaining or summon code and no player test (heuristic:
   Solemn Judgment, Solemn Warning, Solemn Strike, Ash Blossom, Magic Jammer, Seven Tools of the Bandit, Horn of Heaven,
   Divine Wrath, Stardust Dragon). The core rule covers all of them, so they need no override. A card whose negation is not
   about the triggering link gets a per-card override if the fuzz layer or a scenario finds one. Continuous negation and
   lock effects (for example Jinzo `c77585513.lua`) are not chaining or summon events, so the rule does not touch them. They
   affect every duelist, the partner included (product owner, 2026-09-30).

**"All" and both-side effects (product owner, 2026-09-30).** An effect on "your opponent" must never hit the partner, and an
effect on "all" cards or on both sides of the field must hit every duelist, the partner and the activator included. The fold
gives both without a special case. Dark Hole (`c53129443.lua`) destroys `Duel.GetMatchingGroup(aux.TRUE, tp, LOCATION_MZONE, LOCATION_MZONE, nil)`.
The self side (`LOCATION_MZONE` in the first slot) is team-wide (section 3.4), so it holds P's and the partner's monsters. The
opponent side (the second slot) is the union of all opponents. The result is every monster on every field. An opponent-only
effect such as Raigeki (`0, LOCATION_MZONE`) gets only the union of opponents. Layer 1 must have one scenario of each kind for
Tag and for FFA.

### 1.4 Script walk-through (51 scripts) and corpus estimate

Classes: **U** works unchanged; **C** works through a core-level rule (fold, union query, binding); **O** needs a per-card
override; **?** unknown. The sample was read through targeted grep of player-bearing lines and, for the first 24, a full read.

| # | Card (file) | Class | Reason |
|---|---|---|---|
| 1 | Raigeki `c12580477.lua` | C | opponent monster group: union of all opponents |
| 2 | Dark Hole `c53129443.lua` | U | both fields, symmetric |
| 3 | Harpie's Feather Duster `c18144506.lua` | C | opponent Spell/Trap group: union |
| 4 | Heavy Storm `c19613556.lua` | U | `LOCATION_ONFIELD, LOCATION_ONFIELD` |
| 5 | Pot of Greed `c55144522.lua` | U | `Duel.Draw(tp)`: individual, P |
| 6 | Graceful Charity `c79571449.lua` | U | draw and discard for P |
| 7 | Hand Destruction `c74519184.lua` | O | `PLAYER_ALL` draw and discard: N-way loop |
| 8 | Mind Crush `c15800838.lua` | C | opponent hand: bound opponent |
| 9 | Card Destruction `c72892473.lua` | O | lines 19-31: `Draw(tp)`, `Draw(1-tp)`, `PLAYER_ALL` info |
| 10 | Monster Reborn `c83764718.lua` | U | both GYs, summon to own field |
| 11 | Change of Heart `c4031928.lua` | C | opponent monster target, `GetControl` to P |
| 12 | Mirror Force `c44095762.lua` | C | opponent attack position group: union |
| 13 | Torrential Tribute `c53582587.lua` | U | all monsters |
| 14 | Solemn Judgment `c41420027.lua` | C | no player check. Tag: cannot negate the partner (1.3, requirement 3). FFA: any duelist. LP cost: team LP in Tag (R7) |
| 15 | Ash Blossom `c14558127.lua` | C | no player check. Tag: cannot negate the partner (1.3, requirement 3). FFA: any duelist |
| 16 | Maxx "C" `c23434538.lua` | C | opponent Special Summon test: a partner's summon does not trigger the draw |
| 17 | Effect Veiler `c97268402.lua` | C | `rp == 1-tp` |
| 18 | Infinite Impermanence `c10045474.lua` | C | opponent monster target, union |
| 19 | Book of Moon `c14087893.lua` | U | field target, any side |
| 20 | Swords of Revealing Light `c72302403.lua` | O | counts opponent turns, needs turn order (section 3.6) |
| 21 | Messenger of Peace `c44656491.lua` | O | pays LP on `IsTurnPlayer(tp)`: team turn semantics |
| 22 | Skill Drain `c82732705.lua` | U | field-wide effect |
| 23 | Cyber Dragon `c70095154.lua` | C | opponent-only control test, own-side summon |
| 24 | Chaos Emperor Dragon `c82301904.lua` | O | damage to each player and GY/hand banish loop |
| 25 | Final Countdown `c95308449.lua` | O | `Duel.Win` and a turn counter |
| 26 | Exodia the Forbidden One `c33396948.lua` | O | `Duel.Win(tp)`: win target must be a team |
| 27 | Dimensional Fissure `c81674782.lua` | U | `SetTargetRange(0xff,0xff)` |
| 28 | Macro Cosmos `c30241314.lua` | U | `SetTargetRange(0xff,0xff)` |
| 29 | Kaiser Colosseum `c35059553.lua` | O | lines 16, 24, 36: counts monsters per side |
| 30 | Lava Golem `c102380.lua` | O | summons to the opponent field, damage on own turn |
| 31 | Makyura the Destructor `c21593977.lua` | U | `LOCATION_HAND, 0`: own hand |
| 32 | Snatch Steal `c45986603.lua` | C | `SetTargetPlayer(1-tp)`: bind to the monster's previous controller |
| 33 | Knightmare Phoenix `c2857636.lua` | C | opponent Spell/Trap target |
| 34 | Borreload Dragon `c31833038.lua` | C | `IsControler(1-tp)`, `GetControl(tc, tp)` |
| 35 | Sangan `c26202165.lua` | C | `ConfirmCards(1-tp)` reveals to all opponents |
| 36 | Dark Magic Attack `c2314238.lua` | C | opponent Spell/Trap group |
| 37 | Prohibition `c43711255.lua` | U | `SetTargetRange(0x7f,0x7f)` |
| 38 | Cosmic Cyclone `c8267140.lua` | U | `LOCATION_ONFIELD, LOCATION_ONFIELD` |
| 39 | Nibiru `c27204311.lua` | O | `GlobalCheck` flag counter per player; tokens to `1-tp` |
| 40 | Droll & Lock Bird `c94145021.lua` | O | `GlobalCheck`; line 35 maps draw events through `{0,1,PLAYER_ALL}` |
| 41 | Imperial Order `c61740673.lua` | U | `SetTargetRange(LOCATION_SZONE, LOCATION_SZONE)` |
| 42 | Crush Card Virus `c57728570.lua` | O | lines 46-63: opponent hand, Deck and field each with its own chooser |
| 43 | Ring of Destruction `c83555666.lua` | O | lines 25-41: damage to both, `GetLP(1-tp)` needs a bound opponent |
| 44 | Soul Exchange `c68005187.lua` | O | uses the opponent's monster as a Tribute and summons on the opponent field |
| 45 | Destiny Draw `c45809008.lua` | U | `SetTargetPlayer(tp)` |
| 46 | Creature Swap `c31036355.lua` | O | lines 28-31: a second chooser `1-tp` |
| 47 | Pendulum Area `c2359348.lua` | U | range `(1,1)`: each duelist individually |
| 48 | Toon World `c15259703.lua` | U | own LP cost |
| 49 | Yubel `c78371393.lua` | C | lines 70-77: damage to the attacker's controller (event opponent) |
| 50 | Dimension Shifter `c91800273.lua` | U | `SetTargetRange(0xff,0xff)` |
| 51 | Apollousa `c4280258.lua` | C | line 44: `rp == 1-tp` |

Sample: 18 U, 18 C, 15 O, 0 unknown. The sample is biased toward famous interactive cards. The corpus estimate below is
less optimistic about O and more honest about "unknown".

Corpus estimate over 13,541 official scripts (every number is a file count from `grep -l`):

| Measure | Files |
|---|---|
| Any opponent reference (`1-tp`, `,0,LOCATION`, `PLAYER_ALL`, turn player) | 7,155 |
| No opponent reference at all (class U) | 6,386 (47%) |
| `PLAYER_ALL` | 226 |
| `Duel.Win` | 20 |
| `GlobalCheck` | 207 |
| `GetOwner()` | 311 |
| `IsTurnPlayer`, `GetTurnPlayer`, `GetTurnCount` | 1,376 |
| Single-opponent hand, Deck, draw, damage, recover, LP, confirm, `SetTargetPlayer`, op-info with `1-tp` | 3,821 (binding sites; most resolve by event opponent) |
| Hand/Deck/Extra group queries on a side | 314 |
| A second chooser `Select...(1-tp, ...)` | 125 |
| Special Summon to `1-tp` | 123 |
| `Duel.Damage(1-tp / p, ...)` | 733 |
| Union of `PLAYER_ALL`, `Win`, `TurnPlayers`, `for p=0,1`, `GetOwner` | 554 |
| Same union plus `GlobalCheck`, `tp==0/1` literals and `SetCounterLimit` | 777 |

Buckets (official):

- **U, unchanged: about 47%** (6,386). They never mention the opponent.
- **C, core-level rule: about 40%.** Opponent field queries, `rp`/`ep` tests, event opponent damage and the binding cases.
- **O, per-card override: about 7%** (900 to 1,100). `PLAYER_ALL` (226), `Duel.Win` (20), per-player global state
  (45 scripts index a table by a player variable; 200 register `GlobalCheck` with player 0), second-chooser cards (125), summon to the
  opponent field (123), turn-counter cards.
- **? unknown: about 5%** (600 to 700). `GetOwner()` users, label-stored player numbers (`SetLabel(p)`), scripts that compare
  to literal 0 or 1, and turn-player tests inside Tag turn rules.

Other script directories (rush 3,119, skill 174, unofficial 5,530, goat 191, pre-release 129, pre-errata 68) follow the same
shape. Skill scripts (174) are all O until proved: they register effects for player numbers directly. Domain Format does not
use them. Blocked by a format check.

### 1.5 Where the approach fails (known classes)

1. **"Each player" cards** (`PLAYER_ALL`, 226): the script does `Draw(tp)`, then `Draw(1-tp)`. Under the fold this does
   tp, then one opponent. ADR-0002 requires all duelists. They need an N-way override (`for p in Duel.EachPlayer(tp)`).
2. **Global state and `GlobalCheck`** (207): state is in a Lua table keyed by a player. A raw id 2 or 3 collides with
   `PLAYER_NONE` (2) and `PLAYER_ALL` (3). Folding merges O1 and O2 counters. These scripts run in a
   **global perspective** (`P = absolute`, no fold) for the registration phase. Their counters use absolute ids 0-3 through a new
   `Duel.GetDuelistId(p)`. Scripts in this class need a per-card edit.
3. **`Duel.Win` and `MSG_WIN`** carry one player (`processor.cpp:4424-4430`, `processor.cpp:4716-4722`). They need a team
   argument and a `WINNER` bitmask.
4. **Multi-opponent choosers**: `Duel.SelectMatchingCard(1-tp, ...)` (125 scripts, for example `c11819473.lua:65`,
   `c12247206.lua:64`, `c12292422.lua:50`) picks one chooser. In 2v2 and FFA each opponent may choose. The default rule is the bound opponent
   chooses. Cards that say "your opponent" in the text get this rule; cards that say "each opponent" need an override.
5. **Summon to the opponent field** (123): Lava Golem `c102380.lua`, Soul Exchange `c68005187.lua`: the target must be a bound
   opponent. The bound-opponent rule (section 4) applies.
6. **Turn-counter cards**: Swords of Revealing Light counts turns of the opponent; in a four-duelist cycle this is three other
   turns. Messenger of Peace pays on `IsTurnPlayer(tp)`; with the fold, a partner's turn looks like "my turn".
   Both need an override that counts team turns or duelist turns by the card text.

The main conclusion: the fold is correct for about 87% of scripts without any change. The rest form a finite list that
Layer 1 scenarios can test card by card.

---

## 2. Core data-structure changes

### 2.1 Current state (stock)

- `std::array<player_info,2> player` at `field.h:400`.
- About 28 other arrays of size 2 (`cost[2]`, `effects ... [2]`, counters and flags in `processor_unit.h`/`field.h`).
- About 194 lines with `1 - x`, 37 loops `p < 2`, about 180 comparisons with 1 or 2.
- `PLAYER_NONE = 2` at `ocgapi_constants.h:363`; `PLAYER_ALL = 3`.
- `OCG_DuelOptions` carries only `team1` and `team2` (`ocgapi_types.h:67-68`). `OCG_NewCardInfo.duelist`
  exists, but only `DECK` and `EXTRA` use it (`ocgapi_types.h:82`).
- Native tag mode is a shared field with swaps of hand, Deck and Extra (`field.cpp:1129`, `field.cpp:1192`,
  `processor.cpp:3337`). We do not use it: ADR-0002 requires full separate fields.

### 2.2 New model

Add to `duel.h`/`field.h`:

```text
constexpr uint8_t MAX_DUELISTS = 4;
struct team_info { int32_t lp, start_lp; uint8_t members[2]; uint8_t count; };   // shared LP in Tag
struct duelist_info = existing player_info + { uint8_t team; bool eliminated; };
std::array<player_info, MAX_DUELISTS> player;   // absolute duelist id 0..3
std::array<team_info, MAX_DUELISTS> team;       // T <= 4
uint8_t n_duelists, n_teams;
uint8_t turn_order[MAX_DUELISTS];               // explicit order (Tag: 1A,2A,1B,2B; FFA: clockwise)
uint8_t turn_index;
```

Rules:

- **PLAYER_NONE and PLAYER_ALL must keep their numeric values** (Lua compatibility). Inside the core, use
  `DUELIST_NONE = 0xFF` and `DUELIST_ALL = 0xFE` as core-private values. Translate at the boundary. A 4-duelist system cannot
  reuse 2 and 3 as core ids.
- **Teams:** `lp` is per team (ADR-0002: 16,000 in Tag). `player_info.lp` becomes a reference to `team[t].lp`. In FFA each duelist
  is a team of one. 1v1 is two teams of one. All LP code (`MSG_LPUPDATE`, `MSG_DAMAGE`, pay LP, `check_lp_cost`) uses
  `team_of(p).lp`.
- **Helpers** (replace every `1 - x`):

```text
same_team(a, b)              opposing(a, b)
opponents_of(p) -> mask      team_of(p)
next_turn_player()           prev_in_turn_order(p)
for_each_duelist(fn)         for_each_opponent(p, fn)
```

- **Mechanical refactor scale:** `1 - x` (194 lines) maps to `opponent_of(x)` only when one opponent is meaningful;
  otherwise to `for_each_opponent`. About 140 of the 194 sites are one of: turn-player opposite, chain-opponent opposite,
  damage-opponent. The other 54 need a human decision. A clang-tidy or coccinelle script lists them.
- **Processor state:** `core.spe_effect[2]`, `core.hint_timing[2]`, `core.select_chains` owner, `core.chain_limit` owner,
  `core.current_player`, `core.quick_f_chain` player tests (`processor.cpp:943-975`) all become arrays of `MAX_DUELISTS`.
- **Card state:** `card::current.controler`, `owner`, `previous.controler`, `summon_player`, `reason_player`, `spsummon_counter[2]`,
  `attack_controler`, and `assume` values widen from 1 bit of meaning to 2 bits (uint8_t already holds them, but bit tricks such as
  `controler ^ 1` must be found by grep).
- **Elimination:** `eliminate(p)` removes the duelist's cards from the game (ADR-0002) through a silent "to removed, no effect"
  path and emits a new message (section 7.4).

### 2.3 Domain patch interaction

`domain_master.cpp` has `playerid > 1` guards at lines 50, 56, 75, 159 and 199, and the loop `for(playerid < 2)` at line 281.
All become `>= MAX_DUELISTS` and `n_duelists`. The Domain code already indexes `player[p]`, so it does not need a structural
change (section 8).

---

## 3. Lua boundary inventory and translation rules

### 3.1 The boundary

Script-visible libraries: `Duel` (241 functions, 164 take a player argument), `Card` (262), `Effect` (57), `Group` (48).
Core to Lua entry points: `interpreter::call_function` (`interpreter.cpp:389,399`), `call_card_function` (`:410`),
`call_coroutine` (`:571`) and the `check_condition`, `get_function_value`, `check_matching` wrappers (`:440`, `:526`, `:542`).
There are about 10 wrapper entry points and everything enters through `call_function(int, int)` at `interpreter.cpp:389`.

### 3.2 Perspective scope

```text
struct perspective_scope {           // RAII
  perspective_scope(duel*, uint8_t P, mode m);   // mode = FOLDED | GLOBAL
  ~perspective_scope();                          // restores the previous P
};
```

- Constructed in `call_function` with P taken from the context: running effect controller, or for card init,
  the `GLOBAL` mode.
- **Effects evaluated outside a chain** (continuous field effects, `value` functions, target functions, `EFFECT_TYPE_FIELD`
  conditions, `adjust`): P is `effect::get_handler_player()` (the controller of the handler card). Code sites:
  `effect.cpp:452` and `effect.cpp:473`. Nested filter callbacks (for example `Card.IsFaceup` filters called from `GetMatchingGroup`) inherit P.
- **Chains:** the link stores `triggering_player` (absolute). On resume, the coroutine re-enters with the link's P
  (`interpreter.cpp:571`). This is why a stack is not enough: the coroutine resume happens in another processor step.
- **Triggers for events:** `ep`, `rp`, `ev` are folded for the trigger owner P (the controller of the responding effect), not for the event
  player. The same event gives different `ep` values to different listeners. That is correct.

### 3.3 Translation rules

| Direction | Value | Rule |
|---|---|---|
| Core to Lua | duelist id d | `team_of(d) == team_of(P) ? 0 : 1` |
| Core to Lua | NONE, ALL | 2, 3 |
| Lua to core | 0 | P (or the named team member, see 3.4) |
| Lua to core | 1 | field, GY, banish: union of opponents; hand, Deck, Extra, draw, damage, recover, discard, mill, LP: the bound opponent (section 4) |
| Lua to core | 2, 3 | NONE, ALL |
| Zone masks | per player 16-bit groups | fold side: bits for team(P) and for opponents, unfolded per query |

### 3.4 Handler arguments and partner semantics

- `e:GetHandlerPlayer()`, `c:GetControler()`, `c:GetOwner()`, `c:GetSummonPlayer()`, `c:GetReasonPlayer()`, `ep`, `rp`:
  folded. The partner is 0.
- `Duel.GetTurnPlayer()`, `Duel.IsTurnPlayer(p)`: folded. Partner turn is "my turn". Turn-counter cards need an override.
- Query team scope (ADR-0002): **field, GY, banish are team-wide.** `GetFieldGroup(tp, LOCATION_MZONE, 0)` returns the cards of the whole team.
  **Hand, Deck, Extra, zone counts, placement zones, Pendulum zones, activity counters are individual.** Unfolded `0` in
  an individual query means P, never the partner. A query in a team-wide location that names P also contains the partner.
- Summon, set and place calls with target `0`: P's field. A card can be given to the partner only through the new API
  `Duel.SpecialSummonToDuelist(...)` (for overrides).
- Continuous field effects use `same_team(handler_player, card.controler)` instead of equality
  (`effect.cpp:452`), and `is_target_player` (`effect.cpp:473`) uses team membership for `s_range` (individual for
  `PLAYER_TARGET`), and "any duelist on an opposing team" for `o_range`.
- **Partner cards cannot be activated:** in `effect::is_activateable` the check is `handler.controler == activating duelist`
  (absolute). Partner cards remain valid for costs, Tributes, materials and targets.
- **Partner activations and summons cannot be negated (Tag):** in the same function, a negate-category effect on a chaining or
  summon event is not activatable when the absolute event player is the partner (section 1.3, requirement 3). FFA has no partner,
  so the check never applies there.

### 3.5 Unfolding "1" (the rule-class table)

| API class | Examples | "1" means |
|---|---|---|
| Field, GY, banish queries | `GetFieldGroup(tp,0,...)`, `IsExistingMatchingCard`, `SelectTarget` | union of opposing duelists' cards |
| Hand, Deck, Extra | `GetFieldGroup(tp,0,LOCATION_HAND)` | bound opponent only |
| Draw, discard, mill, damage, recover, `SetLP`, `GetLP` | `Duel.Draw(1-tp)`, `Duel.Damage(1-tp)` | bound opponent (Tag: their team LP) |
| `ConfirmCards(1-tp, g)` | Sangan `c26202165.lua:32` | all opponents (they all see it) |
| `Select*(1-tp)` choosers | `c31036355.lua:31` | bound opponent chooses |
| `Duel.Hint(..., 1-tp)` | hints | all opponents |
| Summon, control, set on field `1-tp` | `c102380.lua`, `c68005187.lua` | bound opponent's field |

### 3.6 Turn, phase and counter API additions (for overrides only)

`Duel.GetDuelistCount()`, `Duel.GetTeamCount()`, `Duel.EachPlayer(tp)` (iterates absolute ids in turn order), `Duel.GetTeamMembers(p)`,
`Duel.GetDuelistId(p)`, `Duel.GetTurnOrderIndex(p)`, `Duel.WinTeam(mask, reason)`. These are the only new script-visible functions.
`Duel.AskEveryone` and `Duel.AskAny` in `utility.lua:2503-2540` use `TagSwap` and need a rewrite.

---

## 4. Opponent binding

### 4.1 The problem

ADR-0002: hand, Deck, draw and LP effects pick one opponent at activation. The script says "1". The core must know which duelist.

### 4.2 Recommendation

Store `bound_opponent` on the chain link. Precedence:

1. **Explicit pick at activation.** The activation flow asks the activating duelist for an opponent (a select-player prompt) only when
   (a) more than one opponent exists, (b) no earlier rule binds, and (c) the effect needs one (see step 3).
2. **Event opponent, bound automatically.** `event_player` (when an opponent), `reason_player`, the attacker's controller,
   the previous controller of a monster that moved, the controller of the chosen target. This covers Yubel `c78371393.lua:70`, Snatch Steal `c45986603.lua:37`
   and most damage and recover cards.
3. **Lazy prompt on first single-opponent access** in cost or target code (for example `Duel.GetLP(1-tp)` in Ring of Destruction
   `c83555666.lua:25`). The prompt goes to P. The answer is stored on the link.
4. **`SetOperationInfo(0, cat, nil, 0, 1-tp, n)`** triggers binding at target time. The operation info is stored with the **absolute**
   duelist and translated for each reader, because the chain reader (Ash Blossom, Solemn) may be another team.
5. **Resolution-time fallback:** if no binding exists at resolution (effects that call `1-tp` only in the operation), the
   activating duelist is prompted then (never an automatic pick), and a log line records it. The fuzz layer counts this path per card;
   each hit is a card that must move to the activation-time list (see review note R1).

### 4.3 Why lazy binding instead of "always ask at activation"

An activation prompt for every card is wrong: 47% of scripts never use an opponent, and 40% of the rest bind by event.
Always asking would add a prompt to Raigeki. The lazy approach asks only when a script proves it needs a single opponent, in
cost or target time. The cost of laziness: a prompt can appear in the middle of a cost. The core handles this with a nested
`SelectPlayer` processor unit (same mechanism as `SelectEffectYesNo`).

### 4.4 1v1 and two-team degenerate cases

If there is exactly one opponent (1v1, or Tag in which the partner folds to 0 and the two opponents form one team), the
binding is skipped when it is unambiguous. In Tag two opponents exist, so binding is still needed for hand, Deck, draw and
LP (team LP is shared, but a draw is individual).

### 4.5 Rejected: always-ask and opponent-by-seat

- Always ask at activation: noise (section 4.3).
- "Opponent is the next seat clockwise": fails ADR-0002, which lets the player choose.

---

## 5. Battle

Stock battle logic lives in `processor.cpp` (`BattleCommand` at `:1788`, `DamageStep` at `:2865`, `ForcedBattle` at `:2780`).
The attack-ability gate is at `processor.cpp:1463`: `!DUEL_ATTACK_FIRST_TURN && turn_id == 1`.

Changes:

- **First-turn restriction (ADR-0002):** replace `infos.turn_id == 1` with `turn_count_of_duelist[turn_player] == 0 and
  first_round_not_complete`, meaning: the duelist cannot attack until every duelist has taken one turn (FFA) or the first 3 duelists
  have passed (Tag: duelists 1A, 2A, 1B cannot attack; 2B can). One predicate, `attack_locked_by_round(p)`, covers both.
  The stock predicate stays in use for 1v1.
- **Attack target selection** (`get_attack_target` at `processor.cpp:1852,1998,2191,2803`): the target list is the union of
  monsters of all opposing duelists (separate fields). Direct attack needs the target duelist to be picked: add a prompt
  "attack which duelist" when more than one opponent has no monster. `MSG_ATTACK` must carry the target duelist (section 7).
- **Battle damage:** damage goes to the defending duelist's team LP. In Tag the partner's monster can be attacked only as the field of
  that team. The partner's monsters on the defending side are valid targets.
- **Replay and redirect effects** (Mirror Force, Negate Attack, `EFFECT_ATTACK_DISABLED`): work through fold.
- **Attack-related scripts:** "cannot attack" scripts use player ranges with `SetTargetRange(0,1)`. The fold and the same-team
  predicate replace the old equality test.
- **Turn-end and phase:** `Turn` processor (`processor.cpp:3257`) selects the next turn player by `turn_order`, not `1 - tp`.
  `turn_id_by_player` (`:3332`) becomes size `MAX_DUELISTS`.

Extra Monster Zones (decided 2026-09-30, ADR-0002): each duelist has a private EMZ pair on their own field, and the zone mask
encodes it. A duelist may use one of them; the second only as 1v1 allows (a Link Monster points to it). The stock cross-player
mirror check (a monster in one player's EMZ blocks the same column for the other player) does not exist between separate fields.

---

## 6. Chains and priority

### 6.1 Stock logic

`QuickEffect` (`processor.cpp:943-975`) checks `turn_player` first, then `1 - turn_player` (`:944-949`). Trigger ordering
(`PointEvent`, `processor.cpp:587`) uses TP then NTP. Chain windows alternate by `1 - check_player`
(`processor.cpp:494-496`, `:844`). `spe_effect[check_player]` counts options.

### 6.2 New priority order

Define `response_order(link_adder)`, which is computed again after each new Chain Link:

- **1v1:** unchanged (opponent of the adder first, then the adder).
- **FFA (product owner, 2026-10-04; supersedes the 2026-09-30 decision):** after each new link, the order starts
  with the next living seat clockwise after the adder and ends with the adder. A new link clears the previous passes;
  all living seats must pass in a row after the last link to resolve the chain. Eliminated and leaving seats are skipped.
  Example: A activates, B passes, C chains; D responds first, then A, B and C. An open window still starts with the turn
  player. SEGOC and trigger ordering keep their existing rules.
  With 2 duelists this is the same as 1v1.
- **Tag:** ADR-0002 (official Tag rule): the **opposing team responds first**. the opposing team responds first. Within a team, both members get to respond. The initial protocol, simple and ADR-compatible:
  ask the team members in turn order; the first member who has a legal activation may act; both must pass for the team to pass.
  ADR-0002 leaves the 2v2 team response window UI open; the core needs only the order, the UI decides the presentation.

Implementation: replace `check_player` toggling by a cursor over `response_order`. `core.current_player` becomes a
cursor and `core.chain_pass_count` counts consecutive passes. The chain ends when `pass_count == n_active_duelists` (for Tag, all
members of both teams).

### 6.3 Trigger ordering

Stock: TP triggers first, then NTP. Multi-player: turn player, then clockwise in turn order (ADR-0002 FFA). In Tag: turn
player, partner, then the opposing team in turn order. Simultaneous triggers of one duelist are ordered by that duelist (stock behavior).

### 6.4 Chain identity

`chain.triggering_player` stays absolute. `chain.bound_opponent` is new. `chain.opinfo[].player` is absolute. Chain limits
(`core.chain_limit`) carry the owner as absolute and evaluate the limit function in the perspective of the responding duelist.

### 6.5 Priority and fast effects

A duelist with no legal response is skipped silently (stock behavior: `spe_effect[p] == 0` yields automatic pass). Hint timing works per
duelist: array of `MAX_DUELISTS`.

---

## 7. Zones and messages ABI

### 7.1 Current ABI facts

- `MSG_SELECT_PLACE` (18) and `MSG_SELECT_DISFIELD` (24) write `uint8 player`, `uint8 count`, `uint32 flag`
  (`playerop.cpp:562-565`). The flag has 16 bits per player: bits 0-6 monster zones, bits 8-12 spell/trap zones, bits 14-15
  Pendulum zones for player 0, and the same shifted by 16 for player 1 (`playerop.cpp:518-539`). **Two players fill all 32 bits.**
- The response is a list of triples `(player, location, sequence)` (`playerop.cpp:575`), so the response format already carries
  the player byte.
- `MSG_WIN` (5) carries one `uint8 player` (`processor.cpp:4428`). `MSG_NEW_TURN` (40), `MSG_DAMAGE` (91), `MSG_LPUPDATE` (94)
  carry one player byte, `MSG_ATTACK` (110) carries `loc_info` for attacker and target.
- `OCG_DuelQueryCount(duel, team, loc)` at `ocgapi.cpp:140` takes one `team` byte.
- `OCG_NewCardInfo.team` and `duelist` (`ocgapi_types.h:82`) pick the owning side.

### 7.2 Proposed encodings

1. **Zone mask: use a 64-bit mask, one 16-bit group per duelist, group index = absolute duelist id.**
   The wire message gets a new id, `MSG_SELECT_PLACE_N` (`MSG_SELECT_DISFIELD_N`), with `uint8 player`, `uint8 count`,
   `uint64 flag`. The old messages are emitted only when `n_duelists == 2` (1v1 byte-identical with stock).
   The mask bit positions per duelist are unchanged, so the TS decoder reuses its current bit helper with an offset of `16 * duelist`.
   The Lua-side `zone` parameters (for example `Duel.GetLocationCount(tp, loc, p, reason, zone)`, and `0xff` style masks) are
   folded-side masks (two 16-bit halves: team(P), opponents) and unfolded at the boundary. A script bitmask that names the opponent
   field (`zone<<16`) selects all opponents' matching zones. Cards that place on one specific opponent use the bound opponent.
2. **Player fields:** all one-byte player fields stay one byte. Values 0-3 are duelist ids. `0xFF` replaces NONE in the new
   messages. The old 2 and 3 meanings stay only in Lua.
3. **`MSG_WIN_N`:** `uint8 team_mask`, `uint8 reason`. The 1v1 build still emits `MSG_WIN`.
4. **New messages:**
   - `MSG_DUELIST_ELIMINATED` (duelist, reason), sent when a duelist loses in FFA.
   - `MSG_TEAM_LP` (team, lp): LP per team for Tag. `MSG_LPUPDATE`/`MSG_DAMAGE` keep the duelist byte and add the LP of its team.
   - `MSG_ATTACK_N`: attacker `loc_info`, target `loc_info` with the target duelist (direct attacks name the duelist).
   - `MSG_SELECT_OPPONENT` (prompt): list of legal opponents for binding (section 4).
   - `MSG_TURN_ORDER` (once at start): `n`, `ids[n]`, `teams[n]`.
5. **`OCG_DuelOptions`:** add `uint8 n_duelists` and `uint8 team_of[4]` (or `team3`, `team4` with the same struct type). Keep `team1` and
   `team2` for compatibility. The default is `n_duelists = 2`.
6. **`OCG_NewCardInfo`:** `team` is an absolute duelist id (0-3) for the new core; `duelist` remains the original owner index in a team.
7. **`OCG_DuelQueryCount`/`QueryLocation`/`QueryField`:** `team` byte becomes a duelist id (0-3). Add a mask version
   (`OCG_DuelQueryFieldAll`) that returns all duelists in one call for views.
8. **Deck Master zone:** `LOCATION_DECKMASTER` (0x4000) is already per-duelist state. The wrapper message ABI is unchanged (`pins.json`
   notes: it is not encoded in MSG location bytes).

### 7.3 ocgcore-wasm wrapper

The n1xx1 wrapper has a hand-written message parser in TypeScript, a `createDuel` mapping for `OCG_DuelOptions`, and card-info
marshalling. Required changes (fork, tracked like the core):

- `createDuel`: pass `n_duelists` and the team map.
- Parser: new message ids (`MSG_SELECT_PLACE_N`, `MSG_WIN_N`, and the four new messages); widen the place flag to `bigint` or
  to two `uint32`; keep old ids.
- Card-info and query calls: `team` argument is a duelist id.
- The wrapper version in `pins.json` (`ocgcore-wasm@0.1.2`, ref `9f36452f2a2464f057f7fd6e2273aa5ab589401e`) moves to a fork pin.

### 7.4 TypeScript server changes (`packages/duel-server/src`)

- `engine.ts` (607 lines): `addDeck(team: 0 | 1)` (line 137) and the two-team loop (line 253) become duelist loops. `lp[]`
  (lines 379-391) is per team. `MSG_WIN` handling (line 363) maps a mask to winners. Log lines use `message.player + 1`; they must say
  "Player N (Team T)".
- `views.ts` (1,122 lines): `seats` is built from `[0, 1]` (line 1043), `controller: 0 | 1` (lines 188, 194), `sourceSeat` (lines
  448-457), `moveEndVisible` loops (line 647), attack log lines (lines 891-892). All become duelist lists. A `teamOf` map goes into the
  view. Visibility rule: a duelist sees its own hand and Set cards. In Tag, a duelist also sees the partner's hand and Set cards
  (ADR-0002: "Partners may see each other's hands and Set cards"). Opponents' hands, Set cards and Decks stay hidden. "Your hand"
  being individual is a rule about effects, not about visibility.
- `prompts.ts` (963 lines): a place prompt must carry the 64-bit mask and a duelist id per zone ref; add a select-opponent prompt and
  an attack-target-duelist prompt.
- `host.ts` (998 lines): seat assignment, reconnect, per-seat timers (`clock.ts`, 160 lines). The host needs an explicit seat-to-duelist table.
- `worker.ts` and `worker-protocol.ts`: no change except a wider options object.
- `packages/shared`: `DuelEngineView`, `DuelSeatView`, `DuelZoneRef` types (`@yugidraft/shared/duels`) grow a `duelist` index and a
  `team`; existing 1v1 fields remain.
- Domain (`DomainSeatState[]` at `views.ts:25`, `domainState?.[waiting.player]` at `engine.ts:510`) already indexes by seat.

---

## 8. Domain patch generalization

Domain Format 1v1: a Deck Master Zone (`LOCATION_DECKMASTER` 0x4000), LP tax on leaving the zone (first leave free, 500 LP
per completed return), a recall prompt after chains at open state, Pendulum wrapper in `lua/domain.lua` (347 lines).
Source: `domain-core/src/domain_master.cpp` (294 lines), `domain_master.h` (25), `lua/domain.lua`, `pins.json` notes.

Generalization:

- **State per duelist.** `player[p].deck_master_card`, `list_deckmaster`, `deck_master_returns` and `deck_master_last_kind` already live in
  `player_info`, so going from 2 to N duelists is a size change. Fix the guards (`playerid > 1` at lines 50, 56, 75, 159, 199) and
  the loop at line 281 (`cost[playerid]` init).
- **LP tax against team LP.** `check_lp_cost(playerid, tax)` and `PayLPCost` operate on the duelist's team LP. In Tag the tax comes
  out of shared LP (a team with low LP has fewer leaves). ADR-0002 does not say otherwise.
- **Recall offer.** Stock Domain: "offered to both owners in turn order" (`pins.json` notes; `domain_master.cpp:142-235`). Generalize to
  "each duelist in `turn_order`, starting from the turn player". Partners are separate owners.
- **Perspective.** `domain.lua` runs as a Lua library. The Pendulum wrapper (`domain.lua:168-174`) is called with P and works in
  the fold. Deck Master effects reference only the owner; they are class U/C. Partner Deck Masters: a Deck Master is a
  card on the individual field and not activated by the partner (ADR-0002).
- **Standard vs Domain** are one binary. The format flag selects whether the Deck Master zone exists. The patch must not change
  behavior when the flag is off. A differential test (section 9) covers this.
- **Patch text.** `apply-domain-patch.mjs` (1007 lines) applies string replacements and fails on any mismatch. After the N-duelist refactor most of
  its "from" blocks will differ. Move Domain to the same patch series (section 10), one patch per concern.

---

## 9. 1v1 compatibility through differential testing

Requirement: with `n_duelists == 2`, the new core behaves exactly like stock (plus the Domain patch when enabled).

Plan:

1. **Build two wasm cores:** `stock` (current pinned build) and `multi` (N-duelist build). Keep `stock` in the repo as the oracle
   in nightly runs. "Stock" here means the pinned core plus `domain-core/src/apply-core-fixes.mjs` (engine bug fixes that every
   build applies, for example the stale `reason_effect` use-after-free). The `multi` core applies the same fixes first.
2. **Differential harness (Layer 1 extension):** for each scenario or fuzz seed, run both engines with the same seed, decks, options and
   the same response journal. Compare, message by message, the raw byte stream (new ids are not emitted for 2 duelists, so streams
   are equal), plus a `QueryField` snapshot after each message.
3. **Corpus:** all ADR-0003 Layer 1 scenarios, Layer 2 fuzz seeds (for example 2,000 games per CI run, 50,000 nightly), and a
   script load check (every official script registers with both cores and produces the same effect table dump).
4. **Gate:** zero byte differences. A diff is a bug in the multi core, not a test to relax.
5. **Hot spots where byte equality can break:** PRNG call order (every `1 - x` refactor that changes evaluation order changes the
   RNG stream only if shuffles move; keep loop order player 0 then 1), chain order, `adjust_all` order, card id assignment.
6. **Also diff the Lua layer:** with 2 duelists the fold is the identity map. Run each scenario once with the fold disabled to prove that the fold
   itself adds nothing.

---

## 10. Patch management

Options:

| Option | Pro | Con |
|---|---|---|
| A. Keep the text patcher | no fork | 1,000 changed lines do not fit a string replacer; one upstream whitespace change breaks it |
| B. Fork branch pinned by commit | real diffs, merges, bisect | needs a fork repo and rebase discipline |
| C. `git am` patch series in this repo on top of the pinned upstream commit | no extra repo, reviewable, pinned | rebase by hand, patch conflicts on upstream bump |

**Recommendation: C, with B as the working form.** Develop on a local fork branch for editor and bisect support. Export with
`git format-patch` into `packages/duel-server/domain-core/patches/NNNN-*.patch`. The build script (`scripts/build-domain-core.sh`,
223 lines) clones upstream at the pinned commit and runs `git am`. `pins.json` keeps the upstream commit and adds the patch series
hash. Patch order: (1) N-duelist data model, (2) helpers and loop refactor, (3) perspective scope, (4) Lua API, (5) chains, (6) battle,
(7) ABI, (8) Domain. Each patch compiles. CI fails if the series does not apply cleanly. Upstream bumps are rare and deliberate.

Keep the wasm build on the existing emscripten image pinned by digest in `pins.json`. Native (non-emscripten) builds are useful for
sanitizers and fuzzing (ASan, UBSan on the array-size refactor is the best defense against a missed `[2]`). That is an option not
run here.

---

## 11. Phased plan with test gates

Done. The patch series, its order and its build steps are in `packages/duel-server/domain-core/patches/README.md`.

---

## 12. Risks, open questions and rejected alternatives

### 12.1 Top risks

1. **Missed two-player assumption** (`[2]`, `1 - x`, bit tricks like `^ 1`, `& 1`). One missed site corrupts state silently in
   3-4 duelist games and is invisible in 1v1. Mitigation: ASan build, a list of all sites, Layer 2 fuzz on FFA and Tag with state invariants.
2. **Long tail of per-card overrides.** About 7% overrides plus about 5% unknown on the official set (around 1,500 to 1,700
   scripts). Mitigation: fuzz ranks cards by error; restrict the legal card pool per mode at first (a card allow-list in Domain/multi).
3. **Partner semantics wrong for some class.** The fold hides the partner in `ep`/`rp`. Cards that care about "my partner did it"
   (control swaps, `GetOwner`) mis-handle. Mitigation: section 1.3 API, the unknown bucket, owner tests.
4. **Binding UX.** A lazy prompt in the middle of a cost can surprise the player, and timeouts in prompts need a default. Mitigation:
   default bound opponent with a timer, event binding first, log fallback.
5. **ABI and wrapper fork.** The n1xx1 wrapper fork is a second long-lived fork; the 64-bit mask touches the parser, views and
   prompts. Mitigation: emit old messages for 2 duelists; version the ABI; Layer 3 protocol tests.

### 12.2 Other risks

- Differential byte equality can break from a changed RNG call order. The gate will catch it.
- Wasm size and performance with four full fields (more queries per `adjust_all`).
- Lua global state in scripts loaded once per duel across perspectives (section 1.5 class 2).
- Elimination in FFA must remove cards without triggering effects, and must keep the chain and turn order valid.

### 12.3 Open questions (need product or rules answers)

1. ~~EMZ sharing~~: decided 2026-09-30. A private EMZ pair per duelist (section 5).
2. **2v2 team response window UI** (ADR-0002 open): the core provides order and pass semantics only.
3. **Per-card rule list** (ADR-0002 open): who owns the list of cards banned or ruled for multiplayer?
4. ~~Partner fold~~: decided 2026-09-30. The partner is never an opponent; "all" and both-side effects include the partner
   (section 1.3).
5. **Tag turn-player cards** (Messenger of Peace): count by duelist turn or by team turn?
6. **Draw from an empty Deck in Tag** (ADR-0002: the team loses if either member must draw from an empty Deck): confirm that the
   check applies to effect draws as well as the draw phase.
7. **Skill and Rush scripts** (174 and 3,119): out of scope unless a format needs them.

### 12.4 Rejected alternatives

- **Native tag mode (shared field with swapped hand, Deck and Extra):** ADR-0002 requires separate full fields. Rejected.
- **Run two 1v1 cores and sync them:** no real shared chain, no shared LP, no shared turn order. Rejected.
- **Fold the partner to 1 (partner as opponent for scripts):** wrong for 900 or more scripts (section 1.3). Rejected.
- **Full rewrite of every script for N players:** 22,754 scripts. Not feasible; the fold gives most of it for free. Rejected.
- **Always-ask opponent at activation:** noise (section 4.3). Rejected.
- **Patch by text replacement:** section 10. Rejected.
- **Widen `PLAYER_NONE` and `PLAYER_ALL` to new numeric values:** breaks every script that compares to 2 or 3 (and ids 2 and 3 are real
  duelists). Rejected; translate at the boundary.

---

## 13. Implementation notes (2026-09-30)

A second reviewer read this document against ADR-0002. The notes below are design constraints that ADR-0002 does not state.
Owner decisions now live in ADR-0002 (R-FFA-CHAIN for chain response order, R-FFA-ACROSS-EMZ and the Extra Monster Zone rules,
and the 2026-10-04 removal rule for eliminated duelists).

- **R1. Binding must happen at activation where the ADR says so.** ADR-0002 says the pick is part of the activation. Lazy
  binding at cost or target time is still part of the activation. Binding at resolution is not. Add a build-time script scan
  that marks effects whose operation uses a single-opponent API with `1-tp` (draw, discard, hand/Deck/Extra query, damage,
  recover, LP) and that have no event opponent. For these effects the core asks at activation. Lazy binding and the
  resolution prompt stay only as a safety net, and each hit in the fuzz layer adds the card to the scan list.
- **R2. Only legal opponents may be picked.** The select-opponent prompt offers only the opponents for which the effect's
  activation check (`target` with `chk==0`, and `condition`) passes when bound to that opponent. If only one opponent passes,
  bind without a prompt. If none passes, the effect cannot be activated. Without this rule, a player could pick an opponent
  with an empty hand to make a card fizzle on purpose.
- **R7. Tag LP costs.** "Pay half your LP" costs (for example Solemn Judgment) take half of the team LP. The Domain Deck Master
  tax also comes from the team LP (section 8). Both follow from shared team LP; the Layer 1 scenarios must cover them.
