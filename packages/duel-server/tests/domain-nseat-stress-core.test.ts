import { readFileSync } from "node:fs";
import { expect } from "vitest";
import type { OcgLocation } from "ocgcore-wasm";
import { createEngineGame, registerDomainCoreFactory } from "../src/engine.js";
import { createDomainCore } from "../src/domain-core.js";
import { compileBoard } from "./support/board.js";
import { currentDomainMultiWasm, describeWithCores, needs } from "./support/cores.js";
import { liveNseat } from "./support/live-nseat.js";
import { Session } from "./support/session.js";
import { engineDataDirectory } from "./engine-data-dir.js";
import { DOMAIN_NSEAT_STRESS } from "./scenarios/multiplayer/domain-nseat-stress.js";
import { DOMAIN_NSEAT_STRESS_CHAIN } from "./scenarios/multiplayer/domain-nseat-stress-chain.js";
import { it } from "vitest";
import { expectKnownFailure, type KnownGap } from "./support/expected-failure.js";

// The pending-loss cases fail on the installed P68 cores. Chain cleanup sends the removed Dust Tornado back to the
// Graveyard of the lost seat 1, because field::eliminate does not clear core.leave_confirmed. They need
// domain-core/proposals/domain-nseat-stress/remove-eliminated-chain-cards.patch
// (docs/specs/2026-10-02-approved-core-integration.md lines 210 and 218-226). Each case is green only for the
// known failure below. When the patch lands the case fails with "known gap fixed": remove the mark then.
const PENDING_LOSS_GAP: KnownGap = {
  patch: "remove-eliminated-chain-cards.patch",
  spec: "docs/specs/2026-10-02-approved-core-integration.md:210,218",
  failsWith: ["seat 1, location 16: expected 1 to be +0"],
};
const isPendingLoss = (id: string) => id.includes("-pending-loss-keeps-other-seat-chain-window");

// Views hide the cards of an eliminated seat. Query the real core too, so that
// a hidden card left in the zone cannot make this proof pass. P61 fails the
// pending-loss cases: chain cleanup sends the removed Dust Tornado back to
// the lost owner's Graveyard. The private gap-domain patch clears this queue.
describeWithCores("Domain elimination removes the real zone", [liveNseat, ...needs.domainMulti()], () => {
  for (const scenario of [...DOMAIN_NSEAT_STRESS.filter((s) => s.setup.format !== "tag" &&
    (s.id.endsWith("eliminated-owner-loses-its-zone") || s.id.endsWith("stolen-master-is-removed-with-owner"))),
    ...DOMAIN_NSEAT_STRESS_CHAIN.filter((s) => s.setup.format !== "tag")]) {
    const run = async () => {
      let core: Awaited<ReturnType<typeof createDomainCore>> | undefined;
      registerDomainCoreFactory(async (ctx) => { core = await createDomainCore(ctx); return core; });
      const bytes = readFileSync(currentDomainMultiWasm());
      const game = await createEngineGame({ ...compileBoard(scenario.setup).options, seed: ["1", "2", "3", "4"],
        dataDirectory: engineDataDirectory, multiWasmBinary: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
      try {
        const session = new Session(scenario, game);
        session.reachMainPhase();
        scenario.steps.forEach((step, index) => session.run(step, index + 1));
        const seats = game.view(null).seats;
        for (const seat of seats) {
          const count = core!.lib.duelQueryCount(core!.handle, seat.seat, 0x4000 as OcgLocation);
          expect(count, `real zone of seat ${seat.seat}`).toBe(seat.deckMaster!.inZone ? 1 : 0);
          if (seat.eliminated) {
            for (const location of [1, 2, 4, 8, 16, 32, 64, 0x4000]) {
              expect(core!.lib.duelQueryCount(core!.handle, seat.seat, location as OcgLocation), `seat ${seat.seat}, location ${location}`).toBe(0);
            }
          }
          const view = game.view(seat.seat);
          expect(view.seats.map((s) => s.deckMaster?.inZone)).toEqual(seats.map((s) => s.deckMaster?.inZone));
          expect(view.result).toEqual(game.view(null).result);
        }
        expect(game.diagnostics().filter((d) => d.kind === "stderr")).toEqual([]);
      } finally {
        game.close();
        registerDomainCoreFactory(createDomainCore);
      }
    };
    if (isPendingLoss(scenario.id)) it(`${scenario.id} [expected failure: ${PENDING_LOSS_GAP.patch}]`, () => expectKnownFailure(PENDING_LOSS_GAP, run));
    else it(scenario.id, run);
  }
});
