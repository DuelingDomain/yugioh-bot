# Core patch series (multi core)

This directory holds the patch series for the N-duelist ygopro-core. The series is for 3-player, 4-player and 2v2 Tag duels. No server uses the multi core yet.

## What the series is

- The base is ygopro-core at the commit in `domain-core/pins.json`.
- Each file is a `git format-patch` patch. They have fixed dates and a fixed author, so the build is repeatable.
- Patches apply in file name order with `git am`.
- Do not edit a patch file by hand. Change the dev tree, then run `git format-patch` again.

| Patch | What it does | Behaviour change |
| --- | --- | --- |
| `0001-core-fixes.patch` | The same core fix as `apply-core-fixes.mjs` (stale `reason_effect` in `delete_effect`). | None compared to the standard core. |
| `0002-deterministic-effect-order.patch` | Containers keyed by an address become ordered by `effect::initial_id` or `card::cardid`. See "Why the order must not depend on addresses". | None in the rules. Only the order of ties that stock left to the address. |
| `0003-n-duelist-player-array.patch` | `player` becomes `std::array<player_info, MAX_DUELISTS>`. `MAX_DUELISTS` is 4. `n_duelists` is 2. It adds `opponent_of`, `for_each_duelist` and `same_team`. | None. A duel has 2 duelists. |
| `0004-duelist-ids-and-helpers.patch` | Core-private ids `DUELIST_NONE` (0xFF) and `DUELIST_ALL` (0xFE). `player_info::team` (each duelist is its own team) and `player_info::eliminated`. `field::n_teams`. Helpers `is_duelist`, `is_alive`, `team_of`, `next_in_turn_order`, `for_each_opponent`. `same_team` compares teams. | None. Nothing calls the new helpers yet. |
| `0005-per-duelist-state-arrays.patch` | 28 member arrays of `field_info`, `processor`, `card` and `SendTo` change from `[2]` to `[MAX_DUELISTS]`. `MAX_DUELISTS`, `DUELIST_NONE` and `DUELIST_ALL` move to `common.h`. | None with 2 duelists. Only entries 0 and 1 are used. |
| `0006-helpers-processor-part-1.patch` | `processor.cpp` up to `calculate_battle_damage`: explicit pairs become loops over `n_duelists`. `1 - x` becomes `opponent_of(x)`. Player checks use `is_duelist`. | None with 2 duelists. Same values, same order. |
| `0007-helpers-processor-part-2.patch` | `processor.cpp` from `calculate_battle_damage` to `AddChain` step 8: the same conversion. The turn player switch uses `next_in_turn_order`. | None with 2 duelists. |
| `0008-helpers-processor-part-3.patch` | `processor.cpp` from `SortChain` to the end: the same conversion. Turn player first loops use `next_in_turn_order`. | None with 2 duelists. Messages, events and random calls keep their order. |
| `0009-helpers-operations.patch` | `operations.cpp`: the same conversion. Local arrays of size 2 become `MAX_DUELISTS`. | None with 2 duelists. Messages, events and shuffles keep their order. |
| `0010-helpers-field.patch` | `field.cpp`: 34 sites use the duelist helpers. The two `target_player[2]` message blocks become one loop. | None with 2 duelists. Same message bytes and order. |
| `0011-helpers-card-effect-duel-playerop.patch` | `card.cpp`, `playerop.cpp` and `ocgapi.cpp`: `opponent_of`, `n_duelists` and `is_duelist` replace the two-player forms. | None with 2 duelists. |
| `0012-helpers-libduel.patch` | `libduel.cpp`: 101 validity checks use `is_duelist`. 12 `1 - x` use `opponent_of`. Loops use `n_duelists`. | None with 2 duelists. The accept set stays {0, 1}. |
| `0013-helpers-libcard-libeffect-libgroup.patch` | `libcard.cpp`, `libeffect.cpp`, `libgroup.cpp` and `libdebug.cpp`: 12 checks use `is_duelist`. 4 linked zone sites use `opponent_of`. The `Debug.ReloadFieldEnd` pairs become loops. | None with 2 duelists. |
| `0014-helpers-phase-1b-sites.patch` | The rest of the explicit pairs: 7 pairs of `HINT_EVENT` messages, disabled zone resets, spsummon counter resets and 4 checks on `uint8_t` values. | None with 2 duelists. Same bytes and order. |
| `0015-multi-duelist-interface.patch` | The interface for the later patches: `opponent_of` with a trap under `YGO_N_TRAP`, `next_in_turn_order` that skips eliminated duelists, `lp_ref`, `first_attack_turn`, `before_first_attack_turn`, `battle_defender`, `response_anchor` and the `field::eliminate` declaration. | None with 2 duelists. No message, Lua result or random call changes. |
| `0016-setup-duelists.patch` | Adds `Debug.SetupDuelists(n, team0, team1[, team2[, team3]])`. It sets the duelist count, the teams and `first_attack_turn`. `OCG_DuelNewCard` rejects a card with a controller or team that is not a duelist in play. | None with 2 duelists. The callers only send 0 and 1. |
| `0017-response-cursor.patch` | Priority windows, trigger order and phase change windows for `n_duelists > 2`. New helpers `response_order`, `first_responder`, `next_responder`, `restart_responders`, `trigger_order` and `next_trigger_player`. Before this, a 3 or 4 duelist duel hung when seat 1 ended its turn. | None with 2 duelists. Every change is an `n_duelists == 2` stock branch or a guard that is false at 2. |
| `0018-battle.patch` | Battle for 3 and 4 duelists: attack targets from every living opponent, a direct attack mask, `battle_defender`, a `MSG_SELECT_OPTION` prompt for a direct attack with several open opponents, `MSG_ATTACK_DUELIST` (201) and battle damage to the right duelist. | None with 2 duelists. Every line keeps the stock text or gives the same value. |
| `0019-losses-and-team-lp.patch` | Losses, win and draw for `n_duelists > 2` (`check_losses_n`), team LP through `lp_ref`, `Duel.Win` for `n > 2` and `Debug.EliminateDuelist`. Message ids 200 to 202 in `common.h`. | None with 2 duelists. Every changed stock statement is guarded by `n_duelists == 2` or gives the same value. |
| `0020-elimination.patch` | The body of `field::eliminate` and a visit of each living duelist once in the loops that stepped `next_in_turn_order`. It sends `MSG_DUELIST_ELIMINATED` (200), clears pending chain entries, rolls back attacks and removes the cards of the eliminated duelist. | None with 2 duelists. `eliminate` does nothing and every changed statement is behind an `n_duelists` test. |
| `0021-zones.patch` | Zones for `n_duelists > 2`: no Extra Monster Zone mirror, 2 Extra Monster Zones for each duelist, a relative `EFFECT_DISABLE_FIELD` value and the new message `MSG_FIELD_DISABLED_N` (202). `Duel.CheckTiming` and `Duel.IsEnvironment` loop over the living duelists. | None with 2 duelists. The stock text is inside `n_duelists == 2` branches. |
| `0022-fold-primitives.patch` | The fold primitives: `field::fold_player` and `unfold_player`, `chain::bound_opp`, a scope stack in the interpreter and `field::build_range_list`. 4 range loops, release and material lists, overlay loops and counters use it. | None with 2 duelists. Every site builds the same self and opponent pair as the stock loop. |
| `0023-tag-partner-negation.patch` | In a Tag duel a duelist cannot negate the activation or the summon of the partner (`effect::is_activateable`, `NegateActivation`, `NegateEffect`, `NegateSummon`). Continuous effects are not changed. | Tag only. Every new condition starts with `n_duelists > 2`, so 2 duelists keep the stock bytes. |
| `0024-control-change.patch` | `Adjust` cases 3, 4 and 5 test every duelist's set. `ControlAdjust`, `TrapMonsterAdjust` and `ChangePos` use per duelist passes. A card whose target is not a living duelist goes to the Graveyard. | None with 2 duelists. Every changed site takes the stock branch. |
| `0025-player-none-and-all-split.patch` | `PLAYER_NONE` (2) and `PLAYER_ALL` (3) are seats 2 and 3 when `n_duelists > 2`. Adds `field::none_id()`, `all_id()` and `reset_sentinels()`. About 150 lines use them. | None with 2 duelists. The helpers return the stock values. |
| `0026-summon-for-all-player.patch` | The summon for all operation player is compared with `all_id()` (1 site in `libduel.cpp`, 4 in `processor.cpp`). Fixes a "group size wasn't exactly 2" error with seat 3. | None with 2 duelists. `all_id()` is `PLAYER_ALL` there. |
| `0027-summon-counters-and-damage.patch` | Fixes for `n > 2`: special summon counters per summon player, reflected damage to the reason player, the `SelfDestroyUnique` choice list, `SendTo` without a controller, `Draw` confirm, `TossDice` and the discard deck cost check. | None with 2 duelists. Every change is in an `n_duelists > 2` branch. |
| `0028-control-check-and-old-rule-flags.patch` | `card::is_control_can_be_changed` asks every living duelist except the controller. `effect::is_target` uses `get_owner_player()`. `Debug.SetupDuelists` rejects `DUEL_CANNOT_SUMMON_OATH_OLD`, `DUEL_SPSUMMON_ONCE_OLD_NEGATE` and `DUEL_1_FACEUP_FIELD` when `n > 2`. | None with 2 duelists. The stock lines run behind `else if`. |
| `0029-response-cursor-and-continuous-marker.patch` | `next_responder` still finds the next living duelist when the cursor was eliminated. The `PhaseEvent` pass of an eliminated cursor does not count. The continuous effect marker uses its own value at `n > 2`. | None with 2 duelists. All three are new code paths for `n > 2` or give the same value at 2. |
| `0030-trigger-order-cursor.patch` | `next_trigger_player` and `trigger_order` survive an eliminated cursor. The `PhaseEvent` pass record is a mask (`pass_mask`), so a duelist who passed and was eliminated later is not counted. | None with 2 duelists. New code for `n > 2` only. |
| `0031-simultaneous-losses-and-ffa-draw.patch` | Four fixes for `n > 2`: every simultaneous loser is marked dead first, a free for all draw sends one message 200 per loser before `MSG_WIN`, `BattleCommand` starts with `none_id()` and a direct attack with no valid pick skips the damage. | None with 2 duelists. A Tag end is unchanged. |
| `0032-reveal-hints-and-card-op-order.patch` | `Duel.ConfirmCards` uses the controller of the card as event player. `Duel.Hint` with `HINT_OPSELECTED` goes to each living duelist except the caller. `card_operation_sort` orders controllers by rotation from the turn player. | None with 2 duelists. Every change is in an `n_duelists > 2` branch. |
| `0033-link-and-column-zones.patch` | The Link and column zone code (`card.cpp` 8 sites, `libcard.cpp` 4 sites) stays inside the own field when `n > 2`. Fixes a Space Insulator zone select hang. | None with 2 duelists. Every changed statement is under an `n_duelists == 2` test or masks nothing. |
| `0034-player-effect-side-and-summon-procedures.patch` | `effect::is_target_player` and `card::get_unique_target` use the right sides at `n > 2`. A summon procedure with `EFFECT_FLAG_SPSUM_PARAM` and an `o_range` tries the living opponents clockwise (helper `opponents_in_turn_order`). | None with 2 duelists. Every change is in an `n_duelists > 2` branch. |
| `0035-lua-seat-checks-and-field-mask.patch` | `libduel.cpp` and `playerop.cpp` for `n > 2`: `SelectDisableField` uses the next living duelist, `GetEnvironment` reads every Field Zone, and the summoned count, activity count, decktop and release functions give a safe result for a value that is not a seat. | None with 2 duelists. The stock result stays at 2. |
| `0036-field-out-of-range-reads.patch` | Closes 6 places in `field.cpp` that could read or write out of range at `n > 2` (`get_field_card`, `check_tribute`, `add_effect`, `remove_effect`, the discard deck checks and `check_unique_onfield`). | None with 2 duelists. All 26 `opponent_of` calls in these files run only at 2 or in an `n > 2` branch. |
| `0037-summon-to-opponent-and-pass-loops.patch` | Pass loops use a mask. `Summon`, `MSet` and `SpSummonRule` send the monster to the first living opponent for whom the summon works. The old rule summon oaths and `DUEL_1_FACEUP_FIELD` work at `n > 2`. | None with 2 duelists. All changes are new code for `n_duelists > 2`. |
| `0038-lua-fold-scope-and-param-kind.patch` | Lua sees only 0 (the duelist that runs the script, or its team) and 1 (the opponents) at `n > 2`. The interpreter keeps a scope stack. 135 `add_param` sites use the new `PLAYER` kind. New `fold.h` helpers and 8 library functions use them. | None with 2 duelists. No scope folds, every helper is the identity and the message hashes stay the same. |
| `0039-lua-fold-libduel-first-half.patch` | Every `libduel.cpp` function from the top to `GetChainEvent` that takes or returns a player uses the fold API (`unfold_action`, `query_list`, `field_side`, `push_player`). | None with 2 duelists. |
| `0040-lua-fold-libduel-second-half.patch` | The same for `libduel.cpp` from `SkipPhase` to the end. No prompt goes to an eliminated seat. | None with 2 duelists. Every helper is the identity. |
| `0041-lua-fold-card-group-effect.patch` | The same for the Card, Group and Effect functions. Lua gives a folded player. A value that is not a living duelist gives the stock invalid result. | None with 2 duelists. The 2 duelist path is the stock code. |
| `0042-not-alive-seat-guards.patch` | A seat that is not alive gets no prompt, no card on its field and no control change at `n > 2`. New `is_skipped_seat(p)` in `field.h`. The core answers for such a seat with the stock "no choice" answer. | None with 2 duelists. Every change is in an `n > 2` branch. |
| `0043-shared-fold-helpers.patch` | The local fold helpers of `libduel`, `libcard` and `libgroup` move to `fold_lib.h`. `Group.SelectWithSumEqual` and `SelectWithSumGreater` clear stale forced cards. `field::add_effect` swaps the ranges of an absolute free for all effect. `Destroy` drops a card with no location and no controller. | None with 2 duelists. The move and rename is pure. |
| `0044-opponent-binding.patch` | At `n > 2` Lua "1" (one opponent) is bound when the effect is activated and stays for the whole chain link. Order: the event opponent (a battle names the other side), then a probe at `AddChain` step 0, then a lazy prompt in a yieldable cost or target. One opponent binds with no prompt. Several: the activator gets `MSG_SELECT_OPTION` with desc `0xFFFE0000\|seat`. Summon procedures with a range on the opponent side ask in `SpSummonRule`. In Tag the pick is between the opponent seats. Team level calls (`GetLP`, `CheckLPCost`, `SetTargetPlayer`, the operation info player) need no pick. A bound opponent that is eliminated before the link resolves gives an empty result (ADR 0002). | None with 2 duelists. Every new path is guarded by `n_duelists > 2`. |

