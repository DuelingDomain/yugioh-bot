import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The board size follows the space left under the header and above the track, and nothing else.
// An alert that shows for a moment ("Connection lost", "Action failed") used to sit in flow above
// the layout and shrink the whole board while it showed. jsdom does not lay out, so these tests
// read the source.

const duel = join(fileURLToPath(new URL("../../", import.meta.url)), "src/components/duel");
const css = readFileSync(join(duel, "room.module.css"), "utf8");
const tsx = readFileSync(join(duel, "room.tsx"), "utf8");

/** The body of the first top-level rule whose selector list is exactly `selector`. */
function rule(selector: string): string {
  const start = css.search(new RegExp(`^${selector.replace(".", "\\.")}\\s*\\{`, "m"));
  expect(start, `rule ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
}

describe("duel room layout stays one size", () => {
  it("floats the notices over the layout instead of putting them in flow", () => {
    const notices = rule(".notices");
    expect(notices).toMatch(/position:\s*absolute/);
    expect(rule(".error")).not.toMatch(/position:\s*(static|relative)/);
  });

  it("renders every alert inside the notices box, inside the layout", () => {
    const layout = tsx.indexOf("<div className={styles.layout}>");
    const notices = tsx.indexOf("<div className={styles.notices}>");
    expect(layout).toBeGreaterThan(0);
    expect(notices).toBeGreaterThan(layout);
    const alerts = [...tsx.matchAll(/<div className=\{styles\.error\}/g)].map((m) => m.index ?? -1);
    expect(alerts).toHaveLength(3);
    for (const at of alerts) expect(at).toBeGreaterThan(notices);
  });

  it("clips the shell so focus cannot scroll the room", () => {
    expect(rule(".shell")).toMatch(/overflow:\s*clip/);
  });
});
