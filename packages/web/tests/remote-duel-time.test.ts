import { describe, expect, it } from "vitest";
import { formatDuelTime } from "@/components/remote/ui/chrome";

describe("duel clock", () => {
  it("shows mm:ss, then h:mm:ss from one hour", () => {
    expect(formatDuelTime(0)).toBe("00:00");
    expect(formatDuelTime(65_900)).toBe("01:05");
    expect(formatDuelTime(59 * 60_000 + 59_000)).toBe("59:59");
    expect(formatDuelTime(3_600_000)).toBe("1:00:00");
    expect(formatDuelTime(3_600_000 * 2 + 61_000)).toBe("2:01:01");
    expect(formatDuelTime(-5000)).toBe("00:00");
  });
});
