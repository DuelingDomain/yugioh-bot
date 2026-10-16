import { join } from "node:path";
import { expect, it } from "vitest";
import { defaultDuelSettings, seatCountFor, type DuelAnswer, type DuelEngineChoice, type DuelFormat,
  type DuelMode, type ReplaySource } from "@yugidraft/shared/duels";
import { OcgLocation } from "ocgcore-wasm";
import { GameWorker, type GameOptions } from "../src/worker-client.js";
import { runJournalPrefix } from "../src/journal-runner.js";
import { getCurrentEngineResources } from "../src/engine-resource-resolver.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";
import { replaySource } from "./support/replay-fixtures.js";

const FUSION = 41462083; // Thousand Dragon: a Fusion without a summon restriction.
const PENDULUM = 94415058; // Stargazer Magician: used only to probe whether PZ activation exists.
const variants = (["normal", "domain"] as const).flatMap(mode => [
  { mode, format: "1v1" as const, engine: "pinned" as const },
  { mode, format: "1v1" as const, engine: "legacy" as const },
  ...(["tag", "ffa3", "ffa4"] as const).map(format => ({ mode, format, engine: "pinned" as const })),
]);

type Variant = { mode: DuelMode; format: DuelFormat; engine: DuelEngineChoice };
function options({ mode, format, engine }: Variant, genesys: boolean): GameOptions {
  return { mode, format, engine, dataDirectory: DATA, seed: ["1", "2", "3", "4"],
    scriptErrorMode: "strict", firstTurnDraw: false,
    settings: { ...defaultDuelSettings(mode, format), genesys: genesys ? { pointCap: 100 } : null,
      shuffleDeck: false, stopAtEveryWindow: false },
    decks: Array.from({ length: seatCountFor(format) }, () => ({
      main: Array(40).fill(46986414), extra: [FUSION], side: [], ...(mode === "domain" ? { deckMaster: 48305365 } : {}),
    })),
    startupScripts: [{ name: "genesys-field-probe.lua", content: `
      Debug.AddCard(${PENDULUM},0,0,LOCATION_HAND,0,POS_FACEDOWN_DEFENSE)
      local e=Effect.GlobalEffect()
      e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
      e:SetCode(EVENT_STARTUP)
      e:SetOperation(function(e,tp)
        e:Reset()
        local c=Duel.GetFieldCard(tp,LOCATION_EXTRA,0)
        Duel.SpecialSummon(c,SUMMON_TYPE_FUSION,tp,tp,false,false,POS_FACEUP_ATTACK)
        c:CompleteProcedure()
      end)
      Duel.RegisterEffect(e,0)
    ` }],
  };
}

function savedSource(config: GameOptions, resources: ReturnType<typeof getCurrentEngineResources>): ReplaySource {
  const source = replaySource(config.format);
  source.session.mode = config.mode;
  source.session.settings = structuredClone(config.settings!);
  source.decks = structuredClone(config.decks);
  source.bundleVersion = resources.bundleVersion;
  source.engineIdentity = resources.identity;
  source.setup = { engine: config.engine, firstTurnDraw: config.firstTurnDraw, scriptErrorMode: config.scriptErrorMode,
    startupScripts: config.startupScripts?.map(script => script.content) };
  source.commands = [];
  return source;
}

