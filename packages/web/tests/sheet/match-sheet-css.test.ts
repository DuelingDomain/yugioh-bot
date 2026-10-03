import { readFileSync } from "node:fs";
import path from "node:path";
import postcss, { type AtRule, type ChildNode, type Rule } from "postcss";
import { describe, expect, it } from "vitest";

const file = path.resolve(__dirname, "../../src/styles/match-sheet.css");
const root = postcss.parse(readFileSync(file, "utf8"));

function ancestors(node: ChildNode): AtRule[] {
  const out: AtRule[] = [];
  for (let p = node.parent; p && p.type !== "root"; p = p.parent as ChildNode["parent"]) out.push(p as AtRule);
  return out;
}
const inKeyframes = (r: Rule) => ancestors(r).some((a) => /keyframes$/.test(a.name));
const inBaseLayer = (r: Rule) => ancestors(r).some((a) => a.name === "layer" && a.params === "base");

const rules: Rule[] = [];
root.walkRules((r) => { if (!inKeyframes(r)) rules.push(r); });

function selectors(r: Rule): string[] {
  return r.selectors.map((s) => s.trim());
}

describe("match-sheet.css scoping", () => {
  it("has rules", () => {
    expect(rules.length).toBeGreaterThan(800);
  });

  it("starts every selector with .ms or :where(.ms)", () => {
    const bad = rules.flatMap(selectors).filter((s) => !(/^\.ms(?![\w-])/.test(s) || s.startsWith(":where(.ms)")));
    expect(bad).toEqual([]);
  });

  it("never targets html or body", () => {
    const bad = rules.flatMap(selectors).filter((s) => /(^|[\s>+~(,])(html|body)(?![\w-])/.test(s.replace(/^:where\(\.ms\)\s*/, "").replace(/^\.ms\s*/, "")));
    expect(bad).toEqual([]);
  });

  it("puts every element-only rule in @layer base and nothing else there", () => {
    const stripped = (s: string) => s.replace(/^:where\(\.ms\)\s*/, "").replace(/^\.ms\s*/, "");
    const elementOnly = (s: string) => !/[.#\[]/.test(stripped(s));
    const unlayeredElement = rules.filter((r) => !inBaseLayer(r)).flatMap(selectors).filter((s) => s.startsWith(".ms") && s !== ".ms" && elementOnly(s));
    expect(unlayeredElement).toEqual([]);
    const layered = rules.filter(inBaseLayer).flatMap(selectors);
    expect(layered.length).toBeGreaterThan(5);
    expect(layered.filter((s) => !s.startsWith(":where(.ms)"))).toEqual([]);
    expect(layered.filter((s) => !elementOnly(s))).toEqual([]);
    expect(rules.filter((r) => !inBaseLayer(r)).flatMap(selectors).filter((s) => s.startsWith(":where(.ms)"))).toEqual([]);
  });

  it("resolves --t-dia to the duel layer's #dbe6ff (last .ms declaration wins)", () => {
    let value: string | undefined;
    for (const r of rules) {
      if (inBaseLayer(r) || r.selector.trim() !== ".ms") continue;
      r.walkDecls("--t-dia", (d) => { value = d.value; });
    }
    expect(value).toBe("#dbe6ff");
  });

  it("maps the font tokens to the app's loaded fonts", () => {
    const decl = (prop: string) => {
      let v: string | undefined;
      for (const r of rules) if (r.selector.trim() === ".ms") r.walkDecls(prop, (d) => { v = d.value; });
      return v;
    };
    expect(decl("--f-ui")).toContain("--font-duel-ui");
    expect(decl("--f-num")).toContain("--font-duel-num");
    expect(decl("--f-ink")).toContain("--font-duel-ink");
    expect(decl("--f-disp")).toContain("--font-duel-display");
    expect(decl("--f-shell")).toContain("--font-chakra-petch");
    expect(decl("container-type")).toBe("inline-size");
  });

  it("defines the ms-flow modifier", () => {
    const flow = rules.find((r) => r.selector.trim() === ".ms.ms-flow");
    expect(flow?.toString()).toContain("container-type: normal");
  });

  it("prefixes every keyframe name with ms-", () => {
    const names: string[] = [];
    root.walkAtRules(/keyframes$/, (a) => { names.push(a.params); });
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((n) => !n.startsWith("ms-"))).toEqual([]);
    const used: string[] = [];
    root.walkDecls(/^animation(-name)?$/, (d) => { used.push(d.value); });
    for (const v of used) {
      if (v.trim() === "none") continue;
      expect(names.some((n) => v.includes(n))).toBe(true);
    }
  });

  it("scopes the board-id selectors the way build.py does", () => {
    const all = rules.flatMap(selectors);
    expect(all).toContain(".ms .tl:where(:not(.pip))");
    expect(all).toContain(".ms .br:where(:not(.pip))");
    expect(all).toContain(".ms .an:where(:not(.ach *))");
    expect(all).not.toContain(".ms .tl");
    expect(all).not.toContain(".ms .br");
  });

  it("leaves out review-page chrome", () => {
    const all = rules.flatMap(selectors).join("\n");
    for (const c of ["rv-nav", "board-head", "notes", "decisions", "screen", "app-top", "app-side", "phones", "dim-shell"]) {
      expect(all).not.toMatch(new RegExp(`\\.${c}(?![\\w-])`));
    }
  });
});
