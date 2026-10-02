# Domain tables through the host

Domain runs at FFA3, FFA4 and 2v2 Tag tables when `MULTIPLAYER_TABLES=1` is set in the web and duel server processes and the host data directory has `ocgcore.multi-domain.wasm`. The creator reads the host status through an authenticated `capabilities` request on each page request. The create route checks the status again. A missing core gives a clear message. Unknown host status keeps multiplayer options closed.

This branch did not have the deployment switches described in the handoff. The table gate is now enforced at creation, bot fill and host start. The existing 1v1 worker options and core selection are unchanged. This change does not add or change `DUEL_1V1_ENGINE` routing.

## Path

1. `packages/web/app/(app)/duels/new/page.tsx` reads the host status. `creator.tsx` offers Domain for each enabled table format.
2. `packages/web/app/api/duels/route.ts` checks the web flag, the host flag and the Domain core status before `createDuelService.create` stores the room.
3. `RoomLobby` uses the shared seat count. It enables Start when every seat is ready and sends the selected empty seat to `add-bot`.
4. `host.ts` checks each human and bot deck with the room format. Domain requires a separate Deck Master, 60 singleton Main Deck cards within its Domain, at most 15 Extra Deck cards and no Side Deck. The multiplayer forbidden list also applies.
5. `buildPracticeBotDeck` supplies 60 different EARTH Normal Monsters and Axe Raider as the separate Deck Master.
6. The host sends all seat decks and the table format to `GameWorker`. `engine.ts` reads `ocgcore.multi-domain.wasm` for Domain with more than two seats. It creates each Deck Master in its owner's zone. The test does not supply a core binary or a startup board.
7. `domain-core.ts` reads the zone and return count for each seat. `views.ts` publishes each Deck Master to every seat. Hands remain private in FFA; Tag partners can see each other's hands. A prompt belongs only to its answering seat.
8. FFA surrender and time limits use core elimination. The last living seat wins. Tag surrender or a time limit ends the duel for that team. Core losses from battle or an empty Deck also end the duel. The host stores the result and final views for all seats.

## Proof plan

- Reproduce the creator and create-route block with the core marked present. Confirm that the tests fail before the gate fix.
- Test the missing-core and flag-off cases at FFA3, FFA4 and Tag. The host must answer before it creates a worker.
- Start each format through the host and the production worker. Check the selected file and SHA against the installed core.
- Fill empty seats with Domain bots. Validate human deck failures. Use real prompts to summon the human Deck Master and play several rounds to a result. Check all seat views and stored final views.
- Check surrender and time limits at all three formats. Check the winner seat in FFA and winner team in Tag.
- Run shared and web tests, real host tests and `npx tsc --noEmit` in each changed package.

Build the shared package before tests which import its compiled exports: `npx tsc -p packages/shared/tsconfig.build.json` from the worktree root.

Run host tests from `packages/duel-server` with `DUEL_DATA_DIR=<worktree>/data/duel-engine-next DUEL_REQUIRE_CORES=1 NSEAT_LIVE=1 NSEAT_WASM=<worktree>/data/duel-engine-next/ocgcore.multi-domain.wasm npx vitest run tests/host-domain-multi-real.test.ts --maxWorkers=1`. Test setup enables `MULTIPLAYER_TABLES` when it is unset. Gate tests set it to 0 to prove that production remains closed by default. The real host test runs in the engine test job, not the unit job.

Run web tests from the root with `npx vitest run <file> -c packages/web/vitest.config.ts`.
