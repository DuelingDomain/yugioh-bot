import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import createCore, { OcgDuelMode, OcgLocation, OcgPosition, OcgQueryFlags } from "ocgcore-wasm";
import { loadCardDatabase } from "../src/cards.js";
import { engineDataDirectory } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";
import { oddEyesAtSummonWindow } from "./support/attack-stats.js";

const monsters = [
  { code: 16306932, name: "Odd-Eyes Revolution Dragon", printed: -2, field: 4000 },
  { code: 10000020, name: "Slifer the Sky Dragon", printed: -2, field: 5000 },
  { code: 10000010, name: "The Winged Dragon of Ra", printed: -2, field: 0 },
  { code: 10000000, name: "Obelisk the Tormentor", printed: 4000, field: 4000 },
  { code: 64681432, name: "Gandora the Dragon of Destruction", printed: 0, field: 0 },
];
const flags = (OcgQueryFlags.CODE | OcgQueryFlags.ATTACK | OcgQueryFlags.DEFENSE
  | OcgQueryFlags.BASE_ATTACK | OcgQueryFlags.BASE_DEFENSE | OcgQueryFlags.LEVEL
  | OcgQueryFlags.RANK | OcgQueryFlags.LINK) as OcgQueryFlags;

for (const variant of ["legacy", "legacy-domain", "standard", "domain", "multi", "multi-domain"] as const) {
  const wasmName = variant === "legacy" ? undefined
    : variant === "legacy-domain" ? "ocgcore.domain.legacy.wasm" : `ocgcore.${variant}.wasm`;
  describeWithCores(`signed attack queries (${variant})`, [needs.cards(), needs.scripts(),
    ...(wasmName ? [needs.file(`${variant} core`, join(engineDataDirectory, wasmName))] : [])], () => {
    it("preserves printed ? stats in single and location queries and computes live field stats", async () => {
      const cards = loadCardDatabase(engineDataDirectory);
      const core = await createCore({ sync: true,
        ...(wasmName ? { wasmBinary: readFileSync(join(engineDataDirectory, wasmName)) } : {}),
        ...(variant.startsWith("legacy") ? { legacyMessages: true } : {}),
      } as Parameters<typeof createCore>[0] & { sync: true });
      const errors: string[] = [];
      const team = { startingLP: 8000, startingDrawCount: 0, drawCountPerTurn: 0 };
      const handle = core.createDuel({ flags: OcgDuelMode.MODE_MR5, seed: [1n, 2n, 3n, 4n],
        team1: team, team2: team, cardReader: cards.cardData, scriptReader: cards.readScript,
        errorHandler: (_type, text) => errors.push(text),
      });
      assert(handle);
      try {
        for (const name of ["constant.lua", "utility.lua"]) {
          const script = cards.readScript(name);
          assert(script);
          assert(core.loadScript(handle, name, script));
        }
        for (const [sequence, monster] of monsters.entries()) {
          expect(cards.cardData(monster.code)?.attack, monster.name).toBe(monster.printed);
          for (const location of [OcgLocation.HAND, OcgLocation.MZONE]) {
            core.duelNewCard(handle, { team: 0, duelist: 0, code: monster.code, controller: 0,
              location, sequence, position: OcgPosition.FACEUP_ATTACK });
          }
        }
        for (const location of [OcgLocation.HAND, OcgLocation.MZONE]) {
          const queries = core.duelQueryLocation(handle, { controller: 0, location, flags });
          for (const [sequence, monster] of monsters.entries()) {
            const single = core.duelQuery(handle, { controller: 0, location, sequence, overlaySequence: 0, flags });
            const expected = location === OcgLocation.HAND ? monster.printed : monster.field;
            expect(single, monster.name).toMatchObject({ code: monster.code, attack: expected, defense: expected,
              baseAttack: location === OcgLocation.HAND ? monster.printed : Math.max(0, monster.printed),
              baseDefense: location === OcgLocation.HAND ? monster.printed : Math.max(0, monster.printed),
            });
            expect(queries[sequence], monster.name).toEqual(single);
          }
        }
        // The real effect tracks LP, and the core clamps ATK reductions below zero.
        assert(core.loadScript(handle, "reduce-attack.lua", `
          Duel.SetLP(1,2000)
          local c=Duel.GetFieldCard(0,LOCATION_MZONE,0)
          assert(c:GetAttack()==1000 and c:GetDefense()==1000)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_SINGLE)
          e:SetCode(EFFECT_UPDATE_ATTACK)
          e:SetValue(-10000)
          c:RegisterEffect(e)
        `));
        expect(core.duelQuery(handle, { controller: 0, location: OcgLocation.MZONE, sequence: 0,
          overlaySequence: 0, flags })).toMatchObject({ attack: 0, defense: 1000 });
        expect(errors).toEqual([]);
      } finally { core.destroyDuel(handle); }
    });
  });
}

for (const [format, legacy] of [["1v1", false], ["1v1", true], ["ffa3", false], ["ffa4", false], ["tag", false]] as const) {
  describeWithCores(`Odd-Eyes real summon (${format}, ${legacy ? "legacy" : "pinned"})`,
    [needs.cards(), needs.scripts(), ...(format === "1v1" ? [needs.standard()] : [needs.installedMulti()])], () => {
      it("has ? stats during summon negation and applies its LP effect after summon", async () => {
        const game = await oddEyesAtSummonWindow(format, legacy);
        try {
          const prompt = game.view(1).prompt;
          expect(prompt?.options.some(option => option.card?.name === "Solemn Judgment")).toBe(true);
          for (const viewer of [0, 1, null]) {
            expect(game.view(viewer).seats[0].monsters[0]).toMatchObject({ code: 16306932, attack: -2, defense: -2 });
          }
          assert(prompt);
          game.answer(1, prompt.id, { cancel: true });
          const attack = game.view(0).seats[1].lp / 2;
          expect(game.view(0).seats[0].monsters[0]).toMatchObject({ code: 16306932, attack, defense: attack });
          if (format === "1v1") {
            game.answer(0, game.view(0).prompt!.id, { choice: "to_bp" });
            const battlePrompt = game.view(0).prompt!;
            const command = battlePrompt.options.find(option => option.id.startsWith("attack:"));
            assert(command);
            game.answer(0, battlePrompt.id, { choice: command.id });
            const events = game.view(0).events;
            expect(events.find(event => event.kind === "battle")?.battle).toMatchObject({
              attacker: { attack: 4000, defense: 4000 }, target: { attack: 800, defense: 2000 },
            });
            expect(events.find(event => event.kind === "damage")).toMatchObject({ amount: 3200 });
          }
        } finally { game.close(); }
      });
    });
}
