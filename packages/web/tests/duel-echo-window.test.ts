import { describe, expect, it } from "vitest";
import { createEchoWindow, ECHO_QUIET_MS } from "@/lib/duel-echo-window";

describe("createEchoWindow", () => {
  it("is not quiet before any answer: an opponent's notice keeps the full gate", () => {
    expect(createEchoWindow(() => 1000).quiet()).toBe(false);
  });

  it("is quiet while an answer is in flight, however long it takes", () => {
    let now = 0;
    const echo = createEchoWindow(() => now);
    echo.begin();
    now = 60_000;
    expect(echo.quiet()).toBe(true);
  });

  it("stays quiet for a short time after the reply, then closes", () => {
    let now = 0;
    const echo = createEchoWindow(() => now);
    echo.begin();
    now = 100;
    echo.end();
    now = 100 + ECHO_QUIET_MS - 1;
    expect(echo.quiet()).toBe(true);
    now = 100 + ECHO_QUIET_MS;
    expect(echo.quiet()).toBe(false);
  });

  it("stays quiet while any of two overlapping answers is in flight", () => {
    let now = 0;
    const echo = createEchoWindow(() => now);
    echo.begin();
    echo.begin();
    echo.end();
    now = 10_000;
    expect(echo.quiet()).toBe(true);
    echo.end();
    now = 20_000;
    expect(echo.quiet()).toBe(false);
  });

  it("an extra end does not leave a negative count", () => {
    let now = 0;
    const echo = createEchoWindow(() => now);
    echo.end();
    echo.begin();
    expect(echo.quiet()).toBe(true);
  });
});
