import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss, { type Rule } from "postcss";
import { describe, expect, it } from "vitest";

const css = (file: string) => postcss.parse(readFileSync(resolve(import.meta.dirname, "../src/components/draft", file), "utf8"));
const frame = css("draft-frame.module.css");
const list = css("list/drafts-list.module.css");
const create = css("create/create.module.css");
const lobby = css("lobby/lobby.module.css");
const summary = css("summary/summary.module.css");
const pool = postcss.parse(readFileSync(resolve(import.meta.dirname, "../src/components/cards/card-pool-sheet.module.css"), "utf8"));

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

describe("drafts page frame", () => {
  const narrow = "(max-width: 900px)";
  it("pads the body itself: 32px on a desktop, 16px on a phone", () => {
    expect(declarations(frame, ".body").padding).toBe("28px 32px 56px");
    expect(declarations(frame, ".body", "(max-width: 620px)").padding).toBe("20px 16px 48px");
  });

  it("is a main column and a 340px rail on a desktop, with the rail and actions sticking to the top", () => {
    expect(declarations(frame, ".layout")).toMatchObject({ display: "grid", "grid-template-columns": "minmax(0, 1fr) 340px" });
    expect(declarations(frame, ".side")).toMatchObject({ position: "sticky", top: "20px", "overflow-y": "auto" });
  });

  it("is a flex column on a phone where the actions are a flex item that sticks to the bottom", () => {
    expect(declarations(frame, ".layout", narrow)).toMatchObject({ display: "flex", "flex-direction": "column" });
    expect(declarations(frame, ".layout", narrow)["align-items"]).toBe("stretch");
    expect(declarations(frame, ".side", narrow).display).toBe("contents");
    expect(declarations(frame, ".actions", narrow)).toMatchObject({ position: "sticky", bottom: "0" });
    expect(declarations(frame, ".actions", narrow).padding).toContain("env(safe-area-inset-bottom)");
  });
});

describe("draft list", () => {
  it("places the cells in their kit phone areas only on a phone, so desktop rows read left to right", () => {
    expect(declarations(list, ".aId")["grid-area"]).toBeUndefined();
    expect(declarations(list, ".aId", "(max-width: 620px)")["grid-area"]).toBe("id");
    expect(declarations(list, ".chevron", "(max-width: 620px)").display).toBe("none");
  });

  const phone = "(max-width: 620px)";
  it("lets the whole row be one link and keeps the room button out of the tab order", () => {
    expect(declarations(list, ".act")["pointer-events"]).toBe("none");
  });

  it("shrinks the room button and tightens the row on phones", () => {
    expect(declarations(list, ":global(.ms) .act:global(.sv-btn)", phone)).toMatchObject({ height: "32px", "font-size": "14px" });
    expect(declarations(list, ".row .prog", phone)["margin-top"]).toBe("12px");
  });

  it("keeps the joined count readable without breaking the line", () => {
    expect(declarations(list, ".joined")).toMatchObject({ "white-space": "nowrap", "justify-self": "end" });
  });
});

describe("draft phone card pools", () => {
  it("selects three pool columns, including loading tiles, and truncates phone card names", () => {
    const phone = "(max-width: 560px)";
    expect(declarations(pool, ".scroll")["--pool-columns"]).toBeUndefined();
    expect(declarations(pool, ".scroll", phone)["--pool-columns"]).toBe("3");
    expect(declarations(pool, ".skel", phone)["grid-template-columns"]).toBe("repeat(3, minmax(0, 1fr))");
    expect(declarations(pool, ":global(.ms) .tile :global(.ct-n)", phone)).toMatchObject({ display: "block", "min-width": "0", overflow: "hidden", "white-space": "nowrap", "text-overflow": "ellipsis" });
  });

  it("shows seven finished cards and the phone count in four columns while retaining the desktop preview", () => {
    const phone = "(max-width: 560px)";
    expect(declarations(summary, ".cards")["grid-template-columns"]).toBe("repeat(auto-fill, minmax(76px, 1fr))");
    expect(declarations(summary, ".phoneMore").display).toBe("none");
    expect(declarations(summary, ".desktopCard").display).toBeUndefined();
    expect(declarations(summary, ".desktopMore").display).toBeUndefined();
    expect(declarations(summary, ".cards", phone)["grid-template-columns"]).toBe("repeat(4, minmax(0, 1fr))");
    expect(declarations(summary, ".desktopCard", phone).display).toBe("none");
    expect(declarations(summary, ".desktopMore", phone).display).toBe("none");
    expect(declarations(summary, ".phoneMore", phone).display).toBe("block");
  });

  it("draws the level bars as thin beam lines", () => {
    expect(declarations(summary, ".bars > span::before")).toMatchObject({ width: "3px", background: "rgb(var(--beam) / 0.9)" });
  });
});

describe("lobby players", () => {
  it("is one column on a phone and wraps into columns when there is room", () => {
    expect(declarations(lobby, ".seats")["grid-template-columns"]).toBe("repeat(auto-fill, minmax(min(100%, 260px), 1fr))");
    expect(declarations(lobby, ".seats", "(max-width: 620px)")["grid-template-columns"]).toBe("minmax(0, 1fr)");
  });
});

describe("new draft container layouts", () => {
  const phone = "(max-width: 760px)";
  it("fills the sheet with equal desktop columns and heights, stacks with natural phone heights, and pins the defaults below the facts", () => {
    expect(declarations(create, ".choose")).toMatchObject({ "grid-template-columns": "repeat(2, minmax(0, 1fr))", "grid-auto-rows": "1fr" });
    expect(declarations(create, ".choose")["max-width"]).toBeUndefined();
    expect(declarations(create, ".choose", phone)).toMatchObject({ "grid-template-columns": "minmax(0, 1fr)", "grid-auto-rows": "auto" });
    expect(declarations(create, ".kind")).toMatchObject({ display: "flex", "flex-direction": "column" });
    expect(declarations(create, ".defaults")).toMatchObject({ "margin-top": "auto", "border-top": "1px solid var(--rule-lo)", color: "var(--ink-3)" });
  });

  it("lifts the kind card with a transform only, and drops the lift under reduced motion", () => {
    expect(declarations(create, ".kind").transition).toBe("transform 160ms var(--ease), border-color 160ms var(--ease)");
    expect(declarations(create, ".kind:hover").transform).toBe("translateY(-2px)");
    const reducedMotion = create.nodes.find((node) => node.type === "atrule" && node.name === "media" && node.params === "(prefers-reduced-motion: reduce)");
    expect(reducedMotion?.toString()).toContain(".kind:hover { transform: none; }");
  });

  it("gives all three chooser cards a transform", () => {
    expect(declarations(create, ".fan img:nth-child(1)").transform).toBe("translateY(4px) rotate(-9deg)");
    expect(declarations(create, ".fan img:nth-child(2)").transform).toBe("translateY(-2px)");
    expect(declarations(create, ".fan img:nth-child(3)").transform).toBe("translateY(4px) rotate(9deg)");
  });

  it("stacks the form sections' label column above the fields on a narrow container and keeps the join command on one line", () => {
    expect(declarations(create, ".sec")["grid-template-columns"]).toBe("200px minmax(0, 1fr)");
    expect(declarations(create, ".steps code:global(.cmd)")["white-space"]).toBe("nowrap");
  });
});
