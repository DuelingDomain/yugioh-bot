import { describe, expect, it } from "vitest";
import { createRateLimiter } from "../src/lib/rate-limit";

describe("bounded fixed windows", () => {
  it("evicts the oldest window even when it was used more recently", () => {
    const take = createRateLimiter(60_000, 2);
    expect(take([["old", 3]], 0)).toBeNull();
    expect(take([["new", 1]], 1000)).toBeNull();
    expect(take([["old", 3]], 2000)).toBeNull();
    expect(take([["third", 1]], 3000)).toBeNull();
    expect(take([["new", 1]], 3000)).toBe(58);
    expect(take([["old", 1]], 3000)).toBeNull();
  });

  it("does not consume other buckets when one is limited", () => {
    const take = createRateLimiter(60_000);
    expect(take([["user", 1], ["ip", 2]], 0)).toBeNull();
    expect(take([["user", 1], ["ip", 2]], 1000)).toBe(59);
    expect(take([["other", 1], ["ip", 2]], 2000)).toBeNull();
    expect(take([["third", 1], ["ip", 2]], 3000)).toBe(57);
    expect(take([["user", 1], ["ip", 2]], 60_000)).toBeNull();
  });
});
