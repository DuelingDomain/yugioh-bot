import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMPARE_EXTRA, COMPARE_FALSE_POSITIVES, EXPECTED_COUNTS, MIRROR_GATE, OVERLAY_DIRECTORY, TRIAGE_FILE,
  checkLists, r1Codes, readManifest, readTriage, run, wholeFileText, type Manifest, type ManifestCard, type Triage,
} from "../scripts/generate-multi-scripts.js";
import { scanCorpus } from "../scripts/scan-multiplayer-scripts.js";
import { currentEngineDataDirectory } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";

// The overlay of the compare and chooser cards (F7 design, part P3a): MANIFEST.json, the 99 cNNN.lua files and the generator.
// The checks that need the stock scripts or the triage file (both are not in git) are skipped when the file is missing,
// and fail with DUEL_REQUIRE_CORES=1 (stock scripts) or stay a skip (triage, a local file).

const KINDS = ["whole", "expr", "trig", "hand", "chooser", "fix"];
const manifest = readManifest();
const cards = manifest.cards;
const text = (card: ManifestCard) => readFileSync(join(OVERLAY_DIRECTORY, card.file), "utf8");
const helperText = readFileSync(join(OVERLAY_DIRECTORY, "mp-utility.lua"), "utf8");
const clone = (): Manifest => JSON.parse(JSON.stringify(manifest)) as Manifest;
const stockDirectory = process.env.DUEL_SCRIPTS_DIR ?? join(currentEngineDataDirectory(), "card-scripts/official");
const stock = needs.file("official script corpus", stockDirectory, "Set DUEL_SCRIPTS_DIR, or set DUEL_DATA_DIR to an engine data directory with card-scripts/official.");
const triageNeed = needs.localFile("multiplayer triage", TRIAGE_FILE, "Run scripts/scan-multiplayer-scripts.ts to write .status/multiplayer-triage.json.");
const stockText = (code: number) => readFileSync(join(stockDirectory, `c${code}.lua`), "utf8");

describe("MANIFEST.json of the overlay", () => {
  it("lists 99 cards with a valid kind, a file named after the code and a name", () => {
    expect(manifest.version).toBe(1);
    expect(cards).toHaveLength(EXPECTED_COUNTS.entries);
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

  it("has no problem in the lists and counts (54 compare, 44 chooser, 7 whole)", () => {
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
    expect(problems).toContain("6 whole files");
    expect(problems).toContain("98 entries");
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
    expect(r1Codes(triage)).toEqual([1, 2]);
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
      else expect(first.startsWith("--@replace") || first === "if not aux.MPAny then return end" || card.kind === "fix", `${card.file}: ${first}`).toBe(true);
    }
  });

  it("only --@replace files carry the replace flag", () => {
    for (const card of cards) expect(text(card).startsWith("--@replace"), card.file).toBe(Boolean(card.replace));
  });

  it("uses only helpers that mp-utility.lua defines and core functions of the F7 window", () => {
    const coreApi = new Set(["MPMode", "MPBound", "MPOppCount", "MPNeedPick", "MPBindOpponent", "MPWindow", "MPWindowEnd", "MPAssertBound"]);
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

  // MPAny is for boolean checks only (it returns true or false, or asks for a pick). A number or a group in it would be wrong.
  it("lint: MPAny wraps only condition-like names and boolean expressions", () => {
    const conditionLike = /^(condition|\w*con|\w*cond|\w*chk|\w*check|\w*filter)$/i;
    for (const card of cards) {
      for (const [, name] of text(card).matchAll(/^s\.(\w+)=aux\.MPAny\(s\.\1\)\s*$/gm)) {
        expect(conditionLike.test(name), `${card.file}: s.${name} is not a condition name`).toBe(true);
      }
      for (const [, expr] of text(card).matchAll(/aux\.MPAny\(function\(\) return (.+?) end\)\(\)/g)) {
        expect(/(<=|>=|<|>|==|~=|\bnot\b|\band\b|\bor\b|Is\w+\(|Check\w+\(|^base_\w+\()/.test(expr), `${card.file}: ${expr}`).toBe(true);
        expect(/^Duel\.GetFieldGroupCount\([^()]*\)$/.test(expr.trim()), `${card.file}: a bare count ${expr}`).toBe(false);
      }
    }
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
      const hash = createHash("sha256").update(readFileSync(join(stockDirectory, `c${card.code}.lua`))).digest("hex");
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
  });

  it("a compare card that reads overlay materials or counters on a field is in the manifest", () => {
    const listed = new Set(cards.map((card) => card.code));
    const scanned = scanCorpus(stockDirectory).filter((card) => card.rules.includes("field-count-compare") && !COMPARE_FALSE_POSITIVES.includes(card.code));
    for (const card of scanned) {
      if (/GetOverlayGroup|GetOverlayCount|:GetCounter\(|Duel\.GetCounter\(/.test(stockText(card.code))) {
        expect(listed.has(card.code), `${card.code} ${card.name} reads overlay or counters and has no MANIFEST entry`).toBe(true);
      }
    }
  });
});

describeWithCores("the overlay against the triage file", triageNeed, () => {
  it("the lists equal the triage (COMPARE 54, CHOOSER 44, R1 92)", () => {
    const triage = readTriage();
    expect(triage).not.toBeNull();
    expect(checkLists(manifest, triage)).toEqual([]);
    expect(r1Codes(triage!)).toHaveLength(EXPECTED_COUNTS.r1);
  });
});
