import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import createCore, { OcgDuelMode, OcgMessageType, OcgProcessResult, type OcgMessage, type OcgMessageCardHint } from "ocgcore-wasm";
import { installCardScriptPatches } from "../scripts/card-script-patches.js";
import { cardScriptPatchesHash } from "../src/card-script-patches.js";
import { loadCardDatabase } from "../src/cards.js";
import { loadMultiScripts, repoMultiScriptsDirectory } from "../src/multi-scripts.js";
import { legacyNormalScript } from "../src/legacy/script-compat.js";
import { createEngineGame, type EngineGame } from "../src/engine.js";
import { createLegacyEngineGame } from "../src/legacy/index.js";
import { engineDataDirectory } from "./engine-data-dir.js";
import { currentDomainMultiWasm, currentMultiWasm, describeWithCores, needs } from "./support/cores.js";
import { compileBoard, type BoardSpec } from "./support/board.js";
import { activate, defineScenario, endTurn, expectBoard, pickOpponent, yes, type Step } from "./support/dsl.js";
import { Session } from "./support/session.js";

const PROTECTION_CARDS = [44001993, 37818794, 98684220, 70488851, 4063756, 28904860, 10000080, 70405001,
  60465049, 15982593, 8165596, 98127546, 60303688, 76666602, 86682165, 77313225, 54757758, 89812483, 56733747, 94977269];
let directory = "";

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "protection-hints-"));
  for (const name of ["cards.cdb", "strings.conf"]) symlinkSync(join(engineDataDirectory, name), join(directory, name));
  // The manifest names the remap artifact in its integrity block, so the preflight and the engine need the file too.
  if (existsSync(join(engineDataDirectory, "card-remaps.json"))) symlinkSync(join(engineDataDirectory, "card-remaps.json"), join(directory, "card-remaps.json"));
  for (const name of readdirSync(engineDataDirectory).filter(name => name.endsWith(".wasm") || name.endsWith(".sha256"))) symlinkSync(join(engineDataDirectory, name), join(directory, name));
  // A CI bundle carries the multi cores without checksum sidecars; the preflight refuses a multi core that has none.
  for (const core of ["ocgcore.multi", "ocgcore.multi-domain"]) {
    const wasm = join(directory, `${core}.wasm`), sidecar = join(directory, `${core}.sha256`);
    if (existsSync(wasm) && !existsSync(sidecar)) writeFileSync(sidecar, `${createHash("sha256").update(readFileSync(wasm)).digest("hex")}  ${core}.wasm\n`);
  }
  const scripts = join(directory, "card-scripts");
  const patched = new Set(["host-protection-hints.lua", "utility.lua", "card_counter_constants.lua", "c3743515.lua", ...PROTECTION_CARDS.map(code => `c${code}.lua`)]);
  for (const name of readdirSync(join(engineDataDirectory, "card-scripts"), { recursive: true }).map(String).filter(name => name.endsWith(".lua"))) {
    const destination = join(scripts, name);
    mkdirSync(dirname(destination), { recursive: true });
    const source = join(engineDataDirectory, "card-scripts", name);
    // Preparation writes only private copies. Other installed resources remain read-only symlinks.
    if (patched.has(name.split("/").at(-1)!)) copyFileSync(source, destination);
    else symlinkSync(source, destination);
  }
  // The owner-provided engine bundle predates these pinned shared helpers.
  for (const [name, path] of [["card_counter_constants.lua", "card_counter_constants.lua"], ["c3743515.lua", "official/c3743515.lua"], ["utility.lua", "utility.lua"]]) {
    copyFileSync(new URL(`./fixtures/card-scripts/${name}`, import.meta.url), join(scripts, path!));
  }
  // Shared upstream utility changes must not require reviewing twenty unchanged card suffixes.
  writeFileSync(join(scripts, "utility.lua"), readFileSync(join(scripts, "utility.lua"), "utf8") + "\n-- upstream utility update\n");
  installCardScriptPatches(scripts);
});
afterAll(() => {
  if (directory) { loadCardDatabase(directory).close(); rmSync(directory, { recursive: true, force: true }); }
});

