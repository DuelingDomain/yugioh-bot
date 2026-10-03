import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../../src/components/draft/room/draft-room.css", import.meta.url), "utf8");
const phone = css.split("@media (max-width: 900px) {")[1]?.split("\n}")[0] ?? "";

describe("phone seat strip CSS", () => {
  it("keeps seat chips at least 44 pixels wide without shrinking", () => {
    const chip = phone.match(/\.dr \.chip-seat\s*\{([^}]+)\}/)?.[1] ?? "";
    expect(chip).toContain("flex: 1 0 44px");
  });

  it("scrolls the phone strip sideways when seats do not fit", () => {
    const strip = phone.match(/\.dr \.seatstrip\s*\{([^}]+)\}/)?.[1] ?? "";
    expect(strip).toContain("overflow-x: auto");
  });
});
