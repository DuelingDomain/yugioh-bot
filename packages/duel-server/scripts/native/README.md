# Native tools for the multi-duelist core

All tools here link against `libocgcore-multi.a` (core + Lua, AddressSanitizer + UBSan). Build that library with
`scripts/build-native-core.sh`.

Native rule checks (C++ programs that include the core headers) are in `checks/`. See `checks/README.md`; run them with
`MULTI_TREE=<core source tree> npm run test:native --workspace=packages/duel-server`.

## nduel: N-duelist duel driver

`nduel.cpp` plays one whole seeded duel with 2, 3 or 4 duelists. It answers every select prompt with a seeded random
valid answer. If the core replies `MSG_RETRY`, it tries a safer answer (up to 60 times).

```
nduel --n 2|3|4 --mode ffa|tag --seed S [--turns 60] [--lp 8000] [--max-steps 20000] [--stall-steps 3000]
      [--setup-always] [--check-future] [--trace] [--data DIR] [--scripts DIR]
```

- Run it from the repo root (the default `--data` and `--scripts` paths are relative to it). `--data` is the folder that
  `dump-card-data.mjs` writes (`cards.tsv`, `pool.txt`). `--scripts` is `data/duel-engine-next/card-scripts`.
- n > 2 loads `Debug.SetupDuelists(n, team...)` before any card is added. Teams: FFA = seat, Tag = seat % 2.
  Tag needs `--n 4`. Tag team LP is 2 x `--lp`.
- `--setup-always` also calls `Debug.SetupDuelists(2,0,1)` for n = 2. The hash must not change.
- The duel ends at the first `MSG_WIN` (the core keeps running after it, so the host stops), at the turn limit, or at
  `--max-steps`.
- Success prints one line: `NDUEL ok n=3 mode=ffa seed=S turns=T steps=K winner=W hash=<FNV-1a of all message bytes> ...`.
  `winner=-1` means the turn limit stopped the duel. `lp=` shows the LP at the turn limit.
- A failed check prints `NDUEL FAIL <check> seed=S step=K detail` and exits 1. Checks: `stall`, `stuck-prompt`,
  `turn-order`, `first-turn-draw`, `first-attack`, `one-win`, `bad-player`, `lp-query`, `msg-parse`, `setup`,
  `place-retry`.
- A sanitizer report or a `YGO_N_TRAP opponent_of file:line p=N` abort kills the process. Read stderr.

### Place prompts and the seat hint

At n > 2 the core writes `MSG_HINT` type `0xF0` (`HINT_PLACE_SEAT`: u8 type, u8 player, u64 data = target seat)
right before a `MSG_SELECT_PLACE` or `MSG_SELECT_DISFIELD` that offers a zone of another field. nduel reads the hint
and answers a zone of the named seat. Without a hint (n == 2, or an own-field prompt) it keeps the old choice. A
`MSG_RETRY` after a place prompt fails the run at once (`place-retry`): the answer of nduel must always be legal.

### Future checks

These checks need later core work, so they are NOT failures by default: `turn-order` and `first-attack` for n > 2
(T3/T4), `eliminated-turn`, `eliminated-prompt`, `one-win`, `win-consistency` (T5), `tag-lp` (T5). Without
`--check-future` they print `NDUEL NOTE ...` once per check on stderr and add to `future=` in the summary line. With
`--check-future` (or `NDUEL_FUTURE=1` for `run-nduel.sh`) they fail the run. Turn on the flag after the matching task lands.
The core must send `MSG_DUELIST_ELIMINATED` (200) for the elimination checks.

## run-nduel.sh

