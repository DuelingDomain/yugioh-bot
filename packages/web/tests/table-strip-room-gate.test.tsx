// @vitest-environment jsdom
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";
import { FFA4_FIXTURES } from "@/components/duel/table/fixtures/ffa4";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import type { TableFixtureSet } from "@/components/duel/table/fixtures/common";
import { TableShell } from "@/components/duel/table/table-shell";
import { TAG_FIXTURES } from "@/components/duel/tag/fixtures";
import { TagShell } from "@/components/duel/tag/tag-shell";

beforeAll(() => {
  class RO {
    constructor(private cb: () => void) {}
    observe() { this.cb(); }
    disconnect() {}
    unobserve() {}
  }
  vi.stubGlobal("ResizeObserver", RO);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1100 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 860 });
});
afterEach(cleanup);

function Shell({ set, id }: { set: TableFixtureSet; id: string }) {
  const controller = useFixtureController((set.extra?.[id] ?? set.states[id as keyof typeof set.states]), { reducedMotion: true });
  return set.format === "tag" ? <TagShell controller={controller} /> : <TableShell controller={controller} />;
}
const gate = (container: HTMLElement) => container.querySelector("[data-strip-room], [data-strip-pending]");

describe("the chain-response room is set up on purpose only", () => {
  it.each([["ffa3", FFA3_FIXTURES], ["ffa4", FFA4_FIXTURES], ["tag", TAG_FIXTURES]] as const)("%s: a chain response asks for the room, the main phase does not", (_name, set) => {
    expect(gate(render(<Shell set={set} id="respond-5" />).container)).not.toBeNull();
    cleanup();
    expect(gate(render(<Shell set={set} id="main" />).container)).toBeNull();
  });

  it("the 1v1 table never uses it", () => {
    const dir = join(__dirname, "../src/components/duel");
    const users = readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((file) => /\.(tsx?|css)$/.test(file) && !/^(table|tag)[\\/]/.test(file))
      .filter((file) => /data-strip-room|data-strip-pending|use-strip-room/.test(readFileSync(join(dir, file), "utf8")));
    // The card strip's own css reads the room the stage sets, and the prompt's focus effect and title wrap read the marks (a 1v1 table never sets them); no other file outside the multi-seat tables does.
    expect(users).toEqual(["card-strip.module.css", "prompt-center.module.css", "prompt-center.tsx"]);
  });
});
