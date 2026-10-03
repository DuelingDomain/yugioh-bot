import { describe, expect, it } from "vitest";
import { formatLabel, rulesSummary } from "@/components/tournament/sheet-rules";

describe("sheet rules summary", () => {
  it("summarises constructed rules for the rail and the Your match line", () => {
    const summary = rulesSummary({ bestOf: 3, draftId: null, duelRules: { bestOf: 3, mode: "normal", masterRule: 5, settings: { turnSeconds: 180 } } as never });
    expect(summary?.rows.map((row) => row.label)).toEqual(["Duel mode", "Banlist", "Turn time"]);
    expect(summary?.line).toMatch(/^Best of 3, Normal, .+, 3 min turns$/);
  });

  it("keeps fixed draft rules and handles payloads without rules", () => {
    expect(rulesSummary({ bestOf: 1, draftId: 4, duelRules: undefined })?.line).toBe("Best of 1, Draft pool, no banlist");
    expect(rulesSummary({ bestOf: undefined, draftId: null, duelRules: undefined })).toBeNull();
    expect(formatLabel("single_elim")).toBe("Single elimination");
  });
});
