import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss, { type Rule } from "postcss";
import { describe, expect, it } from "vitest";

const css = (file: string) => postcss.parse(readFileSync(resolve(import.meta.dirname, "../src/components/draft", file), "utf8"));
const list = css("list/drafts-list.module.css");
const create = css("create/create.module.css");
const lobby = css("lobby/lobby.module.css");
const meta = css("meta-line.module.css");

function declarations(root: postcss.Root, selector: string, container?: string) {
  const result: Record<string, string> = {};
  root.walkRules((rule: Rule) => {
    if (!rule.selectors.includes(selector)) return;
    const parent = rule.parent;
    if (parent?.type === "atrule" && parent.name !== "container") return;
    const context = parent?.type === "atrule" && parent.name === "container" ? parent.params : undefined;
    if (context !== container) return;
    rule.walkDecls((declaration) => { result[declaration.prop] = declaration.value; });
  });
  return result;
}

describe("draft meta lines", () => {
  it("clips the leading separator of each wrapped line without changing foundation typography or margins", () => {
    const line = declarations(meta, ":global(.ms) .line.line");
    expect(line).toMatchObject({ display: "block", overflow: "hidden" });
    for (const property of ["font", "font-size", "color", "margin", "margin-top"]) {
      expect(line[property]).toBeUndefined();
    }
    expect(declarations(meta, ".run")).toMatchObject({
      display: "flex", "flex-wrap": "wrap", "align-items": "center",
      "column-gap": "11px", "row-gap": "4px", "margin-left": "-14px",
    });
    expect(declarations(meta, ".item")).toMatchObject({ display: "inline-flex", "align-items": "center", "white-space": "nowrap" });
    expect(declarations(meta, '.item > :global(.dot)')["margin-right"]).toBe("11px");
  });
});

describe("draft list container layouts", () => {
  const phone = "(max-width: 760px)";
  it("preserves the desktop columns and places phone progress and action on one line", () => {
    expect(declarations(list, ":global(.ms) .row:global(.tl-row)")["grid-template-columns"]).toBe("minmax(0, 1fr) auto auto");
    expect(declarations(list, ":global(.ms) .row:global(.tl-row)", phone)).toMatchObject({ "grid-template-columns": "minmax(0, 1fr) auto", gap: "12px" });
    expect(declarations(list, ".details", phone)["grid-column"]).toBe("1 / -1");
    expect(declarations(list, ":global(.ms) .row .side:global(.tl-side)", phone)["justify-content"]).toBe("flex-end");
    expect(declarations(list, ".chevron", phone).display).toBe("none");
    expect(declarations(list, ":global(.ms) .prog :global(.trk.sm)", "(max-width: 560px)")).toMatchObject({ "--pw": "40px", "--gap": "6px" });
  });

  it("keeps the accessible joined text available at both sizes while only showing one visual count", () => {
    expect(declarations(list, ".joined")).toMatchObject({ position: "absolute", "clip-path": "inset(50%)" });
    expect(declarations(list, ".joined").display).not.toBe("none");
    expect(declarations(list, ".joined", phone)).toMatchObject({ position: "static", display: "inline-flex", "clip-path": "none", gap: "0" });
    expect(declarations(list, ":global(.ms) .row .count", phone).display).toBe("none");
    expect(declarations(list, ":global(.ms) .row .waitingSide", phone).display).toBe("none");
  });

  it("hides Kind instead of Ended on phone and styles the second kind line", () => {
    expect(declarations(list, ".mobileKind").display).toBe("none");
    expect(declarations(list, ":global(.ms) .ledger .kindColumn", phone).display).toBe("none");
    for (const cell of ["th", "td"]) {
      expect(declarations(list, `:global(.ms) .ledger:global(.ledger) ${cell}:nth-child(4)`, phone).display).toBe("table-cell");
    }
    expect(declarations(list, ".mobileKind", phone)).toMatchObject({ display: "block", color: "var(--ink-3)", "font-size": "12.5px" });
    expect(declarations(list, ":global(.ms) .ledger .fin td:first-child", phone)).toMatchObject({ "min-width": "0", "overflow-wrap": "anywhere" });
  });
});

