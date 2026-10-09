import { describe, expect, it } from "vitest";
import {
  RULE_PRESETS,
  analyzeRules,
  applyPreset,
  editRule,
  fitRulesToPool,
  matchPreset,
  readRules,
  readinessText,
  settleRule,
  stepRule,
  type RulesFields,
} from "../src/components/draft/setup/rules-model";
import { configFromFields, fieldsFromConfig, validateFields } from "../src/components/draft/draft-config-fields";

const base = (): RulesFields => ({
  cardsPerPlayerText: "40",
  packSizeText: "15",
  pickSecondsText: "45",
});

const community = () => applyPreset(base(), "community");
const quick = () => applyPreset(base(), "quick");

describe("rules math", () => {
  it("5 x 4 x 24 asks for 480 Main copies and 120 picks each", () => {
    const a = analyzeRules(community(), { main: 486, extra: 85 });
    expect(a.mainDemand).toBe(480);
    expect(a.picksEach).toBe(120);
    expect(a.dealtEach).toBe(120);
    expect(a.spare).toBe(6);
    expect(a.ok).toBe(true);
  });

  it("3 x 4 x 15 asks for 180 Main copies and 45 picks each", () => {
    const a = analyzeRules(quick(), { main: 180, extra: 0 });
    expect(a.mainDemand).toBe(180);
    expect(a.picksEach).toBe(45);
    expect(a.spare).toBe(0);
    expect(a.ok).toBe(true);
  });

  it("counts a separate Extra round on its own and keeps Extra cards out of the Main fit", () => {
    const fields = { ...community(), extraDeckEnabled: true, extraDeckSizeText: "15" };
    const a = analyzeRules(fields, { main: 401, extra: 85 });
    expect(a.mainDemand).toBe(480);
    expect(a.mainShort).toBe(79);
    expect(a.extraDemand).toBe(60);
    expect(a.extraShort).toBe(0);
    expect(a.timedPicks).toBe(135);
    // Extra cards never top up Main, with the round on or off.
    const off = analyzeRules(community(), { main: 401, extra: 85 });
    expect(off.mainShort).toBe(79);
    expect(off.extraIdle).toBe(85);
    expect(off.extraDemand).toBe(0);
  });

  it("reports a short Extra pool", () => {
    const a = analyzeRules({ ...quick(), extraDeckEnabled: true, extraDeckSizeText: "15" }, { main: 200, extra: 40 });
    expect(a.extraShort).toBe(20);
    expect(a.ok).toBe(false);
    expect(readinessText(a)).toBe("Extra Deck piles are 20 cards short");
  });

  it("times a 2-pick turn as two full timer picks, not half", () => {
    const two = analyzeRules(community(), { main: 480, extra: 0 });
    expect(two.timedPicks).toBe(120);
    expect(two.maxMinutes).toBe(90);
    const one = analyzeRules({ ...community(), picksPerStep: 1 }, { main: 480, extra: 0 });
    expect(one.maxMinutes).toBe(90);
  });

  it("flags an empty pool and illegal numbers", () => {
    expect(analyzeRules(quick(), { main: 0, extra: 0 }).errors).toContain("Add cards to the pool");
    const thin = analyzeRules({ ...quick(), cardsPerPlayerText: "39" }, { main: 500, extra: 0 });
    expect(thin.ok).toBe(false);
    expect(thin.errors[0]).toMatch(/between 40 and 120/);
  });

  it.each([82, 95])("allows %i Main cards for two 41-pick seats with partial final piles", (main) => {
    const fields = { ...base(), cardsPerPlayerText: "41", packSizeText: "24", lobbySeatsText: "2" };
    const a = analyzeRules(fields, { main, extra: 0 });
    expect(a.mainDemand).toBe(96);
    expect(a.mainShort).toBe(96 - main);
    expect(a.picksEach).toBe(41);
    expect(a.errors).toEqual([]);
    expect(a.warnings).toContainEqual(expect.stringMatching(/full deal.*96.*partial piles/));
    expect(a.ok).toBe(true);
  });

  it("reports only the required-pick deficit when partial final piles cannot fill the cap", () => {
    const fields = { ...base(), cardsPerPlayerText: "41", packSizeText: "24", lobbySeatsText: "2" };
    const a = analyzeRules(fields, { main: 81, extra: 0 });
    expect(a.errors).toEqual(["Main piles are 1 card short"]);
    expect(a.ok).toBe(false);
  });

  it("warns about unpicked cards and the 3-copy limit without blocking", () => {
    const a = analyzeRules({ ...base(), roundsText: "3", lobbySeatsText: "4" }, { main: 180, extra: 0, mainReachable: 30 });
    expect(a.unpickedEach).toBe(5);
    expect(a.warnings.join(" ")).toMatch(/5 cards/);
    expect(a.warnings.join(" ")).toMatch(/30 Main cards/);
    expect(a.ok).toBe(true);
  });
});

