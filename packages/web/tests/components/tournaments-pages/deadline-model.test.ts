import { describe, expect, it } from "vitest";
import {
  daysBetween,
  daysFromTodayLabel,
  formatClosesAt,
  monthCells,
  sizeTable,
  timeOptions,
  withDay,
  withMinutes,
} from "../../../src/components/tournament/create-tournament-model";

describe("create tournament model", () => {
  it("round robin sizes use n(n-1)/2", () => {
    const t = sizeTable("round_robin");
    expect(t.players).toEqual([4, 6, 8, 12]);
    expect(t.matches).toEqual([6, 15, 28, 66]);
    expect(t.rounds).toBeUndefined();
  });

  it("single elimination sizes use n-1 matches and log2 rounds", () => {
    const t = sizeTable("single_elim");
    expect(t.players).toEqual([4, 8, 16]);
    expect(t.matches).toEqual([3, 7, 15]);
    expect(t.rounds).toEqual([2, 3, 4]);
  });

  it("counts calendar days and words them", () => {
    const now = new Date(2026, 9, 1, 15, 0);
    expect(daysBetween(now, new Date(2026, 9, 9, 23, 0))).toBe(8);
    expect(daysFromTodayLabel(now, new Date(2026, 9, 9, 23, 0))).toBe("8 days from today");
    expect(daysFromTodayLabel(now, new Date(2026, 9, 1, 23, 0))).toBe("Today");
    expect(daysFromTodayLabel(now, new Date(2026, 9, 2, 1, 0))).toBe("Tomorrow");
  });

  it("picking a day keeps the time, or defaults to 11:59 PM", () => {
    const day = new Date(2026, 9, 9);
    const d = withDay(null, day);
    expect([d.getHours(), d.getMinutes()]).toEqual([23, 59]);
    const e = withDay(withMinutes(day, 11 * 60), new Date(2026, 9, 12));
    expect([e.getDate(), e.getHours(), e.getMinutes()]).toEqual([12, 11, 0]);
  });

  it("lays out a Monday-first month", () => {
    const cells = monthCells(2026, 9); // Oct 1 2026 is a Thursday
    expect(cells.slice(0, 3).every((c) => c.date === null)).toBe(true);
    expect(cells[3].date?.getDate()).toBe(1);
    expect(cells.filter((c) => c.date).length).toBe(31);
  });

  it("offers half-hour steps plus 11:59 PM", () => {
    const o = timeOptions();
    expect(o).toHaveLength(49);
    expect(o[o.length - 1].minutes).toBe(23 * 60 + 59);
  });

  it("formats the summary's closing time", () => {
    expect(formatClosesAt(new Date(2026, 9, 9, 23, 0))).toBe("Fri, Oct 9, 11 PM");
  });
});