`bash packages/duel-server/scripts/run-nduel.sh` builds the core with `-DYGO_N_TRAP -D_GLIBCXX_ASSERTIONS` from the repo
patch series (`domain-core/patches`, through `prepare-multi-core-tree.sh`), compiles nduel, runs the matrix (n=2 plain, repeat and `--setup-always`, n=3 FFA, n=4
FFA, n=4 Tag; 20 seeds each; at most 3 processes) and writes `.status/nduel-summary.json (repo root)`.
The summary has counts per case, the first failure per check, hash comparisons (`hashChecks`), and
`traps: [{file, line, count, case, seed}]`. Env variables: see the header of the script
(`NDUEL_TREE`, `NDUEL_PATCHES` (extra patches after the repo series), `NDUEL_PATCH_LIMIT` (0 = all repo patches, N = the first N), `NDUEL_SEEDS`, `NDUEL_TURNS`, `NDUEL_LP`, `NDUEL_CASES`,
`NDUEL_SKIP_BUILD`, `NDUEL_FUTURE`, `NDUEL_NO_LOCK`, `NDUEL_BUILD_JOBS`, `DUEL_DATA_DIR`). The script uses the local
build lock `phase1/run-locked.sh` only when that file exists (it is not in the repo) and `NDUEL_NO_LOCK` is not 1.

## dump-card-data.mjs

Reads `cards.cdb` with `better-sqlite3` (the machine has no sqlite headers) and writes `cards.tsv` and `pool.txt`.
`run-nduel.sh` calls it when the files are missing.

## Known leak (LeakSanitizer)

`run-nduel.sh` runs the driver with `detect_leaks=1`. One leak of the stock ygopro-core is known and suppressed in
`scripts/native/lsan.supp` (`leak:field::check_chain_counter`): a duel that is destroyed while a chain is open leaks the applied chain
counter entry that `field::check_chain_counter` allocates (n4 seed 10: 28 bytes in 2 allocations). The leak is not part of the patch
series and does not change any game state. The suppression names that one function only, so any other leak still fails a run as
`sanitizer`. Set `LSAN_OPTIONS=suppressions=/dev/null` to see it again.

## Census mode

`NDUEL_CENSUS=1 bash packages/duel-server/scripts/run-nduel.sh` lists every missed two-player
`opponent_of` site, not only the first one per run. It applies `scripts/native/census.patch` (not part of the core
series) to a private census tree (default `domain-core/.build/nduel/census`) and builds with `-DYGO_N_TRAP_LOG`
instead of `-DYGO_N_TRAP`. For n > 2 `opponent_of` then prints `YGO_N_TRAP opponent_of file:line p=N` once per site and
process, and returns the next living duelist clockwise (0 when `p` is not a duelist in play) instead of aborting.
ASan/UBSan stay on, so a crash after a logged site is still reported (as `sanitizer` or `crash`).
The summary gets `mode: "census"` and `census: [{file, line, fn, runs, firstCase, firstSeed}]`, sorted by `runs`.
`fn` is the enclosing function of the source line (for Lua functions `lua:<name>`). `traps` stays empty in this mode.
If `census.patch` no longer applies after a change of `opponent_of` in `field.h`, regenerate it from that function.

## Order checks (all future checks)

They run for n > 2 only (except the message format checks) and fail only with `--check-future` (`NDUEL_FUTURE=1`).
Without the flag they print one `NDUEL NOTE` line per check and run.

- `response-order`: after `MSG_CHAINING` by L, the players of the `MSG_SELECT_CHAIN` prompts until the next
  `MSG_CHAINING` or `MSG_CHAIN_SOLVING` must be a subsequence of the expected order. FFA (R-FFA-CHAIN): start at L+1,
  then clockwise, with L last. Tag: L+1, L+3, L+2, L. Duelists that were not prompted
  are allowed. Trigger prompts inside a trigger batch can give a false report: treat a report there with care.
  `MSG_CHAIN_END` discards the anchor and prompt history: when every unresolved FFA link was removed by
  elimination, no `MSG_CHAIN_SOLVING` arrives. The restarted open window and later events are not responses to
  the removed link. Checking at the next link and at resolution still enforces the order within a live chain.
