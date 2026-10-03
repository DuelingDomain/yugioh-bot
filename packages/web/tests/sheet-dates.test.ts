import { describe, expect, it } from "vitest";
import { formatRecent, formatWhen, parseDbTime } from "@/components/tournament/sheet-dates";

const zone = "America/New_York";

describe("sheet dates", () => {
  it("reads SQLite UTC timestamps and ISO strings", () => {
    expect(parseDbTime("2026-09-26 00:04:00")?.toISOString()).toBe("2026-09-26T00:04:00.000Z");
    expect(parseDbTime("2026-09-26T00:04:00.000Z")?.toISOString()).toBe("2026-09-26T00:04:00.000Z");
    expect(parseDbTime(null)).toBeNull();
    expect(parseDbTime("not a date")).toBeNull();
  });

  it("formats a start time and drops the minutes on the hour", () => {
    expect(formatWhen("2026-09-26 00:04:00", zone)).toBe("Fri, Sep 25, 8:04 PM");
    expect(formatWhen("2026-10-03T03:00:00Z", zone)).toBe("Fri, Oct 2, 11 PM");
  });

  it("uses the weekday for recent results and the date for older ones", () => {
    const now = new Date("2026-10-01T16:00:00Z");
    expect(formatRecent("2026-10-01 01:42:00", now, zone)).toBe("Wed 9:42 PM");
    expect(formatRecent("2026-09-18 15:00:00", now, zone)).toBe("Sep 18");
    expect(formatRecent("2025-12-30 15:00:00", now, zone)).toBe("Dec 30, 2025");
  });
});