describe("editing rules", () => {
  it("keeps the chosen cap when pile size changes", () => {
    const fields = editRule(community(), "pile", "30");
    expect(fields.cardsPerPlayerText).toBe("120");
    expect(readRules(fields).rounds).toBe(4);
  });

  it("derives the final round from a partial cap even when stale rounds are present", () => {
    const fields = { ...community(), cardsPerPlayerText: "40", roundsText: "5" };
    expect(readRules(fields)).toMatchObject({ picks: 40, rounds: 2, pile: 24 });
    expect(validateFields(fields)).toBeNull();
  });

  it("survives typing a pile digit by digit", () => {
    let f = community();
    f = editRule(f, "pile", "2");
    f = editRule(f, "pile", "24");
    expect(f.cardsPerPlayerText).toBe("120");
  });

  it("steps and settles inside the limits", () => {
    expect(stepRule(community(), "seats", 1).lobbySeatsText).toBe("5");
    const eight = editRule(community(), "seats", "8");
    expect(stepRule(eight, "seats", 1).lobbySeatsText).toBe("8");
    expect(settleRule(editRule(community(), "seats", "99"), "seats").lobbySeatsText).toBe("8");
    expect(settleRule(editRule(community(), "seats", ""), "seats").lobbySeatsText).toBe("2");
    expect(settleRule(editRule(community(), "pickSeconds", "1"), "pickSeconds").pickSecondsText).toBe("5");
  });

  it("presets name themselves and are recognised", () => {
    expect(RULE_PRESETS.map((p) => p.label)).toEqual(["5 × 4 × 24 · 2-pick", "3 × 4 × 15 · 1-pick"]);
    expect(RULE_PRESETS.map((p) => p.detail)).toEqual(["120 Main picks each, 480 cards dealt", "45 Main picks each, 180 cards dealt"]);
    expect(matchPreset(community())).toBe("community");
    expect(matchPreset(quick())).toBe("quick");
    expect(matchPreset(editRule(quick(), "picks", "60"))).toBeNull();
  });
});