## Commands

Run all commands in the repository root.

1. Prepare the source tree (no docker needed):
   `bash packages/duel-server/scripts/prepare-multi-core-tree.sh`
   - The tree is `packages/duel-server/domain-core/.build/multi-core-tree`. Set `MULTI_TREE` to use a different path.
   - Set `PATCH_LIMIT=N` to apply only the first N patches.
   - The script can run again. It does nothing when the patches did not change. It stops with an error when a patch fails, and it aborts `git am`.
2. Build the wasm core. Use the local emsdk image. Do not pull it.
   ```
   docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
     -e EM_CACHE=/src/packages/duel-server/domain-core/.emcache \
     -v "$PWD":/src -w /src docker.io/emscripten/emsdk:4.0.9 \
     bash packages/duel-server/scripts/build-multi-core.sh
   ```
   - Output: `domain-core/dist/ocgcore.multi.sync.wasm` and `ocgcore.multi-build-info.json`. The `dist` directory is ignored by git. The file is not in any manifest.
   - Environment: `PATCH_LIMIT=N` (first N patches only), `LUA_FIXED_SEED=1` (see below), `OUT_NAME=file` (output name), `EXTRA_PATCHES` (extra patch files, for experiments), `EXTRA_EM_FLAGS` (extra em++ flags).
   - Sanity gate: with `PATCH_LIMIT=1` and no `LUA_FIXED_SEED`, the output is byte for byte the same as `ocgcore.standard.sync.wasm`. Patch 2 changes the binary, so this gate only works with `PATCH_LIMIT=1`.
   - The differential test needs two builds, both with `LUA_FIXED_SEED=1`:
     - the reference: `PATCH_LIMIT=2 LUA_FIXED_SEED=1 OUT_NAME=ocgcore.multi-ref.sync.wasm` (patches 1 and 2)
     - the multi core: `LUA_FIXED_SEED=1` (all patches)
   - The reference has patch 2 because the gate compares "same source meaning, different binary layout". Stock without patch 2 is not address free, so it is not a valid reference.