it("receipts validate the host helper and installation rejects tampered helper bytes", () => {
  const scripts = join(directory, "card-scripts");
  const manifest = JSON.parse(readFileSync(join(engineDataDirectory, "manifest.json"), "utf8"));
  manifest.integrity.cardScriptPatches = cardScriptPatchesHash(scripts);
  writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest));
  symlinkSync(join(engineDataDirectory, "multi-scripts"), join(directory, "multi-scripts"));
  const utility = readFileSync(join(scripts, "utility.lua"), "utf8");
  // A cached bundle made before the helper extraction must restore stock utility.lua.
  const receipt = join(scripts, ".host-card-script-patches.json");
  const previous = JSON.parse(readFileSync(receipt, "utf8"));
  previous.push({ stockPath: "utility.lua", stockSha256: createHash("sha256").update(utility).digest("hex"), suffix: "utility.lua" });
  writeFileSync(receipt, JSON.stringify(previous));
  writeFileSync(join(scripts, "utility.lua"), utility + "\n-- BEGIN HOST CARD SCRIPT PATCH\n" + readFileSync(join(scripts, "host-protection-hints.lua"), "utf8"));
  expect(installCardScriptPatches(scripts)).toBe(manifest.integrity.cardScriptPatches);
  expect(utility).not.toContain("BEGIN HOST CARD SCRIPT PATCH");
  expect(installCardScriptPatches(scripts)).toBe(manifest.integrity.cardScriptPatches);
  expect(readFileSync(join(scripts, "utility.lua"), "utf8")).toBe(utility);
  const helper = join(scripts, "host-protection-hints.lua"), original = readFileSync(helper, "utf8");
  const preflight = () => spawnSync("sh", [fileURLToPath(new URL("../scripts/install-engine-bundle.sh", import.meta.url))], {
    encoding: "utf8", env: { ...process.env, DUEL_PREFLIGHT: "1", DUEL_BUNDLE_SRC: directory, DUEL_DATA_DIR: join(directory, "preflight-target") },
  });
  try {
    const valid = preflight();
    expect(valid.status, valid.stdout + valid.stderr).toBe(0);
    writeFileSync(helper, original + "\n-- tampered\n");
    expect(cardScriptPatchesHash(scripts)).not.toBe(manifest.integrity.cardScriptPatches);
    const invalid = preflight();
    expect(invalid.status).not.toBe(0);
    expect(invalid.stderr).toContain("patched file hash mismatch");
  } finally { writeFileSync(helper, original); }
});

type Variant = "legacy" | "pinned" | "multi" | "legacy-domain" | "pinned-domain" | "multi-domain";
async function exercise(variant: Variant, board: string, transitions = ""): Promise<OcgMessageCardHint[]> {
  const data = loadCardDatabase(directory);
  const multi = variant.startsWith("multi"), domain = variant.endsWith("domain"), legacy = variant.startsWith("legacy");
  const overlay = multi ? loadMultiScripts(repoMultiScriptsDirectory()) : undefined;
  const wasmFile = domain ? legacy ? "ocgcore.domain.legacy.wasm" : multi ? "ocgcore.multi-domain.wasm" : "ocgcore.domain.wasm"
    : multi ? "ocgcore.multi.wasm" : "ocgcore.standard.wasm";
  const wasmPath = multi ? domain ? currentDomainMultiWasm() : currentMultiWasm() : join(engineDataDirectory, wasmFile);
  const bytes = variant === "legacy" ? undefined : readFileSync(wasmPath);
  const wasm = bytes?.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer | undefined;
  const lib = await createCore({ sync: true, ...(wasm ? { wasmBinary: wasm } : {}), ...(legacy ? { legacyMessages: true } : {}) });
  const errors: string[] = [];
  const team = { startingLP: 8000, startingDrawCount: 0, drawCountPerTurn: 0 };
  const handle = lib.createDuel({ flags: OcgDuelMode.MODE_MR5, seed: [1n, 2n, 3n, 4n], team1: team, team2: team,
    cardReader: code => data.cardData(code), scriptReader: name => {
      const content = data.readScript(name, overlay);
      return legacy ? legacyNormalScript(name, content) : content;
    },
    errorHandler: (_type, message) => errors.push(message) });
  if (!handle) throw new Error("Failed to create protection hint duel");
  const messages: OcgMessage[] = [];
  const load = (name: string, content: string) => expect(lib.loadScript(handle, name, content), errors.join("\n")).toBe(true);
  try {
    if (multi) load("setup.lua", "Debug.SetupDuelists(3,0,1,2)");
    for (const name of ["constant.lua", "utility.lua"]) load(name, data.readScript(name)!);
    if (domain) load("domain.lua", data.readScript(legacy ? "domain.legacy.lua" : "domain.lua")!);
    if (overlay) load("mp-utility.lua", overlay.utility);
    load("board.lua", `
      for seat=0,${multi ? 2 : 1} do
        for i=1,20 do Debug.AddCard(15025844,seat,seat,LOCATION_DECK,0,POS_FACEDOWN) end
        ${domain ? "Debug.AddCard(89631139,seat,seat,0x4000,0,POS_FACEUP_ATTACK,true)" : ""}
      end
      ${board}
      ${transitions ? `local stage=0
        local observer=Effect.GlobalEffect()
        observer:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
        observer:SetCode(EVENT_ADJUST)
        observer:SetOperation(function(e)
          ${transitions}
        end)
        Duel.RegisterEffect(observer,0)` : ""}
    `);
    lib.startDuel(handle);
    for (let calls = 0; calls < 100; calls++) {
      const status = lib.duelProcess(handle);
      messages.push(...lib.duelGetMessage(handle));
      if (status !== OcgProcessResult.CONTINUE) break;
    }
    expect(errors).toEqual([]);
    return messages.filter((message): message is OcgMessageCardHint => message.type === OcgMessageType.CARD_HINT);
  } finally { lib.destroyDuel(handle); }
}