describe("new draft container layouts", () => {
  const phone = "(max-width: 760px)";
  it("fills the sheet with equal desktop columns and heights, stacks with natural phone heights, and pins the actions below the facts", () => {
    expect(declarations(create, ".choose")).toMatchObject({ "grid-template-columns": "repeat(2, minmax(0, 1fr))", "grid-auto-rows": "1fr" });
    expect(declarations(create, ".choose")["max-width"]).toBeUndefined();
    expect(declarations(create, ".choose", phone)).toMatchObject({ "grid-template-columns": "minmax(0, 1fr)", "grid-auto-rows": "auto" });
    expect(declarations(create, ".kind")).toMatchObject({ display: "flex", "flex-direction": "column" });
    expect(declarations(create, ".defaults")).toMatchObject({ "margin-top": "auto", "border-top": "1px solid var(--rule-lo)", color: "var(--ink-3)" });
  });

  it("uses title-matched outline buttons, filled on card hover or focus, with only the card lift", () => {
    const action = ":global(.ms) .kind .go:global(.btn)";
    expect(declarations(create, ".kt").color).toBe("var(--pen-ink)");
    expect(declarations(create, action)).toMatchObject({ "align-self": "flex-start", "justify-content": "flex-start", "border-color": "var(--pen)", color: "var(--pen-ink)", transition: "none" });
    expect(declarations(create, action).width).toBeUndefined();
    expect(declarations(create, action, phone).width).toBe("100%");
    expect(declarations(create, ':global(.ms) .kind[data-k="theme"] .go')).toMatchObject({ "border-color": "var(--chain)", color: "var(--chain-ink)" });
    for (const state of [":hover", ":focus-visible"]) {
      expect(declarations(create, `:global(.ms) .kind${state} .go`).background).toBe("var(--pen-soft)");
      expect(declarations(create, `:global(.ms) .kind[data-k="theme"]${state} .go`).background).toBe("var(--chain-soft)");
    }
    expect(declarations(create, ":global(.ms) .kind .go:active").translate).toBe("none");
    expect(declarations(create, ".kind").transition).toBe("translate 160ms var(--ease)");
    const reducedMotion = create.nodes.find((node) => node.type === "atrule" && node.name === "media" && node.params === "(prefers-reduced-motion: reduce)");
    expect(reducedMotion?.toString()).toContain(".kind:hover { translate: none; }");
  });

  it("enlarges the desktop fans while preserving the phone size and overlap", () => {
    expect(declarations(create, ".fan img").width).toBe("84px");
    expect(declarations(create, ".fan img", phone).width).toBe("70px");
    expect(declarations(create, ".fan img + img", phone)["margin-left"]).toBe("-38px");
    expect(declarations(create, ".fan", phone).height).toBe("104px");
  });

  it("gives all three cards a transform in both chooser and lobby fans", () => {
    for (const fan of [create, lobby]) {
      expect(declarations(fan, ".fan img:nth-child(1)")).toMatchObject({ rotate: "-9deg", translate: "0 4px" });
      expect(declarations(fan, ".fan img:nth-child(2)").translate).toBe("0 -2px");
      expect(declarations(fan, ".fan img:nth-child(3)")).toMatchObject({ rotate: "9deg", translate: "0 4px" });
    }
  });

  it("removes only the form sections' top border and keeps the join command on one line", () => {
    expect(declarations(create, ":global(.ms) .sections:global(.mk-secs)")["border-top"]).toBe("0");
    expect(declarations(create, ":global(.ms) .sections:global(.mk-secs)")["border-bottom"]).toBeUndefined();
    expect(declarations(create, ":global(.ms) .next code:global(.cmd)")["white-space"]).toBe("nowrap");
  });
});