3. Build the native core with ASan and UBSan, and run the smoke test:
   `bash packages/duel-server/scripts/build-native-core.sh`
   - Environment: `JOBS`, `CXX`, `SKIP_SMOKE`, `NATIVE_OUT` (output directory), `MULTI_TREE`, `PATCH_LIMIT`, `EXTRA_PATCHES`.
4. Make the two-player site list:
   `bash packages/duel-server/scripts/list-two-player-sites.sh > docs/specs/multiplayer-core-sites.txt`
5. Run the differential test:
   `cd packages/duel-server && DUEL_DATA_DIR=<engine data dir> DIFF_RUNS=20 npx vitest run tests/differential`
   - It records a self-play duel on the reference core. It replays the journal on the reference core (reference trace), again on the reference core (self-check), and on the multi core.
   - It compares each parsed message, the raw bytes of each message and a field snapshot after each process step, and
     the final views. It needs zero differences.
   - The raw bytes come from the `OCG_DuelGetMessage` buffer (`tests/differential/raw-messages.ts`). The wrapper drops a
     message that it cannot parse, so the parsed messages alone can hide a difference. A separate test fails when the
     wrapper logs "failed to parse a message" for any core.
   - It skips when the engine data, the multi wasm or the reference wasm is missing.
   - `DIFF_RUNS` is the seed count. `DIFF_SEED` is the base seed. `DIFF_ONLY_SEEDS` is a comma list that replaces the seed set. `DIFF_REFERENCE_WASM` and `DIFF_MULTI_WASM` set the wasm paths.

