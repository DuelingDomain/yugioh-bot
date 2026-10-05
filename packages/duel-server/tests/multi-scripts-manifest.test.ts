import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  COMPARE_EXTRA, COMPARE_FALSE_POSITIVES, EXPECTED_COUNTS, MIRROR_GATE, OVERLAY_DIRECTORY, R1_COMPLETE, R1_NO_CHANGE, R2_NO_CHANGE, TRIAGE_FILE,
  cardName, checkLists, fillMissingNames, r1Codes, r1Entry, readManifest, readTriage, registerR1, run, wholeFileText, type Manifest, type ManifestCard, type Triage,
} from "../scripts/generate-multi-scripts.js";
import { makeSource, scanCorpus } from "../scripts/scan-multiplayer-scripts.js";
import { currentEngineDataDirectory } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";

// The overlay checks cover MANIFEST.json, the cNNN.lua files and the generator (F7 design, part P3a).
// The checks that need the stock scripts or the triage file (both are not in git) are skipped when the file is missing,
// and fail with DUEL_REQUIRE_CORES=1 (stock scripts) or stay a skip (triage, a local file).

const KINDS = ["whole", "expr", "trig", "hand", "chooser", "fix", "seat"];
const CREATURE_SWAP = 31036355;
const manifest = readManifest();
const cards = manifest.cards;
const text = (card: ManifestCard) => readFileSync(join(OVERLAY_DIRECTORY, card.file), "utf8");
const helperText = readFileSync(join(OVERLAY_DIRECTORY, "mp-utility.lua"), "utf8");
const clone = (): Manifest => JSON.parse(JSON.stringify(manifest)) as Manifest;
const stockDirectory = process.env.DUEL_SCRIPTS_DIR ?? join(currentEngineDataDirectory(), "card-scripts/official");
const stock = needs.file("official script corpus", stockDirectory, "Set DUEL_SCRIPTS_DIR, or set DUEL_DATA_DIR to an engine data directory with card-scripts/official.");
const triageNeed = needs.localFile("multiplayer triage", TRIAGE_FILE, "Run scripts/scan-multiplayer-scripts.ts to write .status/multiplayer-triage.json.");
const stockText = (code: number) => readFileSync(existsSync(join(stockDirectory, `c${code}.lua`)) ? join(stockDirectory, `c${code}.lua`) : join(stockDirectory, "../pre-errata", `c${code}.lua`), "utf8");

function isActivationCheck(body: string, name: string): boolean {
  const source = makeSource(body);
  const unit = source.units.find(unit => unit.name === `s.${name}`);
  if (!unit) return false;
  const callback = source.clean.slice(unit.start - 1, unit.end).join("\n");
  const parameters = new RegExp(`function s\\.${name}\\(([^)]*)\\)`).exec(callback)?.[1]?.split(",").map(parameter => parameter.trim());
  return Boolean(parameters?.includes("chk") && /\bif\s+chk\s*==\s*0\s+then\b/.test(callback));
}

