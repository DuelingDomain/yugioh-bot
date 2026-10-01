# Native rule checks

Each check is a small C++ program. It links the multi-duelist core and plays a rule scenario (3 and 4 duelists, Tag,
elimination, Lua fold, zones). The programs include the internal core headers, so they need the core SOURCE tree.
The core is built with AddressSanitizer, UBSan, `-DYGO_N_TRAP` and `-D_GLIBCXX_ASSERTIONS`, like `phase1/gate.sh`
and `scripts/build-native-core.sh`.

## Run

```bash
# from the repo root. Without MULTI_TREE the run builds the repo patch series on the pinned ygopro-core (what CI does).
npm run test:native
# MULTI_TREE is another core source tree (the folder with field.h). It is only read.
MULTI_TREE=/path/to/core-tree npm run test:native --workspace=packages/duel-server
MULTI_TREE=... bash packages/duel-server/scripts/native/checks/run.sh elimination zones   # only these checks
MULTI_TREE=... bash packages/duel-server/scripts/native/checks/run.sh --pending           # also pending, stale, domain
bash packages/duel-server/scripts/native/checks/run.sh --list                             # print the manifest
bash packages/duel-server/scripts/native/checks/run.sh --clean                            # delete the build folder
```

The runner prints PASS, FAIL or SKIP per check and a summary. The exit code is 0 only when every selected `ready`
check passes. Logs are in `$NATIVE_CHECKS_OUT/logs`.

| Variable | Meaning |
| --- | --- |
| `MULTI_TREE` | Core source tree with the patch series applied. Default: the repo series on the pinned ygopro-core, made by `prepare-multi-core-tree.sh` into `$NATIVE_CHECKS_OUT/multi-core-tree`. |
| `NATIVE_CHECKS_OUT` | Build folder. Default `domain-core/.build/native-checks` (gitignored). Safe to delete. |
| `DUEL_DATA_DIR` | Data folder with `card-scripts`. Default `data/duel-engine-next`. |
| `CHECK_TIMEOUT` | Seconds for each check. Default 300. |
| `CHECK_TRAP` | `1` (default) builds with the trap macros, `0` builds without. |
| `LUA_SRC` | Lua source folder. Default is the pinned Lua of the native build. |
| `CHECKS_SKIP_LIB` | `1` reuses the library of an earlier run in the same build folder, only when it was built from the same core tree, Lua pin and flags (otherwise it is rebuilt). |

## Files

- `run.sh`: build and run.
- `checks.tsv`: manifest. Columns: name, source file, args (`-` = none), status, note. One name can have several rows.
- `common.h`: shared `failures` counter, `EXPECT` macro, folder helpers.
- One `.cpp` for each area (see the list in `checks.tsv`).

## Status values

- `ready`: must pass on the merged core (core `5edcc84`, which has F5 and F8).
- `pending`: needs core work that is not merged, or a check that does not match the merged core yet. Skipped unless you pass `--pending`.
  No check has this status now.
- `domain`: needs a core tree with the Domain layer (`domain_master.cpp`). The runner adds that file to the build when it
  is in the tree. `domain-multi` does not compile on the merged tree, which has no Domain layer.
- `stale`: the expectations no longer match the merged core. They are skipped unless you pass `--pending`.
  - `summon-counters-reflect`, `lua-sites`, `summon-sites`: written before the Lua perspective fold (core commits caf013c
    and 0375e33) and before F5. The Lua in these checks uses absolute seats inside effect scripts. Inside an effect, Lua now
    sees only 0 (the effect duelist) and 1 (the opponents). They need a rewrite: register the effect for the seat you want
    and use 0, or find the card by a unique code. A bisect showed all of them pass at core commit df45f27, before the fold.
    `summon-sites` also needs an owner rule decision (the old-rule oath with PLAYER_ALL counts seat 0 only).

The five Lua fold checks (`lua-scope-fold`, `lua-duel-library-a`, `lua-duel-library-b`, `lua-prompts-range`,
`lua-card-group-effect`) follow the F5 rules and are `ready`. Their test cards have no target or cost, so every pick prompt
there is the fallback pick of the operation step (kind c). The harness answers pick number k with option `k % options`, so a
core that ignores the answer fails. The pick at activation is checked by `opponent-pick`; a bound opponent that is eliminated
after the bind is checked by `zone-seat-sset`.

`opponent-pick` and `place-seat-hint` are snapshots of the development trees (`domain-core/.build/phase1/F5` and `F8`).
Copy them again when those trees change.

The build folder is reused between runs. The runner removes the binary of a check before it compiles it again, so a check that
no longer compiles is a FAIL (ready) and never runs an old binary. It builds the core library again when `MULTI_TREE`, its
HEAD, the Lua pin or the flags change, and makes `cards.tsv` again when `DUEL_DATA_DIR` changes.

## Where the checks come from

| Check | Area |
| --- | --- |
| `setup-duelists`, `player-ids`, `zones`, `link-column-zones` | seats, duelist setup, zones |
| `response-order`, `response-cursor`, `battle` | priority windows, chain order, attack and damage |
| `losses-team-lp`, `simultaneous-loss`, `elimination`, `elimination-guards` | losses, team LP, elimination |
| `control-change`, `control-check-flags` | control change and swap, control checks |
| `tag-partner`, `range-fold`, `absolute-range-unique` | Tag partner, range fold, absolute range |
| `lua-scope-fold`, `lua-duel-library-a`, `lua-duel-library-b`, `lua-prompts-range`, `lua-card-group-effect` | Lua perspective fold |
| `confirm-hint-sort`, `field-sites` | confirm events, hints, sort, field sites |
| `lua-sites`, `summon-sites`, `summon-counters-reflect` | library sites (stale) |
| `opponent-pick` | one opponent bound at activation (F5) |
| `place-seat-hint` | seat hint of a place prompt (F8 with F5) |
| `turn-handoff`, `zone-seat-sset` | turn hand-off after an elimination, SSet toward the bound opponent (F9) |
| `domain-multi` | Domain layer (status `domain`, see below) |