## Why the differential test needs fixed seeds

Two sources of change between runs would give false differences. The test removes both.

- Lua seeds its string hash and `math.random` from `time(NULL)` and from addresses. The order of `pairs()` in a card script then changes from run to run. The test freezes `Date.now` during each duel. The wasm time call reads it.
- The addresses depend on the binary. Two different binaries get two different seeds. The build option `LUA_FIXED_SEED=1` sets `luai_makeseed()` to 0 in both test cores. The standard server core does not use this option.

The reference trace is a replay, not the self-play run. Self-play makes extra query calls, and this changes the wasm heap layout. A replay makes the same calls on each core.

Without these two measures, a 200 seed run gave stock-against-stock differences in 4 seeds.

## How to add a patch

1. Prepare the tree with all patches applied.
2. Make your change in the `multi` branch of the tree. Make one commit.
3. Run `git format-patch` for the new commit. Use the next number in the name.
4. Build the multi core and run the differential test. You must get zero differences before the patch is final.
5. Keep a patch that has differences as a draft. Do not merge it.

## Rules for every patch

- Bound each loop over the `player` array with `n_duelists`. Never use `player.size()` or a range loop over the whole array.
- Change behaviour only in a patch that says so in its title.

## Why the order must not depend on addresses

The stock core keeps some containers with a pointer as the key (`std::unordered_set<effect*>`, `std::map<effect*, chain>`, `std::unordered_map<effect*, effect*>`). It then walks them and sends messages, calls Lua or changes the game state. The walk order is the hash order or the address order. Two binaries that have the same source meaning have different heap addresses. They can play the same duel in a different way. The 200 seed run found 6 seeds with the same two card hints (`MSG_CARD_HINT` or `MSG_PLAYER_HINT`, hint 7) in a different order. The same holds for a later real server: two servers must not give two different duels from one seed and one answer list.

