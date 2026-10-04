// @vitest-environment jsdom
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FlipStrike, type FlipStrikePlan } from "@/components/duel/flip-strike";

afterEach(cleanup);

const plan = (reduced: boolean): FlipStrikePlan => ({
  seq: 1, reduced, ms: reduced ? 250 : 400, delayMs: 0,
  from: { left: 100, top: 300, width: 60, height: 88 },
  to: { left: 100, top: 100, width: 60, height: 88 },
  cut: { box: { left: 100, top: 300, width: 60, height: 88 }, innerW: 60, innerH: 88, html: "<div data-art>card</div>" },
});

describe("FlipStrike (the attack beat of a flip-effect fight)", () => {
  it("shows a copy of the attacker and a flash on the target", () => {
    const { container } = render(<FlipStrike plan={plan(false)} />);
    expect(container.querySelector("[data-strike-body] [data-art]")).not.toBeNull();
    expect(container.querySelector("[data-strike-flash]")).not.toBeNull();
  });

  it("has no travelling copy under reduced motion, only the flash", () => {
    const { container } = render(<FlipStrike plan={plan(true)} />);
    expect(container.querySelector("[data-strike-body]")).toBeNull();
    expect(container.querySelector("[data-strike-flash]")).not.toBeNull();
  });
});
