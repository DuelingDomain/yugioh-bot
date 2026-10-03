# Multiplayer production rollout

Test staging first, including legacy 1v1; then the owner merges to main and deploys. This rehearsal does not deploy anything.

- Production compose defaults `MULTIPLAYER_TABLES` on for both `duel` and `web` (owner decision 2026-10-03: test on production). Set `MULTIPLAYER_TABLES=0` in `.env` to close the tables; changing it requires recreating both services, not a new image build. Turning it off blocks new multiplayer tables and starts while active games can finish.
- Leave `DUEL_1V1_ENGINE` unset (compose defaults to `legacy`) until the owner approves switching. Existing games recover with their recorded engine. Staging defaults to `pinned`, so test with `STAGING_DUEL_1V1_ENGINE=legacy` too.
- The web service needs `DISCORD_TOKEN` and `DISCORD_GUILD_ID` in its runtime environment for main's Discord access check, alongside the existing OAuth/auth settings. Production `web` reads `.env` through `env_file`; missing membership credentials prevent login/access with 503. Keep `DUEL_INTERNAL_SECRET` configured for web and duel.
- Leave `DUEL_SCENARIOS`, `DUEL_FX_LAB`, `E2E_AUTH`, and `E2E_AUTH_SECRET` unset in production.
- Build fresh production images from the merged Dockerfile. It includes the E2E workspace manifest for dependency installation, the patched wrapper, both engine implementations, and the duel bundle installer. Keep the shared `./data:/app/data` mount; the bundle is installed on the host volume rather than baked into the image. No new public ports or services are needed.
- Ship the pinned bundle and manifest: `cards.cdb`, card scripts, `ocgcore.standard.wasm`, `ocgcore.domain.wasm`, `ocgcore.domain.legacy.wasm`, and `card-scripts/domain.legacy.lua`. Verify the manifest hashes and legacy pin. Standard legacy 1v1 uses the image's npm `ocgcore-wasm` core; multiplayer uses the separate `ocgcore.multi.wasm` plus its `.sha256` and `.SOURCE` records.
- `.github/workflows/deploy.yml` already builds and ships the plain multi core without `LUA_FIXED_SEED`. It deliberately excludes `ocgcore.multi-domain.wasm`, so Domain 3/4-seat tables remain unavailable. Enabling those later needs an owner-approved workflow/cache/install change that builds and ships the Domain multi core and its provenance; keep the availability guard and UI explanation until then.
- Plan a quiet window for the first deployment: the bundle changes, and preflight refuses replacement while duels are active. Drain games before deploying; follow [the VM runbook](vm-runbook.md). Keep a rollback commit and the prior verified bundle.

Before another engine-branch integration, its owner should merge the same main revision and reconcile these resolutions, including `eliminationOrder`. Finding 3's engine-branch synchronization is outside this worktree.

Playwright and staging/live-stack checks are deferred until a stack slot is assigned. The existing legacy Standard core's CHAININFO flag 32 limitation remains; switching 1v1 to `pinned` is an owner decision.
