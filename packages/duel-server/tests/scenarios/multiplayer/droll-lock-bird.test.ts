import { expect, it } from "vitest";
import { createEngineGame, type EngineGame } from "../../../src/engine.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import { compileBoard } from "../../support/board.js";
import { describeWithCores, needs } from "../../support/cores.js";
import {
  activate, defineScenario, eliminate, expectBoard, expectChain, expectEliminated, expectNotOffered, expectOffered,
  faceDown, pass, zone, type BoardSpec, type DuelistId, type Scenario, type Step,
} from "../../support/dsl.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { domainNseatWasmBinary, nseatWasmBinary, Session } from "../../support/session.js";
import { domainVariant } from "./domain-variants.js";
import { AXE, DROLL, DROLL_FORMATS, DROLL_LOCK_BIRD_SCENARIOS, DROLL_SOURCE, ELF, ROTA, drollSeats, type DrollFormat } from "./droll-lock-bird.js";

const JAR = "Jar of Greed";
const ARMORY = "Armory Call";
const EQUIP = "Axe of Despair";
const WABOKU = "Waboku";

// Use Session for every action and the real engine for every legal option. These helpers only
// pass optional windows, so we can inspect the actual Draw Phase and each seat's response windows.
async function duel(format: DrollFormat, domain: boolean, setup: Partial<BoardSpec>, body: (game: EngineGame, step: (...steps: Step[]) => void) => void, main = true) {
  let scenario: Scenario = defineScenario({
    id: `droll-${format}-live`, title: "Droll live control", source: DROLL_SOURCE,
    tags: ["multiplayer", format, "card:94145021"], rules: ["R-COMMON-EACH-PLAYER", "R-COMMON-SEAT-STATE"],
    setup: { format, skipOpeningDraw: true, ...setup }, steps: [],
  });
  if (domain) scenario = domainVariant(scenario);
  const game = await createEngineGame({
    ...compileBoard(scenario.setup).options, seed: ["1", "2", "3", "4"], dataDirectory: engineDataDirectory,
    multiWasmBinary: domain ? domainNseatWasmBinary() : nseatWasmBinary(),
  });
  const session = new Session(scenario, game);
  let index = 0;
  try {
    if (main) session.reachMainPhase();
    body(game, (...steps) => steps.forEach(step => session.run(step, ++index)));
  } finally { game.close(); }
}

function open(game: EngineGame) {
  for (let seat = 0; seat < game.view(0).seats.length; seat++) {
    const view = game.view(seat);
    if (view.prompt) return { view, prompt: view.prompt, by: `p${seat}` as DuelistId };
  }
  throw new Error("Expected an open real-core prompt");
}

function until(game: EngineGame, step: (...steps: Step[]) => void, ready: (current: ReturnType<typeof open>) => boolean, inspect?: (current: ReturnType<typeof open>) => void) {
  for (let guard = 0; guard < 100; guard++) {
    const current = open(game);
    inspect?.(current);
    if (ready(current)) return;
    expect(current.prompt.context?.type, JSON.stringify(current.prompt)).toBe("chain");
    expect(current.prompt.cancelable).toBe(true);
    step(pass(current.by));
  }
  throw new Error("The engine did not reach the expected window");
}

function offered(current: ReturnType<typeof open>, card: string) {
  return current.prompt.options.some(option => option.card?.name === card && /^(activate:|card:)/.test(option.id));
}

