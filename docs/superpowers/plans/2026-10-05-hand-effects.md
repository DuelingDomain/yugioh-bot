# Hand effect repair plan

> Use the debugging, test-driven-development, parallel audit, and verification skills. The owner has authorized local tests and fixes. Keep the branch and worktree.

**Status:** Complete. See `docs/audits/2026-10-05-hand-card-rules.md` for results and owner decisions.

**Goal:** Ask the correct owner when a legal hand or GY effect can activate in each duel format.

**Architecture:** Keep Lua and the core as the source of legal timing. Trace each prompt through the engine, host, and web. Change only a layer with a proven fault.

**Tools:** Node 22, Vitest, the existing scenario harness, and the read-only production-equivalent engine bundle.

- [x] Check the screenshot, official card text, and `c30576089.lua`. Record destruction, White Dragon, space, once-per-turn, battle, and protection conditions.
- [x] Add `packages/duel-server/tests/scenarios/multiplayer/jet-dragon.ts` and `jet-dragon.test.ts`. Test each seat in 1v1 normal/domain, legacy 1v1, FFA3, FFA4, and Tag. In FFA3 test the attacked owner and the owner outside the battle separately. Test battle and effect destruction with Jet in hand and GY. Assert destruction before the owner prompt, the raw engine prompt card/seat, and the summon result. Add illegal-condition controls.
- [x] Run these scenarios against the cached bundle before changing production code. Observe raw SELECT_EFFECTYN/SELECT_CHAIN messages as needed. Do not mark a failure as expected.
- [x] Trace `src/chain-mode.ts`, `src/prompts.ts`, `src/legacy/prompts.ts`, `src/engine.ts`, and `src/host.ts`. Test Auto, Always, and Off with real hand effects, including seats outside a battle. Add a failing test before each confirmed fix.
- [x] Audit web prompt routing, hand glow, Activate, the field activation gate, field reveal, and chain reveal. Verify that the gate cannot drop legal hand activation. Compare the chain-intro branch read only. Add a failing component test before each confirmed fix.
- [x] Find the Blue-Eyes deck. Audit Kuriboh, Effect Veiler, Ash Blossom, Honest, Gorz, Maxx C, Sage with Eyes of Blue, Dragon Spirit of White, Chaos MAX as a negative control, and applicable deck hand cards. Add real engine outcome tests in `hand-effects-audit.ts` and `hand-effects-audit.test.ts`. Record card conditions and legal negative controls in `docs/audits/2026-10-05-hand-card-rules.md`.
- [x] For each confirmed cause, make the smallest fix and run its targeted tests. Build a core only if a core patch changes. Commit each fix separately with the supplied trailers.
- [x] Review the complete diff and run the relevant engine, host, and web checks. Write a mode/seat/trigger before-and-after table. Remove only this worktree's build output. Do not push, merge, or create a PR.

Test command prefix:

```sh
export PATH=/home/sulman633/.nvm/versions/node/v22.23.3/bin:$PATH
export DUEL_DATA_DIR=/home/sulman633/.cache/dk-duel-engine-178
export MULTI_WASM=$DUEL_DATA_DIR/ocgcore.multi.wasm
export DOMAIN_MULTI_WASM=$DUEL_DATA_DIR/ocgcore.multi-domain.wasm
export NSEAT_WASM=$MULTI_WASM
export DUEL_REQUIRE_CORES=1 NSEAT_LIVE=1
```

Run duel tests from `packages/duel-server` with `../../node_modules/.bin/vitest run <target files>`. Run web tests from the worktree root with `node_modules/.bin/vitest run -c packages/web/vitest.config.ts <target files>`. Build shared first with `npm run build --workspace=packages/shared`.