- `direct-pick`: a `MSG_SELECT_OPTION` whose options all are `0xFFFF0000|d` lists only living opponents of the
  prompted duelist. The next `MSG_ATTACK_DUELIST` (201) must name the picked duelist (the answer sent by nduel) and
  a living opponent of the turn player.
- `opponent-pick`: a `MSG_SELECT_OPTION` whose options all are `0xFFFE0000|d` (the pick of one opponent when an
  effect is activated) lists only living opponents of the prompted duelist. No option is the duelist or a Tag
  partner, no option is listed twice, and there are at least 2 options (with one legal opponent the core binds
  silently and sends no prompt).
- `eliminated-cards`: after `MSG_DUELIST_ELIMINATED` (200) for p, no `MSG_MOVE`, `MSG_SET`, `MSG_SUMMONING` or
  `MSG_SPSUMMONING` puts a card with controller p on the field.
- `segoc-order`: consecutive forced trigger links (no prompt between, or only forced `SELECT_CHAIN` prompts) follow
  the trigger order: FFA tp, tp+1, ...; Tag tp, tp+2, tp+1, tp+3. Optional trigger prompts end the batch.
- `field-disabled-n`: `MSG_FIELD_DISABLED_N` (202) is `u8 count, count x (u8 duelist, u32 mask)`, duelists in play.
- `msg-format`: lengths of messages 200 (2 bytes) and 201 (1 byte).

Messages 200, 201 and 202 are parsed and skipped without a `msg-parse` failure.

The targeted checker regression is `bash packages/duel-server/scripts/native/checks/run.sh nduel-response-order`.
It runs the actual nduel driver with FFA4 seed 18, 60 turns, 3000 LP and `--check-future`. Seat 3 pays its last
1000 LP for Cosmic Cyclone; its sole link is removed, and later windows must not retain its response anchor.

## Round 3 additions

- `run-nduel.sh --one <case> <seed>` runs one duel (case: n2 n2b n2s n3 n4 tag) and prints its output, with `--trace`.
  It prints the exact `cmd` first. `NDUEL_TRACE=0` turns the trace off. `NDUEL_SKIP_BUILD=1` skips the build.
- Every trap, sanitizer, failure and census entry in `.status/nduel-summary.json` has a `cmd` field. It is the full
  command line with `--n`, `--mode`, `--seed S`, `--turns`, `--lp`, `--data` and `--trace`. It uses the real seed S.
- `run-nduel.sh --check` also writes `.status/nduel-check.json` (`checked`, `skipped`, `failed`, `mismatches[]`, each with `cmd`).
- Census log lines now end with `code=<card code>`: the card of the current chain link, or of `reason_effect`. 0 means unknown.
- Census wasm: `EXTRA_CXXFLAGS=-DYGO_N_TRAP_LOG OUT_NAME=ocgcore.multi-B2-census.sync.wasm` on `build-multi-core.sh`,
  with B2 and `census.patch` (as an mbox) in `EXTRA_PATCHES`. It is for dev only. Do not install it.

## Round 4: Domain cases

- `nduel --domain [--domain-lua FILE]` loads `domain-core/lua/domain.lua` after `Debug.SetupDuelists`, then creates one Deck
  Master per seat (location 0x4000, face-up attack, before the decks, like engine.ts). The Deck Master is the first monster
  in the seat's main deck (the deck keeps its copy; legality is not checked). Fallback: Blue-Eyes (89631139).
  The decks are built first in seat order, so the RNG use is the same without `--domain`. Golden rows do not change.
- `run-nduel.sh` cases `d3`, `d4`, `dtag` (ffa3, ffa4, tag with `--domain`) run only with `NDUEL_DOMAIN=1`. They use a second lib
  (`$NDUEL_DIR/domain-native`, binary `nduel-domain`) built with `APPLY_DOMAIN=1 DOMAIN_MULTI=1`.
  `NDUEL_DOMAIN_MULTI=0` builds stock Domain only (for `--domain --n 2`).