describe("MANIFEST.json of the overlay", () => {
  it("lists cards with a valid kind, a file named after the code and a name", () => {
    expect(manifest.version).toBe(1);
    expect(cards.filter((card) => !card.classes.includes("R1") && !card.classes.includes("R2") && !card.classes.includes("ATTACK"))).toHaveLength(EXPECTED_COUNTS.entries);
    for (const card of cards) {
      expect(KINDS, String(card.code)).toContain(card.kind);
      expect(card.file).toBe(`c${card.code}.lua`);
      expect(card.name, String(card.code)).toBeTruthy();
      expect(existsSync(join(OVERLAY_DIRECTORY, card.file)), card.file).toBe(true);
    }
  });

  it("has a file in the folder for each entry and no other cNNN.lua", () => {
    const files = readdirSync(OVERLAY_DIRECTORY).filter((file) => /^c\d+\.lua$/.test(file)).sort();
    expect(files).toEqual(cards.map((card) => card.file).sort());
  });

  it("has no problem in the lists and counts (54 compare, 44 chooser, 6 whole)", () => {
    expect(checkLists(manifest, null)).toEqual([]);
    expect(cards.filter((card) => card.classes.includes("COMPARE"))).toHaveLength(EXPECTED_COUNTS.compare);
    expect(cards.filter((card) => card.classes.includes("CHOOSER") && !COMPARE_EXTRA.includes(card.code))).toHaveLength(EXPECTED_COUNTS.chooser);
    expect(cards.filter((card) => card.kind === "whole")).toHaveLength(EXPECTED_COUNTS.whole);
  });

  it("reports a twice-listed card, a wrong count and a missing Mirror Gate fix", () => {
    const twice = clone();
    twice.cards.push(twice.cards[0]);
    expect(checkLists(twice, null).join("\n")).toContain("listed twice");
    const fewer = clone();
    fewer.cards = fewer.cards.filter((card) => card.code !== 8814959);
    const problems = checkLists(fewer, null).join("\n");
    expect(problems).toContain("COMPARE has 53 cards");
    expect(problems).toContain(`${EXPECTED_COUNTS.whole - 1} whole files`);
    expect(problems).toContain(`${EXPECTED_COUNTS.entries - 1} entries`);
    const noFix = clone();
    noFix.cards.find((card) => card.code === MIRROR_GATE)!.kind = "expr";
    expect(checkLists(noFix, null).join("\n")).toContain("Mirror Gate");
  });

  it("checks the lists against a triage when one is given", () => {
    const compare = cards.filter((card) => card.classes.includes("COMPARE") && !COMPARE_EXTRA.includes(card.code));
    const chooser = cards.filter((card) => card.classes.includes("CHOOSER") && !COMPARE_EXTRA.includes(card.code));
    const triage: Triage[] = [
      ...compare.map((card) => ({ code: card.code, name: card.name, group: "field-count-compare", rule: "CH-X" })),
      ...COMPARE_FALSE_POSITIVES.map((code) => ({ code, name: "false positive", group: "field-count-compare", rule: "X" })),
      ...chooser.map((card) => ({ code: card.code, name: card.name, group: "other", rule: "CHOOSER-X" })),
    ];
    expect(checkLists(manifest, triage).filter((problem) => problem.includes("differs"))).toEqual([]);
    const extra = [...triage, { code: 1, name: "new compare card", group: "field-count-compare", rule: "X" }];
    expect(checkLists(manifest, extra).join("\n")).toContain("COMPARE differs from the triage: extra [], missing [1]");
    const lost = triage.filter((entry) => entry.code !== chooser[0].code);
    expect(checkLists(manifest, lost).join("\n")).toContain(`CHOOSER differs from the triage: extra [${chooser[0].code}]`);
  });

  it("counts R1 as EACH-DUELIST and SCRIPT rules without Mirror Gate", () => {
    const triage: Triage[] = [
      { code: 1, name: "a", group: "g", rule: "EACH-DUELIST" },
      { code: 2, name: "b", group: "g", rule: "SCRIPT-FIX" },
      { code: MIRROR_GATE, name: "Mirror Gate", group: "g", rule: "SCRIPT-FIX" },
      { code: 3, name: "c", group: "g", rule: "CHOOSER" },
    ];
    expect(r1Codes(triage)).toEqual([1, 2, CREATURE_SWAP]);
  });

  it("keeps Creature Swap in R1 when the scan does not list it", () => {
    expect(r1Codes([])).toEqual([CREATURE_SWAP]);
    expect(r1Codes([{ code: CREATURE_SWAP, name: "Creature Swap", group: "control-swap", rule: "SWAP" }])).toEqual([CREATURE_SWAP]);
  });

  it("lists Creature Swap once when the scan assigns an R1 rule", () => {
    const triage: Triage[] = [
      { code: CREATURE_SWAP, name: "Creature Swap", group: "control-swap", rule: "EACH-DUELIST" },
      { code: CREATURE_SWAP, name: "Creature Swap", group: "control-swap", rule: "SCRIPT-FIX" },
    ];
    expect(r1Codes(triage)).toEqual([CREATURE_SWAP]);
  });
});

