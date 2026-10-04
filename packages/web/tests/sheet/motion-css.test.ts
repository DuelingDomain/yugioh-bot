import { readFileSync } from "node:fs";
import path from "node:path";
import postcss, { type AtRule, type ChildNode, type Rule } from "postcss";
import { describe, expect, it } from "vitest";

const FILES = ["src/styles/match-sheet.css", "src/components/layout/shell.module.css"];
const GATE = /^\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)$/;

function load(rel: string) {
  return postcss.parse(readFileSync(path.resolve(__dirname, "../..", rel), "utf8"));
}
function inHoverGate(node: ChildNode): boolean {
  for (let p = node.parent; p && p.type !== "root"; p = p.parent as ChildNode["parent"]) {
    const at = p as AtRule;
    if (at.type === "atrule" && at.name === "media" && GATE.test(at.params.trim())) return true;
  }
  return false;
}

describe.each(FILES)("%s motion rules", (rel) => {
  const root = load(rel);

  it("keeps every :hover rule inside (hover: hover) and (pointer: fine)", () => {
    const loose: string[] = [];
    root.walkRules((rule: Rule) => {
      if (/keyframes$/.test((rule.parent as AtRule | undefined)?.name ?? "")) return;
      if (rule.selector.includes(":hover") && !inHoverGate(rule)) loose.push(rule.selector);
    });
    expect(loose).toEqual([]);
  });

  it("never uses transition: all, ease-in or linear on a transition", () => {
    const bad: string[] = [];
    root.walkDecls(/^transition(-timing-function)?$/, (d) => {
      if (/\ball\b|\bease-in\b(?!-out)|\blinear\b/.test(d.value)) bad.push(`${(d.parent as Rule).selector}: ${d.value}`);
    });
    expect(bad).toEqual([]);
  });
});

describe("match-sheet.css press", () => {
  const root = load(FILES[0]);

  it("points .ms at the shared ease-out", () => {
    let value: string | undefined;
    root.walkRules(".ms", (r) => r.walkDecls("--ease", (d) => { value = d.value; }));
    expect(value).toBe("var(--ease-out)");
  });

  it("scales buttons on :active with the reduced-motion aware token", () => {
    const pressed = new Map<string, string>();
    root.walkRules((r) => {
      if (!r.selector.includes(":active")) return;
      r.walkDecls("scale", (d) => { pressed.set(r.selector, d.value); });
    });
    const all = [...pressed.keys()].join("\n");
    for (const needle of [".ms .btn:active", ".ms .sv-btn:active", ".ms .seg button:active", ".ms .ib:active"]) expect(all).toContain(needle);
    expect(new Set(pressed.values())).toEqual(new Set(["var(--motion-press)", "var(--motion-press-row)"]));
  });
});

describe("match-sheet.css segmented indicator", () => {
  const root = load(FILES[0]);

  it("slides one box with transform only and hides it when nothing is selected", () => {
    const decls = new Map<string, Map<string, string>>();
    root.walkRules((r) => {
      if (!r.selector.includes(".seg[data-slide") || r.parent?.type !== "root") return;
      const props = decls.get(r.selector) ?? new Map<string, string>();
      r.walkDecls((d) => { props.set(d.prop, d.value); });
      decls.set(r.selector, props);
    });
    const bar = decls.get(".ms .seg[data-slide]::before");
    expect(bar?.get("transform")).toContain("translateX(calc(var(--seg-i, 0) * 100%))");
    expect(bar?.get("width")).toContain("var(--seg-n, 1)");
    expect(bar?.get("transition")).toBe("transform var(--d-tab) var(--ease-in-out)");
    expect(decls.get('.ms .seg[data-slide="none"]::before')?.get("display")).toBe("none");
    expect(decls.get('.ms .seg[data-slide] button[aria-pressed="true"]')?.get("background")).toBe("none");
  });
});
