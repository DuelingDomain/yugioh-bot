import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { defaultDuelSettings, seatCountFor, type DuelFormat } from "@yugidraft/shared/duels";
import { createEngineGame } from "../src/engine.js";
import { createEngineGame as createLegacyGame } from "../src/legacy/engine.js";
import { choosePracticeBotAnswer } from "../src/practice-bot.js";
import { engineDataDirectory as dataDirectory } from "./engine-data-dir.js";
import { currentDomainMultiWasm, describeWithCores, needs } from "./support/cores.js";

const ELF = 15025844;
const MST = 5318639;
const traps = [
  { name: "Waboku", code: 12607053, outcome: "grave" },
  { name: "Gravity Bind", code: 85742772, outcome: "stays" },
  { name: "Metal Reflect Slime", code: 26905245, outcome: "monster" },
] as const;

for (const [engine, format] of [["merged", "1v1"], ["legacy", "1v1"], ["merged", "ffa4"], ["merged", "tag"]] as const) {
  const multi = format !== "1v1";
  const requirements = [needs.cards(), needs.scripts(), ...(multi ? needs.domainMulti() : [needs.standard()])];
  describeWithCores(`${engine} ${format}: real Set Trap position contract`, requirements, () => {
    it.each(traps)("$name activates upright and has the correct resolved zone", async ({ code, outcome }) => {
      const formatName: DuelFormat = format;
      const count = seatCountFor(formatName);
      const viewers = [...Array.from({ length: count }, (_, seat) => seat), null];
      const options = {
        mode: multi ? "domain" as const : "normal" as const,
        format: formatName,
        decks: Array.from({ length: count }, (_, seat) => ({
          main: [seat === 0 ? code : seat === 1 ? MST : ELF, ...Array<number>(19).fill(ELF)],
          extra: [], side: [], ...(multi ? { deckMaster: ELF } : {}),
        })),
        seed: ["1", "2", "3", "4"], dataDirectory,
        settings: { ...defaultDuelSettings(multi ? "domain" : "normal", format), shuffleDeck: false, validateDeck: false, banlist: "none" as const },
        ...(multi ? { multiWasmBinary: new Uint8Array(readFileSync(currentDomainMultiWasm())).buffer } : {}),
      };
      const game = engine === "legacy" ? await createLegacyGame(options) : await createEngineGame(options);
      const zone = { controller: 0, location: 0x08, sequence: 0 };
      const waiting = () => {
        for (let seat = 0; seat < count; seat++) {
          const view = game.view(seat);
          if (view.prompt) return { seat, view, prompt: view.prompt };
        }
        throw new Error("Expected an open core prompt");
      };
      try {
        // Set through the real action prompt, then activate on the following player's turn.
        // MST gives that player a legal response so the face-up Trap can be queried mid-chain.
        let checkedSet = false;
        for (let guard = 0; guard < 60; guard++) {
          const { seat, view, prompt } = waiting();
          if (view.seats[0].spells[0] && !checkedSet) {
            for (const viewer of viewers) {
              const set = game.view(viewer).seats[0].spells[0];
              expect(set).toMatchObject({ ...zone, position: 0x0a });
              if (viewer === 0 || (format === "tag" && viewer === 2)) expect(set?.code).toBe(code);
              else expect(set?.code).toBeUndefined();
            }
            checkedSet = true;
          }
          const activation = seat === 0 && view.turn > 1 ? prompt.options.find(o => o.card?.code === code &&
            (o.id.startsWith("activate:") || prompt.context?.type === "chain")) : undefined;
          if (activation) {
            game.answer(seat, prompt.id, { choice: activation.id });
            break;
          }
          const set = seat === 0 ? prompt.options.find(o => o.id.startsWith("sset:") && o.card?.code === code) : undefined;
          game.answer(seat, prompt.id, set ? { choice: set.id } : prompt.cancelable ? { cancel: true } :
            prompt.options.some(o => o.id === "to_ep") ? { choice: "to_ep" } : choosePracticeBotAnswer(prompt));
        }
        expect(checkedSet).toBe(true);
        for (const viewer of viewers) {
          const view = game.view(viewer);
          expect(view.seats[0].spells[0]).toMatchObject({ ...zone, code, position: 0x05 });
          expect(view.chain).toEqual([expect.objectContaining({ index: 1, seat: 0, code, zone })]);
          const flip = view.events.find(e => e.kind === "position" && e.card?.code === code);
          expect(flip).toMatchObject({ zone, fromPosition: 0x0a, toPosition: 0x05, flip: true });
          expect(view.events.find(e => e.kind === "activate" && e.card?.code === code)).toMatchObject({ zone, chainIndex: 1 });
        }
        for (let guard = 0; guard < 30 && !game.view(null).events.some(e => e.kind === "chain-end"); guard++) {
          const { seat, prompt } = waiting();
          game.answer(seat, prompt.id, prompt.cancelable ? { cancel: true } :
            prompt.options.some(o => o.id === "pos:4") ? { choice: "pos:4" } : choosePracticeBotAnswer(prompt));
        }
        for (const viewer of viewers) {
          const view = game.view(viewer);
          expect(view.events.some(e => e.kind === "chain-end")).toBe(true);
          for (const kind of ["chain-resolving", "chain-resolved"] as const) {
            expect(view.events.find(e => e.kind === kind)).toMatchObject({ card: { code }, chainIndex: 1 });
          }
          if (outcome === "stays") {
            expect(view.seats[0].spells[0]).toMatchObject({ code, location: 0x08, position: 0x05 });
          } else {
            expect(view.seats[0].spells[0]).toBeNull();
            const destination = outcome === "monster" ? 0x04 : 0x10;
            const move = view.events.find(e => e.kind === "move" && e.card?.code === code && e.zone?.location === destination);
            expect(move).toMatchObject({ from: zone, zone: { controller: 0, location: destination } });
            // SZONE's combined position bits must not become a monster-defense departure pose.
            expect(move?.fromPosition).toBeUndefined();
            if (outcome === "monster") expect(view.seats[0].monsters.find(c => c?.code === code))
              .toMatchObject({ code, location: 0x04, position: 0x04 });
            else expect(view.seats[0].graveyard.some(c => c.code === code)).toBe(true);
          }
        }
      } finally { game.close(); }
    });
  });
}