describeWithCores("Droll & Lock Bird on real Standard and Domain multi cores", [liveNseat, needs.cards(), needs.scripts(), ...needs.domainMulti()], () => {
  runScenarios("multiplayer/droll-lock-bird", DROLL_LOCK_BIRD_SCENARIOS);

  for (const domain of [false, true]) for (const format of DROLL_FORMATS) {
    const label = `${format} ${domain ? "Domain" : "Standard"}`;
    for (const probe of drollSeats(format)) {
      it(`${label}: the resolved lock blocks searches and draws at ${probe} and resets next turn`, async () => {
        await duel(format, domain, {
          p0: { hand: [ROTA], deck: [ELF, AXE] }, p1: { hand: [DROLL] },
          [probe]: {
            hand: [...(probe === "p0" ? [ROTA] : []), ...(probe === "p1" ? [DROLL] : [])],
            deck: [ELF, AXE, EQUIP], spells: [faceDown(ARMORY), faceDown(JAR), faceDown(WABOKU)],
          },
        }, (game, step) => {
          step(activate(ROTA, "p0"), zone("p0", probe === "p0" ? "s3" : "s0", "p0"));
          until(game, step, current => current.by === "p1" && offered(current, DROLL));
          step(activate(DROLL, "p1"));
          until(game, step, current => current.by === "p0" && current.prompt.context?.type === "action");
          if (probe !== "p0") {
            step({ op: "phase", to: "end", by: "p0" });
            until(game, step, current => current.by === probe);
          }
          step(expectOffered("activate", WABOKU, probe), expectNotOffered("activate", ARMORY, probe), expectNotOffered("activate", JAR, probe));
          // Advance across the End Phase reset. The real next-turn draw must also succeed.
          if (probe === "p0") step({ op: "phase", to: "end", by: "p0" });
          until(game, step, current => current.view.turn === 2 && current.by === probe);
          step(expectOffered("activate", ARMORY, probe), expectOffered("activate", JAR, probe));
          const hand = game.view(Number(probe[1])).seats[Number(probe[1])].hand.length;
          const deck = game.view(Number(probe[1])).seats[Number(probe[1])].deckCount;
          step(activate(ARMORY, probe));
          until(game, step, current => current.by === probe && offered(current, JAR) && game.view(Number(probe[1])).seats[Number(probe[1])].hand.some(card => card.name === EQUIP));
          step(activate(JAR, probe));
          until(game, step, current => current.view.phase === "main1" && current.prompt.context?.type === "action");
          step(expectBoard({ [probe]: { hand: { count: hand + 2, include: [EQUIP] }, deckCount: deck - 2, grave: { include: [JAR, ARMORY] } } }));
          expect(game.view(1).seats[1].hand.length).toBeGreaterThanOrEqual(1);
        });
      });

      it(`${label}: the lock stops queued search and draw effects at ${probe}`, async () => {
        await duel(format, domain, {
          p0: { hand: [ROTA], deck: [ELF, AXE] }, p1: { hand: [DROLL, DROLL] },
          [probe]: {
            hand: [...(probe === "p0" ? [ROTA] : []), ...(probe === "p1" ? [DROLL, DROLL] : [])],
            deck: [ELF, AXE, EQUIP], spells: [faceDown(ARMORY), faceDown(JAR), faceDown(WABOKU)],
          },
        }, (game, step) => {
          step(activate(ROTA, "p0"), zone("p0", probe === "p0" ? "s3" : "s0", "p0"));
          until(game, step, current => current.by === "p1" && offered(current, DROLL));
          step(activate({ card: DROLL, nth: 0 }, "p1"));
          // Put the search and draw between two Droll copies in the same response chain.
          // The second Droll resolves first, so both already-legal effects must add nothing.
          until(game, step, current => current.by === probe && offered(current, JAR));
          step(activate(JAR, probe));
          until(game, step, current => current.by === probe && offered(current, ARMORY));
          step(activate(ARMORY, probe));
          until(game, step, current => current.by === "p1" && offered(current, DROLL));
          step(activate(DROLL, "p1"));
          step(expectChain(DROLL, JAR, ARMORY, DROLL));
          until(game, step, current => current.prompt.context?.type === "action");
          step(expectBoard({
            [probe]: {
              hand: probe === "p0" ? [AXE] : [], deckCount: probe === "p0" ? 19 : 20,
              grave: [JAR, ARMORY, ...(probe === "p0" ? [ROTA] : []), ...(probe === "p1" ? [DROLL, DROLL] : [])],
              spells: [WABOKU],
            },
          }));
        });
      });

      it(`${label}: Draw Phase draws and searches at ${probe} do not enable Droll at any seat`, async () => {
        const setup: Partial<BoardSpec> = {};
        for (const seat of drollSeats(format)) setup[seat] = { hand: [DROLL] };
        setup[probe] = { hand: [DROLL, ROTA], deck: [ELF, ELF, EQUIP, AXE], spells: [faceDown(JAR), faceDown(ARMORY), faceDown(WABOKU)] };
        await duel(format, domain, setup, (game, step) => {
          const noDroll = (current: ReturnType<typeof open>) => expect(offered(current, DROLL), `${current.by} in ${current.view.phase}`).toBe(false);
          const targetTurn = probe === "p0" ? drollSeats(format).length + 1 : Number(probe[1]) + 1;
          while (game.view(0).turn < targetTurn) {
            until(game, step, current => current.prompt.context?.type === "action", noDroll);
            const turn = game.view(0).turn;
            step({ op: "phase", to: "end", by: open(game).by });
            until(game, step, current => current.view.turn > turn, noDroll);
          }
          expect(game.view(0).phase).toBe("draw");
          until(game, step, current => current.by === probe && offered(current, JAR), noDroll);
          const seat = Number(probe[1]);
          const before = game.view(seat).seats[seat];
          const hand = before.hand.length;
          const deck = before.deckCount;
          step(activate(JAR, probe));
          until(game, step, current => current.by === probe && offered(current, ARMORY) && game.view(seat).seats[seat].hand.length === hand + 1, noDroll);
          expect(game.view(0).phase).toBe("draw");
          step(activate(ARMORY, probe));
          until(game, step, current => current.prompt.context?.type === "action", noDroll);
          step(expectBoard({ [probe]: { hand: { count: hand + 2, include: [DROLL, EQUIP] }, deckCount: deck - 2, grave: [JAR, ARMORY] } }));
          // The ignored Draw Phase events must not prevent a later Main Phase event.
          step(activate(ROTA, probe), zone(probe, "s0", probe));
          until(game, step, current => offered(current, DROLL));
          const holder = open(game).by;
          expect(holder).not.toBe(probe);
          if (format === "tag") expect(Number(holder[1]) % 2).not.toBe(seat % 2);
          step(activate(DROLL, holder));
          until(game, step, current => current.prompt.context?.type === "action");
          step(expectBoard({ [holder]: { grave: [DROLL] }, [probe]: { hand: { include: [DROLL, EQUIP, AXE] }, grave: [JAR, ARMORY, ROTA] } }));
        });
      });

      it(`${label}: Droll can answer ${probe}'s draw outside the Draw Phase`, async () => {
        const holder = drollSeats(format).find(seat => format === "tag" ? Number(seat[1]) % 2 !== Number(probe[1]) % 2 : seat !== probe)!;
        await duel(format, domain, {
          [probe]: { spells: [faceDown(JAR)] }, [holder]: { hand: [DROLL] },
        }, (game, step) => {
          if (probe !== "p0") {
            step({ op: "phase", to: "end", by: "p0" });
            until(game, step, current => current.by === probe && offered(current, JAR));
          }
          expect(game.view(0).phase).not.toBe("draw");
          step(activate(JAR, probe));
          until(game, step, current => current.by === holder && offered(current, DROLL));
          step(activate(DROLL, holder));
          // Waboku is absent here, so no further optional window can hide an unresolved link.
          step(expectBoard({ [holder]: { grave: [DROLL] }, [probe]: { hand: [ELF], deckCount: 19, grave: [JAR] } }));
        });
      });

      it(`${label}: ${probe} can use two copies in one turn (Droll has no once-per-turn limit)`, async () => {
        const actor = drollSeats(format).find(seat => format === "tag" ? Number(seat[1]) % 2 !== Number(probe[1]) % 2 : seat !== probe)!;
        await duel(format, domain, {
          [actor]: { hand: [ROTA], deck: [ELF, AXE] }, [probe]: { hand: [DROLL, DROLL] },
        }, (game, step) => {
          while (game.view(0).turnSeat !== Number(actor[1])) {
            step({ op: "phase", to: "end", by: open(game).by });
            until(game, step, current => current.prompt.context?.type === "action");
          }
          step(activate(ROTA, actor), zone(actor, "s0", actor));
          until(game, step, current => current.by === probe && offered(current, DROLL));
          step(activate({ card: DROLL, nth: 0 }, probe));
          until(game, step, current => current.by === probe && offered(current, DROLL));
          step(activate(DROLL, probe));
          until(game, step, current => current.prompt.context?.type === "action");
          step(expectBoard({ [probe]: { grave: [DROLL, DROLL] }, [actor]: { hand: { include: [AXE] }, grave: [ROTA] } }));
        });
      });
    }

    if (format !== "tag") for (const gone of drollSeats(format)) {
      it(`${label}: activation and the all-seat lock work after ${gone} leaves`, async () => {
        const living = drollSeats(format).filter(seat => seat !== gone);
        const actor = living[0]!;
        const holder = living.at(-1)!;
        const setup: Partial<BoardSpec> = {};
        for (const seat of drollSeats(format)) setup[seat] = {
          hand: [...(seat === actor ? [ROTA] : []), ...(seat === holder || seat === gone ? [DROLL] : [])],
          deck: [ELF, AXE, EQUIP], spells: [faceDown(JAR), faceDown(ARMORY), faceDown(WABOKU)],
        };
        await duel(format, domain, setup, (game, step) => {
          step(eliminate(gone), expectEliminated(gone));
          until(game, step, current => current.by === actor && current.prompt.context?.type === "action");
          step(activate(ROTA, actor), zone(actor, "s3", actor));
          until(game, step, current => current.by === holder && offered(current, DROLL));
          step(activate(DROLL, holder));
          until(game, step, current => current.by === actor && current.prompt.context?.type === "action");
          const turn = game.view(0).turn;
          const checked = new Set<DuelistId>();
          const locked = (current: ReturnType<typeof open>) => {
            if (current.view.turn !== turn) return;
            expect(current.by).not.toBe(gone);
            step(expectNotOffered("activate", JAR, current.by), expectNotOffered("activate", ARMORY, current.by));
            checked.add(current.by);
          };
          locked(open(game));
          step({ op: "phase", to: "end", by: actor });
          until(game, step, current => current.view.turn > turn, locked);
          expect([...checked].sort()).toEqual([...living].sort());
          step(expectEliminated(gone), expectBoard({ [holder]: { grave: [DROLL] }, [actor]: { grave: [ROTA], hand: { include: [AXE] } } }));
        });
      });
    }
  }
});