const hintsAt = (messages: OcgMessageCardHint[], seat: number, sequence: number) => messages
  .filter(message => message.controller === seat && message.location === 4 && message.sequence === sequence)
  .map(message => [message.card_hint, Number(message.description)]);

async function open(variant: Variant, board: BoardSpec) {
  const domain = variant.endsWith("domain"), multi = variant.startsWith("multi");
  const setup: BoardSpec = { ...board, skipOpeningDraw: true, mode: domain ? "domain" : "normal", format: multi ? "ffa3" : "1v1" };
  if (domain) for (const seat of (["p0", "p1", "p2"] as const).slice(0, multi ? 3 : 2)) setup[seat] = { deckMaster: 89631139, ...setup[seat] };
  const scenario = defineScenario({ id: "protection-resolve", title: "Real protection resolution", source: "Stock protection scripts", tags: [], setup, steps: [] });
  const bytes = multi ? readFileSync(domain ? currentDomainMultiWasm() : currentMultiWasm()) : undefined;
  const game: EngineGame = await (variant.startsWith("legacy") ? createLegacyEngineGame : createEngineGame)({
    ...compileBoard(setup, directory).options, dataDirectory: directory, seed: ["1", "2", "3", "4"],
    ...(bytes ? { multiWasmBinary: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer } : {}),
  });
  const session = new Session(scenario, game);
  session.reachMainPhase();
  let index = 0;
  return { game, run: (...steps: Step[]) => steps.forEach(step => session.run(step, ++index)) };
}

const stockCases = [
  { code: 44001993, expected: [0x70000001], extra: "Debug.AddCard(24094653,0,0,LOCATION_SZONE,1,POS_FACEUP)" },
  { code: 37818794, expected: [3001, 3002] },
  { code: 98684220, expected: [0x70000003], extra: "Debug.AddCard(21082832,0,0,LOCATION_GRAVE,0,POS_FACEUP)" },
  { code: 70488851, expected: [0x70000002] },
  { code: 4063756, expected: [0x70000003], sequence: 5,
    extra: "Debug.AddCard(15025844,0,0,LOCATION_MZONE,0,POS_FACEUP_ATTACK) Debug.AddCard(15025844,0,0,LOCATION_MZONE,1,POS_FACEUP_ATTACK)" },
  { code: 28904860, expected: [], location: "LOCATION_SZONE",
    extra: "Debug.AddCard(28904860,0,0,LOCATION_MZONE,1,POS_FACEUP_ATTACK)" },
  { code: 10000080, expected: [3007, 3061] },
  { code: 70405001, expected: [3000, 0x70000001] },
  { code: 60465049, expected: [0x70000003], extra: "Debug.PreSummon(c,SUMMON_TYPE_SYNCHRO,LOCATION_EXTRA)" },
  { code: 15982593, expected: [], extra: "Debug.AddCard(15025844,0,0,LOCATION_MZONE,1,POS_FACEUP_ATTACK)" },
  { code: 8165596, expected: [3001], extra: "Debug.AddCard(65367484,0,0,LOCATION_MZONE,0,POS_FACEUP_ATTACK)" },
  { code: 98127546, expected: [0x70000001] },
  { code: 60303688, expected: [0x70000004] },
  { code: 76666602, expected: [3100], extra: "Debug.AddCard(60303688,0,0,LOCATION_GRAVE,0,POS_FACEUP)" },
  { code: 77313225, expected: [3060] },
  { code: 54757758, expected: [0x70000008] },
  { code: 56733747, expected: [3001] },
  { code: 94977269, expected: [3060] },
];

