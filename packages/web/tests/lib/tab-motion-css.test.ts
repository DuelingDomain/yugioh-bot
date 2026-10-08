import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const globals = read("../../app/globals.css");

describe("tab motion (globals.css)", () => {
  it("brings a panel in with opacity and a short slide that reduced motion zeroes", () => {
    expect(globals).toMatch(/@keyframes mo-pane-next \{ from \{ opacity: 0; transform: translateX\(calc\(8px \* var\(--motion-travel\)\)\); \} \}/);
    expect(globals).toMatch(/@keyframes mo-pane-prev \{ from \{ opacity: 0; transform: translateX\(calc\(-8px \* var\(--motion-travel\)\)\); \} \}/);
  });
  it("plays the arrival in --d-pane-in with ease-out and no exit", () => {
    expect(globals).toContain("animation: var(--pane-anim) var(--d-pane-in) var(--ease-out) backwards");
    expect(globals).toContain('[data-pane-dir="next"] { --pane-anim: mo-pane-next; }');
    expect(globals).toContain('[data-pane-dir="prev"] { --pane-anim: mo-pane-prev; }');
    expect(globals).not.toMatch(/mo-pane-(next|prev)[^;]*forwards/);
  });
  it("slides the underline with transform only", () => {
    expect(globals).toContain("[data-marker-motion] > [data-tab-marker] { transition: transform var(--d-tab) var(--ease-in-out); }");
  });
  it("turns every tab animation off under reduced motion", () => {
    expect(globals).toMatch(/\[data-pane\]\[data-pane-dir\], \[data-pane\]\[data-pane-dir\] > \* \{ animation: none !important; \}/);
  });
  it("clips the page sideways on the screens whose panes arrive from the side, so the slide never widens the page", () => {
    expect(read("../../src/components/draft/setup/workbench.module.css")).toMatch(/\.wb\[data-mode="phone"\] \{[^}]*overflow-x: clip/);
    expect(read("../../src/components/decks/editor.module.css")).toMatch(/@container de-editor \(width < 960px\) \{\s*[^]*?\.de \{[^}]*overflow-x: clip/);
  });
  it("matches the durations in motion.ts", () => {
    expect(globals).toMatch(/--d-tab: 200ms/);
    expect(globals).toMatch(/--d-pane-in: 180ms/);
  });
});