describe("the R1 entries (each duelist, hand suffixes with aux.MPForEachDuelist)", () => {
  const r1Cards = cards.filter((card) => card.classes.includes("R1"));

  it("have kind hand, only the class R1, the loop guard and a loop over the living duelists (or over the controllers of a group)", () => {
    for (const card of r1Cards) {
      expect(card.kind, card.file).toBe("hand");
      expect(card.classes, card.file).toEqual(["R1"]);
      expect(text(card).split("\n")[0], card.file).toBe(card.replace ? "--@replace" : "if not aux.MPForEachDuelist then return end");
      // A loop over the duelists, or (R1 cards with a pick of one opponent at activation, no loop) the pick wrapper of the target step
      expect(text(card), card.file).toMatch(/aux\.MP(ForEach|All|Any)Duelists?\(function\(tp_i(,seat_i)?\)|aux\.MPForEachController\(|aux\.MPPick\(/);
    }
  });

  it("stay within the 93 R1 cards, and no card is an entry and also in R1_NO_CHANGE", () => {
    expect(r1Cards.length + R1_NO_CHANGE.length).toBeLessThanOrEqual(EXPECTED_COUNTS.r1);
    expect(r1Cards.filter((card) => R1_NO_CHANGE.includes(card.code))).toEqual([]);
  });

  it("are complete: 92 suffixes and 1 card without change make the 93 R1 cards", () => {
    expect(R1_COMPLETE).toBe(true);
    expect(r1Cards).toHaveLength(92);
    expect(R1_NO_CHANGE).toEqual([39513225]);
    expect(r1Cards.length + R1_NO_CHANGE.length).toBe(EXPECTED_COUNTS.r1);
  });

  it("are reported when they have a wrong kind, a second class, or are over the count", () => {
    const wrong = clone();
    wrong.cards.push({ ...r1Entry(1, "x", "y"), kind: "expr" }, { ...r1Entry(2, "z", "y"), classes: ["R1", "COMPARE"] });
    const problems = checkLists(wrong, null).join("\n");
    expect(problems).toContain("R1 card 1 has kind expr");
    expect(problems).toContain("R1 card 2 has another class");
  });

  it("makes an entry with the stock hash", () => {
    expect(r1Entry(5, "Name", "text")).toEqual({
      code: 5, file: "c5.lua", name: "Name", kind: "hand", classes: ["R1"],
      stockSha256: createHash("sha256").update("text").digest("hex"),
    });
  });
});

describe("the names of the entries (95200102 is not in cards.cdb: its name is the first line of the stock script)", () => {
  const temp = mkdtempSync(join(tmpdir(), "mp-names-"));
  const stockDir = join(temp, "stock");
  const overlayDir = join(temp, "overlay");
  mkdirSync(stockDir);
  mkdirSync(overlayDir);
  writeFileSync(join(stockDir, "c7.lua"), "--Commande Duel JP002\nlocal s,id=GetID()\n");
  writeFileSync(join(stockDir, "c8.lua"), "\uFEFF--Named With BOM  \r\nlocal s,id=GetID()\n");
  writeFileSync(join(stockDir, "c9.lua"), "local s,id=GetID()\n");
  writeFileSync(join(stockDir, "c10.lua"), "--@replace\nlocal s,id=GetID()\n");
  writeFileSync(join(overlayDir, "c7.lua"), "if not aux.MPForEachDuelist then return end\n");
  writeFileSync(join(overlayDir, "c9.lua"), "if not aux.MPForEachDuelist then return end\n");
  const entry = (code: number, name: string): ManifestCard => r1Entry(code, name, "x");
  const writeManifest = (list: ManifestCard[]) => writeFileSync(join(overlayDir, "MANIFEST.json"), JSON.stringify({ version: 1, cards: list }, null, 2) + "\n");

  it("keeps a given name, and takes an empty one from the first line of the stock script", () => {
    expect(cardName(7, "Given", stockDir)).toBe("Given");
    expect(cardName(7, "", stockDir)).toBe("Commande Duel JP002");
    expect(cardName(7, undefined, stockDir)).toBe("Commande Duel JP002");
    expect(cardName(8, "  ", stockDir)).toBe("Named With BOM");
  });

  it("throws when no name is possible (no first-line comment, or a --@ marker)", () => {
    expect(() => cardName(9, "", stockDir)).toThrow(/card 9 has no name/);
    expect(() => cardName(10, "", stockDir)).toThrow(/card 10 has no name/);
  });

  it("registerR1 never writes an empty name", () => {
    writeManifest([]);
    expect(registerR1([{ code: 7, name: "" }], stockDir, overlayDir)).toEqual([7]);
    expect(readManifest(overlayDir).cards.map((card) => card.name)).toEqual(["Commande Duel JP002"]);
    expect(() => registerR1([{ code: 9, name: "" }], stockDir, overlayDir)).toThrow(/card 9 has no name/);
  });

  it("checkLists reports an empty name, and run fills it from the stock script (not in check mode)", () => {
    writeManifest([entry(7, "")]);
    const problems = checkLists(readManifest(overlayDir), null).join("\n");
    expect(problems).toContain("card 7 has an empty name");
    expect(run({ check: true, directory: overlayDir, triage: null, stockDirectory: stockDir }).problems.join("\n")).toContain("card 7 has an empty name");
    expect(readManifest(overlayDir).cards[0].name).toBe("");
    expect(run({ check: false, directory: overlayDir, triage: null, stockDirectory: stockDir }).problems.join("\n")).not.toContain("empty name");
    expect(readManifest(overlayDir).cards[0].name).toBe("Commande Duel JP002");
    expect(fillMissingNames(stockDir, overlayDir)).toEqual([]);
  });

  it("the real manifest has no empty name, and 95200102 is Commande Duel JP002", () => {
    expect(cards.filter((card) => !card.name.trim()).map((card) => card.code)).toEqual([]);
    expect(cards.find((card) => card.code === 95200102)?.name).toBe("Commande Duel JP002");
  });

  afterAll(() => rmSync(temp, { recursive: true, force: true }));
});

describe("the R2 entries (state per seat: Q6, the key is the seat in FFA and the team in Tag)", () => {
  const r2Cards = cards.filter((card) => card.classes.includes("R2"));
  const seatCards = r2Cards.filter((card) => card.kind === "seat");
  const handCards = r2Cards.filter((card) => card.kind === "hand");

  it("have kind seat or hand, only the class R2, a state class and the key guard", () => {
    for (const card of r2Cards) {
      expect(["seat", "hand"], card.file).toContain(card.kind);
      expect(card.classes, card.file).toEqual(["R2"]);
      expect(card.r2Class, card.file).toBeTruthy();
      expect(card.note, card.file).toBeTruthy();
      expect(["if not aux.MPKey then return end", "if not aux.MPForEachController then return end", "if not Duel.MPOwnerSeat then return end"], card.file).toContain(text(card).split("\n")[0]);
    }
  });

  it("count 111 suffixes (38 generated seat tables, 73 hand files) and 44 cards that work without change", () => {
    expect(r2Cards).toHaveLength(111);
    expect(seatCards).toHaveLength(38);
    expect(handCards).toHaveLength(73);
    expect(R2_NO_CHANGE).toHaveLength(44);
    expect(new Set(R2_NO_CHANGE).size).toBe(R2_NO_CHANGE.length);
  });

  it("have no card that is an entry and also in R2_NO_CHANGE, and no other class", () => {
    expect(r2Cards.filter((card) => R2_NO_CHANGE.includes(card.code))).toEqual([]);
    expect(cards.filter((card) => card.classes.includes("R2") && card.classes.length !== 1)).toEqual([]);
  });

  it("generate every seat file from the entry and chain the metatable of the card table", () => {
    for (const card of seatCards) {
      expect(card.seatTables, card.file).toBeTruthy();
      expect(text(card), card.file).toContain("setmetatable(");
      expect(text(card), card.file).toContain("aux.MPKey(");
    }
  });

  it("name a key, a seat or a duelist helper (never only the stock player literal)", () => {
    for (const card of handCards) {
      expect(text(card), card.file).toMatch(/MP[A-Z]|seat/);
    }
  });

  it("are reported when they have a wrong kind, a second class, no state class or are in R2_NO_CHANGE too", () => {
    const wrong = clone();
    const entry = { ...wrong.cards.find((card) => card.classes.includes("R2"))! };
    wrong.cards.push({ ...entry, code: 1, kind: "expr" }, { ...entry, code: 2, classes: ["R2", "COMPARE"] }, { ...entry, code: 3, r2Class: undefined });
    const problems = checkLists(wrong, null).join("\n");
    expect(problems).toContain("R2 card 1 has kind expr");
    expect(problems).toContain("R2 card 2 has another class");
    expect(problems).toContain("R2 card 3 has no r2Class");
  });
});

describe("the ATTACK entries (a direct attack at you: the real target of the attack, FFA)", () => {
  const attackCards = cards.filter((card) => card.classes.includes("ATTACK"));

  it("have kind hand, only the class ATTACK and the loop guard, and wrap the stock condition with aux.MPAttackedAtMe (or are a replace file)", () => {
    for (const card of attackCards) {
      expect(card.kind, card.file).toBe("hand");
      expect(card.classes, card.file).toEqual(["ATTACK"]);
      expect(text(card).split("\n")[0], card.file).toBe(card.replace ? "--@replace" : "if not aux.MPAny then return end");
      if (card.replace) expect(text(card), card.file).toContain("MPAttackedAtMe(");
      else expect(card.wrap?.MPAttackedAtMe?.length, card.file).toBeGreaterThan(0);
      expect(Object.keys(card.wrap ?? {}).filter((helper) => helper !== "MPAttackedAtMe"), card.file).toEqual([]);
    }
  });

  it("count 59 cards, none of them in another class", () => {
    expect(attackCards).toHaveLength(EXPECTED_COUNTS.attack);
    expect(attackCards).toHaveLength(59);
  });

  it("are reported when they have a wrong kind, a second class or no wrap", () => {
    const wrong = clone();
    const entry = { ...wrong.cards.find((card) => card.classes.includes("ATTACK"))! };
    wrong.cards.push({ ...entry, code: 1, kind: "expr" }, { ...entry, code: 2, classes: ["ATTACK", "COMPARE"] }, { ...entry, code: 3, wrap: undefined });
    const problems = checkLists(wrong, null).join("\n");
    expect(problems).toContain("ATTACK card 1 has kind expr");
    expect(problems).toContain("ATTACK card 2 has another class");
    expect(problems).toContain("ATTACK card 3 has no MPAttackedAtMe wrap");
  });
});

describe("the generator", () => {
  it("--check has no problem and writes nothing", () => {
    const result = run({ check: true, triage: null });
    expect(result.problems).toEqual([]);
    expect(result.written).toEqual([]);
  });

  it("writes the guard, one comment and one wrap line for a whole card", () => {
    const card = cards.find((entry) => entry.code === 8814959)!;
    const lines = wholeFileText(card).split("\n");
    expect(lines[0]).toBe("if not aux.MPAny then return end");
    expect(lines[1]).toMatch(/^-- /);
    expect(lines[2]).toMatch(/^s\.\w+=aux\.MPAny\(s\.\w+\)$/);
    expect(wholeFileText(card)).toBe(text(card));
  });

  it("refuses a whole card without a wrap", () => {
    expect(() => wholeFileText({ ...cards.find((entry) => entry.kind === "whole")!, wrap: undefined })).toThrow(/no wrap/);
  });

  it("reports a whole file that differs from the generated text", () => {
    const directory = join(OVERLAY_DIRECTORY);
    const broken = clone();
    broken.cards.find((card) => card.kind === "whole")!.note = "a different comment";
    // run() reads the manifest from the directory, so compare the text directly.
    const card = broken.cards.find((entry) => entry.kind === "whole")!;
    expect(wholeFileText(card)).not.toBe(readFileSync(join(directory, card.file), "utf8"));
  });
});

describe("the overlay files", () => {
  it("each starts with the guard line or with --@replace", () => {
    for (const card of cards) {
      const first = text(card).split("\n")[0];
      if (card.replace) expect(first, card.file).toBe("--@replace");
      else expect(first.startsWith("--@replace") || first === "if not aux.MPAny then return end" || first === "if not aux.MPForEachDuelist then return end" || first === "if not aux.MPKey then return end" || first === "if not aux.MPForEachController then return end" || first === "if not Duel.MPOwnerSeat then return end" || first === "if not Duel.MPMode or Duel.MPMode()~=1 then return end" || card.kind === "fix", `${card.file}: ${first}`).toBe(true);
    }
  });

  it("only --@replace files carry the replace flag", () => {
    for (const card of cards) expect(text(card).startsWith("--@replace"), card.file).toBe(Boolean(card.replace));
  });

  it("uses only helpers that mp-utility.lua defines and core functions of the F7 window", () => {
    const coreApi = new Set(["MPMode", "MPBound", "MPOppCount", "MPNeedPick", "MPBindOpponent", "MPWindow", "MPWindowEnd", "MPAssertBound", "MPTurnOwns", "MPAttackedSeat", "MPSeatOf", "MPBindSeat", "MPNthDuelist", "MPSeat", "MPChainSeat", "MPSharedZones", "MPAcrossSeat", "MPSeatBinding"]);
    coreApi.add("MPActionSeat");
    coreApi.add("MPOwnerSeat");
    coreApi.add("MPTurnSeat");
    coreApi.add("MPTurnControls");
    coreApi.add("MPIsAlive");
    coreApi.add("MPRotateControl");
    coreApi.add("MPChainCount");
    coreApi.add("MPPreviousChain");
    for (const card of cards) {
      for (const [, helper] of text(card).matchAll(/\baux\.(MP\w+)/g)) {
        expect(helperText, `${card.file}: aux.${helper}`).toContain(`function aux.${helper}(`);
      }
      for (const [, name] of text(card).matchAll(/\bDuel\.(MP\w+)/g)) expect(coreApi.has(name), `${card.file}: Duel.${name}`).toBe(true);
    }
  });

  it("wraps only names that the manifest lists, and the file defines or wraps each redefined name", () => {
    for (const card of cards) {
      const body = text(card);
      for (const [helper, names] of Object.entries(card.wrap ?? {})) {
        for (const name of names) expect(body, `${card.file}: s.${name}=aux.${helper}`).toContain(`s.${name}=aux.${helper}(s.${name})`);
      }
      for (const name of card.redefined ?? []) {
        expect(body, `${card.file}: s.${name}`).toMatch(new RegExp(`function s\\.${name}\\(|s\\.${name}\\s*=`));
      }
    }
  });

  // MPAny is for boolean checks only. A number or a group in it would be wrong.
  it("lint: MPAny wraps only conditions, target or cost checks, and boolean expressions", () => {
    const conditionLike = /^(condition|\w*con|\w*cond|\w*chk|\w*check|\w*filter)$/i;
    for (const card of cards) {
      const body = text(card);
      for (const [, name] of body.matchAll(/^s\.(\w+)=aux\.MPAny\(s\.\1\)\s*$/gm)) {
        // A target/cost callback returns a boolean for chk==0, even when its name is "target" (Cannons).
        expect(conditionLike.test(name) || isActivationCheck(body, name), `${card.file}: s.${name} is not a condition or activation check`).toBe(true);
      }
      for (const [, expr] of text(card).matchAll(/aux\.MPAny\(function\(\) return (.+?) end\)\(\)/g)) {
        const called = /^(\w+)\(/.exec(expr)?.[1];
        const alias = called ? new RegExp(`\\blocal\\s+${called}\\s*=\\s*s\\.(\\w+)\\b`).exec(body)?.[1] : undefined;
        const booleanAlias = alias !== undefined && (conditionLike.test(alias) || /^\w*cost$/i.test(alias));
        expect(booleanAlias || /(<=|>=|<|>|==|~=|\bnot\b|\band\b|\bor\b|Is\w+\(|Check\w+\(|^base_\w+\()/.test(expr), `${card.file}: ${expr}`).toBe(true);
        expect(/^Duel\.GetFieldGroupCount\([^()]*\)$/.test(expr.trim()), `${card.file}: a bare count ${expr}`).toBe(false);
      }
    }
  });

  it("lint keeps a chk branch in its own callback", () => {
    const body = "function s.operation(e,tp,chk)\n return 4\nend\nfunction s.target(e,tp,chk)\n if chk==0 then return true end\nend\n";
    expect(isActivationCheck(body, "operation")).toBe(false);
    expect(isActivationCheck(body, "target")).toBe(true);
  });

  it("lint catches a bare count in MPAny", () => {
    const bare = "x=aux.MPAny(function() return Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE) end)()";
    const [, expr] = bare.match(/aux\.MPAny\(function\(\) return (.+?) end\)\(\)/)!;
    expect(/(<=|>=|<|>|==|~=|\bnot\b|\band\b|\bor\b|Is\w+\(|Check\w+\()/.test(expr)).toBe(false);
  });
});

describeWithCores("the overlay against the stock scripts", stock, () => {
  it("each stockSha256 equals the hash of the stock script (a changed stock script needs a new look at the card)", () => {
    for (const card of cards) {
      const hash = createHash("sha256").update(stockText(card.code)).digest("hex");
      expect(card.stockSha256, `${card.code} ${card.name}`).toBe(hash);
    }
  });

  it("each wrapped or redefined function exists in the stock script (replace files only need the code)", () => {
    for (const card of cards) {
      const body = stockText(card.code);
      if (card.replace) continue;
      // A name that starts with "mp" is a new helper of the overlay (49027020 mpspfilter), not a stock function.
      const names = [...Object.values(card.wrap ?? {}).flat(), ...(card.redefined ?? []).filter((name) => !name.startsWith("mp"))];
      for (const name of names) {
        expect(new RegExp(`function s\\.${name}\\(|s\\.${name}\\s*=`).test(body), `${card.file}: stock has no s.${name}`).toBe(true);
      }
    }
  });

  it("every COMPARE card is flagged by the scan rule field-count-compare, and no other flagged card is missing from the manifest", () => {
    const scanned = scanCorpus(stockDirectory).filter((card) => card.rules.includes("field-count-compare")).map((card) => card.code)
      .filter((code) => !COMPARE_FALSE_POSITIVES.includes(code));
    const compare = cards.filter((card) => card.classes.includes("COMPARE")).map((card) => card.code);
    expect(compare.filter((code) => !scanned.includes(code))).toEqual([]);
    const listed = new Set(cards.map((card) => card.code));
    expect(scanned.filter((code) => !listed.has(code)).sort((a, b) => a - b)).toEqual([]);
  }, 30_000);

  it("a compare card that reads overlay materials or counters on a field is in the manifest", () => {
    const listed = new Set(cards.map((card) => card.code));
    const scanned = scanCorpus(stockDirectory).filter((card) => card.rules.includes("field-count-compare") && !COMPARE_FALSE_POSITIVES.includes(card.code));
    for (const card of scanned) {
      if (/GetOverlayGroup|GetOverlayCount|:GetCounter\(|Duel\.GetCounter\(/.test(stockText(card.code))) {
        expect(listed.has(card.code), `${card.code} ${card.name} reads overlay or counters and has no MANIFEST entry`).toBe(true);
      }
    }
  }, 30_000);
});

describeWithCores("the overlay against the triage file", triageNeed, () => {
  it("the lists equal the triage (COMPARE 54, CHOOSER 44, R1 93)", () => {
    const triage = readTriage();
    expect(triage).not.toBeNull();
    expect(checkLists(manifest, triage)).toEqual([]);
    expect(r1Codes(triage!)).toHaveLength(EXPECTED_COUNTS.r1);
  });
});