Patch 2 fixes this.

- Every registered effect gets a unique `initial_id` once, and it never changes. Every card gets a unique `cardid`. Patch 2 orders by these ids. It does not use `effect::id`, because the core assigns `id` again.
- The comparator is `effect_sort_by_initial_id_ptr`. It uses the address only when two effects have the same `initial_id`. This happens only for a lookup of an unregistered effect. A clone keeps the `initial_id` of its source until it is registered, and `card::add_effect` starts with `indexer.find`. A pure `initial_id` compare would match the clone with its source.
- Changed: `effects.pheff`, `cheff`, `spsummon_count_eff`, `oath`, the grant `gain_effects`, `effect_indexer` (`card::indexer` and `field_effect::indexer`), `core.quick_f_chain`, `core.delayed_quick` and `delayed_quick_tmp`, `core.unique_cards`.
- Freed effects: the new comparators read the effect, so a container must not keep a pointer to a freed effect. In turn 1,
  `quick_f_chain`, `delayed_quick` and `delayed_quick_tmp` can still hold entries from the Startup events when the `Turn`
  processor frees the reset effects (their first clear is in step 2). Patch 2 drops those entries first. A stock read of
  such an entry was a use-after-free, so no defined behaviour changes.
- Checked and left: `effects.rechargeable` (`recharge()` has no side effect), `core.reseted_effects` and `duel::uncopy` (they only delete effects and may hold unregistered effects), `readjust_map`, `relations`, `relate_effect`, `duel::cards`, `groups`, `effects`, `assumes`, all maps with an integer key, and all sorts (they compare ids, not addresses). The commit message of patch 2 has the reason for each one.
- Not in the core: Lua `pairs()` over a table keyed by a card or effect hashes by address. `LUA_FIXED_SEED` removes this in the test. A card script that depends on it is a script problem.