describeWithCores("Genesys field on real workers and journal rebuilds", [needs.cards(DATA), needs.scripts(DATA),
  needs.standard(DATA), needs.domain(DATA), needs.installedMulti(DATA),
  needs.file("multi Domain core", join(DATA, "ocgcore.multi-domain.wasm")),
  needs.file("legacy Domain core", join(DATA, "ocgcore.domain.legacy.wasm"))], () => {
  it.each(["pinned", "legacy"] as const)("%s MR3: clears separate PZs and retains other Master Rule flags", async engine => {
    const config = options({ mode: "normal", format: "1v1", engine }, true);
    config.masterRule = 3;
    config.settings!.genesys = { pointCap: 0 };
    config.startupScripts!.unshift({ name: "genesys-mr3-flags.lua", content: `
      assert(not Duel.IsDuelType(DUEL_EMZONE), "Genesys must not enable EMZ")
      assert(not Duel.IsDuelType(DUEL_PZONE), "Genesys must not enable PZ")
      assert(not Duel.IsDuelType(DUEL_SEPARATE_PZONE), "Genesys must not enable separate PZ")
      assert(Duel.IsDuelType(DUEL_SPSUMMON_ONCE_OLD_NEGATE), "Keep MR3 summon rules")
      assert(Duel.IsDuelType(DUEL_CANNOT_SUMMON_OATH_OLD), "Keep MR3 summon oath")
      assert(not Duel.CheckLocation(0,LOCATION_PZONE,0), "No available Pendulum Zone")
    ` });
    const worker = new GameWorker();
    try {
      await worker.create(config);
      const view = await worker.view(0);
      expect(view.field).toEqual({ genesys: true });
      expect(view.prompt!.options.map(option => option.sequence)).toEqual([0, 1, 2, 3, 4]);
    } finally { await worker.close(); }
  });

  it.each(variants)("$mode $format $engine: missing Genesys settings match explicit off", async variant => {
    const config = options(variant, false);
    const opening = async () => {
      const worker = new GameWorker();
      try { await worker.create(config); return await worker.view(0); }
      finally { await worker.close(); }
    };
    const explicitOff = await opening();
    delete config.settings!.genesys;
    expect(await opening()).toEqual(explicitOff);
  });

  it.each(variants.flatMap(variant => [false, true].map(genesys => ({ ...variant, genesys }))))(
    "$mode $format $engine Genesys=$genesys: Fusion placement, PZ activation and replay", async ({ genesys, ...variant }) => {
      const config = options(variant, genesys);
      const resources = getCurrentEngineResources(DATA, variant);
      const source = savedSource(config, resources);
      const journalResources = { ...resources, bundleVersion: resources.rawBundleVersion!, engineIdentity: resources.identity };
      const errors: string[] = [];
      const worker = new GameWorker(error => errors.push(error.message), error => errors.push(error.message));
      try {
        await worker.create({ ...config, engineIdentity: resources.identity, multiScriptsDirectory: resources.multiScriptsDirectory });
        const before = await worker.view(0);
        expect(before.prompt?.kind).toBe("places");
        const places = before.prompt!.options;
        expect(places.map(option => [option.location, option.sequence])).toEqual(
          Array.from({ length: genesys ? 5 : 7 }, (_, sequence) => [OcgLocation.MZONE, sequence]));
        const answer: DuelAnswer = { selected: [places.find(option => option.sequence === 2)!.id] };
        source.commands.push({ storedSeq: 1, seat: 0, command: { revision: before.revision, promptId: before.prompt!.id, answer } });
        await worker.answer(0, before.prompt!.id, answer);
        const after = await worker.view(0);
        expect(after.seats[0]!.monsters[2]?.code).toBe(FUSION);
        expect(after.seats.every(seat => seat.monsters.slice(5).every(card => card === null))).toBe(true);
        // PZs share ordinary S/T slots in MR5; test the actual activation action rather than hiding S/T 0/4.
        expect(after.prompt?.options.some(option => option.id.startsWith("activate:") && option.card?.code === PENDULUM)).toBe(!genesys);
        for (const seat of [null, ...Array.from({ length: seatCountFor(variant.format) }, (_, seat) => seat)]) {
          const view = await worker.view(seat);
          expect(view.field?.genesys ?? false).toBe(genesys);
          if (genesys && variant.format !== "1v1") expect(view.seats.map(entry => entry.sharedExtraWith)).toEqual(view.seats.map(() => null));
        }
        if (!genesys) expect(after).not.toHaveProperty("field");
        const replay = await runJournalPrefix({ source, resources: journalResources, prefixCount: source.commands.length,
          createWorker: () => new GameWorker() });
        try {
          expect(replay.views.seats[0]).toEqual(after);
          expect(replay.views.public.field?.genesys ?? false).toBe(genesys);
          const recovered = await runJournalPrefix({ source, resources: journalResources, prefixCount: source.commands.length,
            target: { revision: after.revision, stateDigest: replay.stateDigest }, createWorker: () => new GameWorker() });
          await recovered.worker.close();
        } finally { await replay.worker.close(); }
        expect(errors).toEqual([]);
      } finally { await worker.close(); }
    }, 30_000);
});