for (const variant of ["legacy", "pinned", "multi", "legacy-domain", "pinned-domain", "multi-domain"] as const) {
  describeWithCores(`active protection overlays on ${variant}`, [needs.cards(), needs.scripts(),
    ...(variant.startsWith("pinned") ? [variant.endsWith("domain") ? needs.domain() : needs.standard()]
      : variant.startsWith("multi") ? [needs.multi(variant.endsWith("domain") ? currentDomainMultiWasm() : currentMultiWasm())]
        : variant.endsWith("domain") ? [needs.file("legacy Domain core", join(engineDataDirectory, "ocgcore.domain.legacy.wasm"))] : [])], () => {
    it.each(stockCases)("mirrors the real protection of card $code", async ({ code, expected, extra = "", sequence = 0, location = "LOCATION_MZONE" }) => {
      const messages = await exercise(variant, `local c=Debug.AddCard(${code},0,0,${location},${sequence},POS_FACEUP_ATTACK,true) ${extra}`);
      const own = messages.filter(message => message.controller === 0 && message.location === (location === "LOCATION_MZONE" ? 4 : 8)
        && message.sequence === sequence && message.card_hint === 6).map(message => Number(message.description));
      expect(own).toEqual(expected);
      if (code === 44001993 || code === 28904860) expect(messages.some(message => message.sequence === 1
        && message.description === BigInt(code === 44001993 ? 3060 : 0x70000007))).toBe(true);
      if (code === 15982593) expect(hintsAt(messages, 0, 1)).toEqual([[6, 3000]]);
    });

    it("adds, removes and restores Dragoon's real protections when its effects are negated", async () => {
      const messages = await exercise(variant, "local c=Debug.AddCard(37818794,0,0,LOCATION_MZONE,0,POS_FACEUP_ATTACK,true)", `
        if stage==0 then
          stage=1
          disable=Effect.CreateEffect(c)
          disable:SetType(EFFECT_TYPE_SINGLE)
          disable:SetCode(EFFECT_DISABLE)
          disable:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)
          c:RegisterEffect(disable,true)
          Duel.AdjustInstantly(c)
          Duel.Readjust()
        elseif stage==1 then
          assert(c:IsDisabled(),"Dragoon must actually be negated")
          stage=2
          disable:Reset()
          Duel.AdjustInstantly(c)
          Duel.Readjust()
        end
      `);
      expect(hintsAt(messages, 0, 0)).toEqual([[6, 3001], [6, 3002], [7, 3001], [7, 3002], [6, 3001], [6, 3002]]);
    });

    it("tracks Psychic End Punisher's actual Synchro and LP conditions", async () => {
      expect(hintsAt(await exercise(variant, "Debug.AddCard(60465049,0,0,LOCATION_MZONE,0,POS_FACEUP_ATTACK,true)"), 0, 0)).toEqual([]);
      const messages = await exercise(variant, `local c=Debug.AddCard(60465049,0,0,LOCATION_MZONE,0,POS_FACEUP_ATTACK,true)
        Debug.PreSummon(c,SUMMON_TYPE_SYNCHRO,LOCATION_EXTRA)`, `
        if stage==0 then stage=1 Duel.SetLP(0,9000) Duel.Readjust()
        elseif stage==1 then stage=2 Duel.SetLP(0,8000) Duel.Readjust() end
      `);
      expect(hintsAt(messages, 0, 0)).toEqual([[6, 0x70000003], [7, 0x70000003], [6, 0x70000003]]);
    });

    it("removes Photon Lord's destruction hint when its last Photon material detaches", async () => {
      expect(hintsAt(await exercise(variant, "Debug.AddCard(8165596,0,0,LOCATION_MZONE,0,POS_FACEUP_ATTACK,true)"), 0, 0)).toEqual([]);
      const messages = await exercise(variant, `local c=Debug.AddCard(8165596,0,0,LOCATION_MZONE,0,POS_FACEUP_ATTACK,true)
        Debug.AddCard(65367484,0,0,LOCATION_MZONE,0,POS_FACEUP_ATTACK)`, `
        if stage==0 then stage=1 Duel.SendtoGrave(c:GetOverlayGroup(),REASON_EFFECT) Duel.Readjust() end
      `);
      expect(hintsAt(messages, 0, 0)).toEqual([[6, 3001], [7, 3001]]);
    });

    it("updates the recipient's field protection when Legatia's effects are negated", async () => {
      const messages = await exercise(variant, `local c=Debug.AddCard(15982593,0,0,LOCATION_MZONE,0,POS_FACEUP_ATTACK,true)
        Debug.AddCard(15025844,0,0,LOCATION_MZONE,1,POS_FACEUP_ATTACK)`, `
        if stage==0 then
          stage=1
          disable=Effect.CreateEffect(c)
          disable:SetType(EFFECT_TYPE_SINGLE)
          disable:SetCode(EFFECT_DISABLE)
          disable:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)
          c:RegisterEffect(disable,true)
          Duel.AdjustInstantly(c)
          Duel.Readjust()
        elseif stage==1 then
          stage=2 disable:Reset() Duel.AdjustInstantly(c) Duel.Readjust()
        end
      `);
      expect(hintsAt(messages, 0, 0)).toEqual([]);
      expect(hintsAt(messages, 0, 1)).toEqual([[6, 3000], [7, 3000], [6, 3000]]);
    });

    it("resets and restores hints when Dragoon turns face-down and face-up", async () => {
      const messages = await exercise(variant, "local c=Debug.AddCard(37818794,0,0,LOCATION_MZONE,0,POS_FACEUP_ATTACK,true)", `
        if stage==0 then stage=1 Duel.ChangePosition(c,POS_FACEDOWN_DEFENSE) Duel.Readjust()
        elseif stage==1 then stage=2 Duel.ChangePosition(c,POS_FACEUP_ATTACK) Duel.Readjust() end
      `);
      const rows = hintsAt(messages, 0, 0);
      expect(rows.filter(row => row[0] === 6)).toEqual([[6, 3001], [6, 3002], [6, 3001], [6, 3002]]);
      expect(rows.filter(row => row[0] === 7).sort((a, b) => a[1]! - b[1]!)).toEqual([[7, 3001], [7, 3002]]);
    });

    it("resolves the protection of Ecclesia's alternate artwork through its main script", async () => {
      const messages = await exercise(variant, "Debug.AddCard(60303689,0,0,LOCATION_MZONE,0,POS_FACEUP_ATTACK,true)");
      expect(hintsAt(messages, 0, 0)).toEqual([[6, 0x70000004]]);
      expect(loadCardDatabase(directory).resolveLabel(0x70000004)).toBe("Cannot be destroyed by battle with monsters Special Summoned from the Extra Deck");
      expect(loadCardDatabase(directory).get(0x70000004)).toBeUndefined();
    });

    it("resolves Gymir Aegirine's temporary field protection and removes hints at the End Phase", async () => {
      const { game, run } = await open(variant, { p0: { monsters: [86682165, "Mystical Elf"] }, p1: { monsters: ["Mystical Elf"] } });
      try {
        expect(game.view(null).seats[0].monsters[0]?.hints).toBeUndefined();
        run(activate(86682165));
        if (variant.startsWith("multi")) run(pickOpponent("p1"));
        run(expectBoard({}));
        for (const card of game.view(null).seats[0].monsters.filter(Boolean)) expect(card?.hints).toMatchObject([{ descriptionId: "3060" }]);
        expect(game.view(null).seats[1].monsters[0]?.hints).toBeUndefined();
        run(endTurn("p0"));
        for (const card of game.view(null).seats[0].monsters.filter(Boolean)) expect(card?.hints).toBeUndefined();
      } finally { game.close(); }
    });

    it("resolves Max Metalmorph's equip protection on the equipped monster", async () => {
      const { game, run } = await open(variant, { p0: { monsters: ["Blue-Eyes White Dragon"],
        spells: [{ card: 89812483, pos: "set" }], deck: [80870883] }, p1: {} });
      try {
        run(activate(89812483));
        if (variant.startsWith("multi")) run(pickOpponent("p1"));
        run(yes("p0"), expectBoard({}));
        expect(game.view(null).seats[0].monsters[0]).toMatchObject({ code: 80870883, attack: 3800, hints: [
          { descriptionId: String(0x70000005), text: "Cannot be destroyed by monster or Spell effects" },
          { descriptionId: String(0x70000006), text: "Cannot be targeted by your opponent's monster or Spell effects" },
        ] });
        expect(game.view(null).seats[0].spells.find(card => card?.code === 89812483)?.hints).toBeUndefined();
      } finally { game.close(); }
    });
  });
}
