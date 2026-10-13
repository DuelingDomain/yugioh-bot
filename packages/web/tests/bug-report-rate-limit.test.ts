import { beforeEach, describe, expect, it } from "vitest";
import { resetPrecheckLimit, takeDuplicateCheckSlot, takePrecheckSlot } from "../src/lib/bug-reports/precheck";

beforeEach(() => resetPrecheckLimit());

describe("bug report check windows", () => {
  it.each([
    { take: takePrecheckSlot, max: 30 },
    { take: takeDuplicateCheckSlot, max: 10 },
  ])("evicts the oldest full window while retaining newer limits ($max)", ({ take, max }) => {
    for (let i = 0; i < max; i++) expect(take("old", 0)).toEqual({ ok: true });
    for (let i = 0; i < max; i++) expect(take("newer", 1)).toEqual({ ok: true });
    for (let i = 0; i < 9998; i++) expect(take(`client-${i}`, 2)).toEqual({ ok: true });
    expect(take("next", 3)).toEqual({ ok: true });
    expect(take("newer", 3)).toEqual({ ok: false, retryAfterSeconds: 600 });
    expect(take("old", 3)).toEqual({ ok: true });
  });

  it.each([
    { take: takePrecheckSlot, max: 30 },
    { take: takeDuplicateCheckSlot, max: 10 },
  ])("resets the entire fixed window without extending it ($max)", ({ take, max }) => {
    expect(take("member", 0)).toEqual({ ok: true });
    for (let i = 1; i < max; i++) expect(take("member", 1000)).toEqual({ ok: true });
    expect(take("member", 599999)).toEqual({ ok: false, retryAfterSeconds: 1 });
    for (let i = 0; i < max; i++) expect(take("member", 600000)).toEqual({ ok: true });
    expect(take("member", 600000)).toEqual({ ok: false, retryAfterSeconds: 600 });
  });
});