The same fix is useful for the production standard core. It is not applied there. The production path stays as it is until the multi series ships.

## Status of the series

- Patches 2, 3 and 4 pass the differential gate. The reference is patches 1 and 2. The multi core is patches 1 to 4.
- The results in this section are for patches 1 to 4. They were not repeated for patches 5 to 44 when these files were added.
- Before the freed-effect fix: 200 seeds (base seed 20260930) and 1,000 seeds gave zero stock differences and zero multi differences.
- With the freed-effect fix and the raw byte check: 200 seeds with patches 1 to 3 give zero differences and zero parse
  warnings. Patch 4 passes the 6 seeds that failed before (1577499120, 1916473771, 1025441889, 1578551883, 1116767578,
  1646569184).
- Control: a second reference from the same patches 1 and 2 with `EXTRA_EM_FLAGS=-D_LIBCPP_HARDENING_MODE=_LIBCPP_HARDENING_MODE_EXTENSIVE` (a different binary layout) gives zero differences against the reference on the 6 seeds and on 50 seeds. Before patch 2, the same control built from patch 1 only gave differences on 2 of 3 seeds.
- Sanity gate: the `PATCH_LIMIT=1` build without `LUA_FIXED_SEED` is byte for byte the same as `ocgcore.standard.sync.wasm`.
- The native ASan and UBSan build of all patches compiles without warnings, and the smoke test passes.