describe("Fit to pool", () => {
  it.each([
    { preset: "community" as const, main: 400, before: 120, after: 100 },
    { preset: "quick" as const, main: 170, before: 45, after: 42 },
  ])("reports the $preset cap change when fitting $main Main cards", ({ preset, main, before, after }) => {
    const fit = fitRulesToPool(applyPreset(base(), preset), { main, extra: 0 });
    expect(fit.ok).toBe(true);
    expect(readRules(fit.fields).picks).toBe(after);
    expect(fit.changes).toContain(`Picks each: ${before} -> ${after}`);
  });

  it("keeps rounds and shrinks the pile when the pool is a little short", () => {
    const fit = fitRulesToPool(community(), { main: 401, extra: 0 });
    expect(fit.ok).toBe(true);
    const r = readRules(fit.fields);
    expect([r.rounds, r.pile]).toEqual([5, 20]);
    expect(r.picks).toBe(100);
    expect(analyzeRules(fit.fields, { main: 401, extra: 0 }).ok).toBe(true);
  });

  it("changes the round count when the pile would be under 5", () => {
    const wide = { ...quick(), roundsText: "12", packSizeText: "5", cardsPerPlayerText: "60" };
    const fit = fitRulesToPool({ ...wide, packSizeText: "8", cardsPerPlayerText: "96" }, { main: 4 * 41, extra: 0 });
    expect(fit.ok).toBe(true);
    const r = readRules(fit.fields);
    expect([r.rounds, r.pile]).toEqual([8, 5]);
    expect(r.picks).toBe(40);
  });

  it("rejects a pool that cannot give every seat 40 picks, with the deficit", () => {
    const fit = fitRulesToPool(community(), { main: 4 * 40 - 7, extra: 0 });
    expect(fit.ok).toBe(false);
    expect(fit.mainDeficit).toBe(7);
    expect(fit.fields).toEqual(community());
    expect(readRules(fit.fields).rounds).toBe(5);
    expect(fit.changes).toEqual([]);
  });

  it("leaves rules alone when the pool already fits", () => {
    const f = community();
    const fit = fitRulesToPool(f, { main: 500, extra: 0 });
    expect(fit).toMatchObject({ ok: true, changes: [], mainDeficit: 0, extraDeficit: 0 });
    expect(fit.fields).toBe(f);
  });

  it("never fits above 120 picks or 12 rounds", () => {
    const fit = fitRulesToPool({ ...quick(), roundsText: "12", packSizeText: "80", cardsPerPlayerText: "120" }, { main: 4 * 200, extra: 0 });
    // 12 x 80 x 4 = 3840 is well over the pool, so a fit is needed, and it stays within 120 picks.
    expect(fit.ok).toBe(true);
    const r = readRules(fit.fields);
    expect(r.picks).toBeLessThanOrEqual(120);
    expect(r.rounds).toBe(Math.ceil(r.picks / r.pile));
  });

  it("fits the Extra round to the pool, or reports the deficit when no Extra card per seat exists", () => {
    const on = { ...quick(), extraDeckEnabled: true, extraDeckSizeText: "15" };
    const fit = fitRulesToPool(on, { main: 200, extra: 45 });
    expect(fit.ok).toBe(true);
    expect(readRules(fit.fields).extraSize).toBe(11);
    const none = fitRulesToPool(on, { main: 200, extra: 2 });
    expect(none.ok).toBe(false);
    expect(none.extraDeficit).toBe(2);
    expect(readRules(none.fields).extraSize).toBe(15);
  });
});

describe("fields <-> config", () => {
  it("round-trips an old 40-from-45 config without changing it", () => {
    const old = { cardsPerPlayer: 40, packSize: 15, packsPerPlayer: 3, pickSeconds: 45, copyLimit: true, picksPerStep: 1 as const, extraDeckEnabled: false, extraDeckSize: 15 };
    const cfg = configFromFields(fieldsFromConfig(old));
    expect(cfg).toMatchObject(old);
    expect(cfg.lobbySeats).toBeUndefined();
    expect("lobbySeats" in cfg).toBe(false);
    expect(readRules(fieldsFromConfig(old))).toMatchObject({ rounds: 3, pile: 15, picks: 40, seats: 4 });
  });

  it("keeps explicit rounds and a seat target, and fields survive config and back", () => {
    const config = { cardsPerPlayer: 120, packSize: 24, packsPerPlayer: 5, pickSeconds: 60, copyLimit: false, picksPerStep: 2 as const, extraDeckEnabled: true, extraDeckSize: 12, lobbySeats: 6 };
    const fields = fieldsFromConfig(config);
    expect(configFromFields(fields)).toMatchObject(config);
    expect(fieldsFromConfig({ ...configFromFields(fields) })).toEqual(fields);
  });

  it("recalculates stale saved rounds for host edits", () => {
    const fields = fieldsFromConfig({ cardsPerPlayer: 40, packSize: 8, packsPerPlayer: 6 });
    expect(configFromFields(fields).packsPerPlayer).toBe(5);
    expect(validateFields(fields)).toBeNull();
  });

  it("ignores stale round text and validates seats", () => {
    expect(validateFields({ ...community(), roundsText: "13" })).toBeNull();
    expect(validateFields({ ...community(), lobbySeatsText: "9" })).toMatch(/Seats must be between 2 and 8/);
    expect(validateFields({ ...community(), roundsText: "2" })).toBeNull();
    expect(validateFields(community())).toBeNull();
    expect(validateFields(quick())).toBeNull();
  });
});
