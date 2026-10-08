import { readFileSync } from "node:fs";
import postcss, { type Rule } from "postcss";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../../src/components/layout/shell.module.css", import.meta.url), "utf8");
const root = postcss.parse(css);

function rules(selector: string): Rule[] {
  const found: Rule[] = [];
  root.walkRules((rule) => {
    if (rule.selectors.includes(selector)) found.push(rule);
  });
  return found;
}
function decl(rule: Rule, prop: string): string | undefined {
  let value: string | undefined;
  rule.walkDecls(prop, (d) => {
    value = d.value;
  });
  return value;
}

describe("sidebar rail motion (shell.module.css)", () => {
  it("lets only the sidebar row flex: a flex-basis of 0 would collapse the phone row's 48px in its column", () => {
    expect(decl(rules(".navItem")[0], "flex")).toBeUndefined();
    expect(decl(rules(".railTip > .navItem")[0], "flex")).toBe("1");
  });

  it("keeps the icon on one x in both widths: same padding, same icon size", () => {
    const [item] = rules(".navItem");
    expect(decl(item, "padding")).toBe("0 12px");
    expect(decl(rules(".navIcon")[0], "width")).toBe("20px");
    // 12px nav padding + 12px item padding puts the icon at x 24..44, centred on the 68px rail.
    expect(decl(rules(".nav")[0], "padding")).toBe("12px 12px 8px");
    expect(rules('.navItem[data-size="rail"]')).toHaveLength(0);
  });

  it("only transitions the rail and the page column while the shell says the rail is moving", () => {
    // The deliberate layout-animation exception (owner-approved): the rail's width, the page's margin-left
    // and the rail toggle row's grid-template-rows. Nothing else in the shell animates layout.
    const layout: string[] = [];
    root.walkRules((rule) => {
      const t = decl(rule, "transition");
      if (t && /(^|[\s,])(width|margin-left|grid-template-rows)\s/.test(t)) layout.push(`${rule.selector} { ${t} }`);
    });
    expect(layout.sort()).toEqual([
      ".frame[data-sidebar-moving] .main { margin-left var(--d-rail) var(--ease-out) }",
      ".frame[data-sidebar-moving] .railToggle { grid-template-rows var(--d-rail) var(--ease-out) }",
      ".frame[data-sidebar-moving] .side { width var(--d-rail) var(--ease-out) }",
    ]);
    // And each of them sits behind the moving flag.
    for (const entry of layout) expect(entry).toContain("[data-sidebar-moving]");
  });

  it("never lets a fade var idle at `none`: it is also one item in the toggles' transition lists, where `none` voids the whole list", () => {
    const vars = ["--t-label", "--t-rail"];
    const idle = new Map<string, string[]>();
    root.walkDecls((d) => {
      if (vars.includes(d.prop)) idle.set(d.prop, [...(idle.get(d.prop) ?? []), d.value]);
    });
    for (const name of vars) {
      expect(idle.get(name)?.length).toBeGreaterThan(0);
      for (const value of idle.get(name) ?? []) expect(value).not.toBe("none");
    }
    // Every consumer that mixes the var with other items, as a guard for the rule above.
    let listed = 0;
    root.walkDecls("transition", (d) => {
      const items = d.value.split(/,(?![^(]*\))/).map((x) => x.trim());
      if (items.length > 1 && items.some((x) => /^var\(--t-(label|rail)\)$/.test(x))) listed++;
    });
    expect(listed).toBeGreaterThanOrEqual(2);
  });

  it("uses the rail token and the strong ease-out for the rail", () => {
    const side = rules(".frame[data-sidebar-moving] .side")[0];
    expect(decl(side, "transition")).toBe("width var(--d-rail) var(--ease-out)");
    expect(decl(rules(".frame[data-sidebar-moving] .main")[0], "transition")).toBe("margin-left var(--d-rail) var(--ease-out)");
  });

  it("text leaves first and arrives after the rail is mostly open", () => {
    const expanding = decl(rules(".frame[data-sidebar-moving] .side")[0], "--t-label") ?? "";
    const collapsing = decl(rules('.frame[data-sidebar-moving] .side[data-collapsed="true"]')[0], "--t-label") ?? "";
    expect(expanding).toMatch(/110ms/);
    expect(collapsing).not.toContain("110ms");
    expect(collapsing).toContain("var(--d-pop-out)");
  });

  it("hides the tooltips when the rail is expanded and while it moves", () => {
    const hidden = rules('.side:not([data-collapsed="true"]) .railTip.railTip > :global(.sv-tip)');
    expect(hidden).toHaveLength(1);
    expect(hidden[0].selectors).toContain('.frame[data-sidebar-moving] .side .railTip.railTip > :global(.sv-tip)');
    expect(decl(hidden[0], "display")).toBe("none");
  });

  it("turns every rail transition off under reduced motion", () => {
    let reduced: string | undefined;
    root.walkAtRules("media", (at) => {
      if (at.params.includes("prefers-reduced-motion")) reduced = (reduced ?? "") + at.toString();
    });
    // Zero-length, not `none` (see the list test above): no fade, no delay.
    expect(reduced).toContain("--t-label: opacity 0s");
    expect(reduced).toContain("--t-rail: opacity 0s");
    expect(reduced).toMatch(/\.frame\[data-sidebar-moving\] \.main[\s\S]*transition: none/);
  });

  it("animates nothing but opacity, visibility, transform-like and layout the rail needs", () => {
    expect(css).not.toMatch(/transition:[^;]*\ball\b/);
  });
});
