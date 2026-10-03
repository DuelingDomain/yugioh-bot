import { readFileSync } from "node:fs";
import path from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

const read = (rel: string) => postcss.parse(readFileSync(path.resolve(__dirname, "../../../src/components", rel), "utf8"));
const dashboard = read("dashboard/dashboard.module.css");
const row = read("tournament/tournament-row.module.css");

describe("dashboard responsive styles", () => {
  it("puts tournaments first and widest, then stacks the columns at a 900px sheet width", () => {
    let wide: string | undefined;
    dashboard.walkRules(".cols", (rule) => {
      if (rule.parent?.type === "root") rule.walkDecls("grid-template-columns", (decl) => { wide = decl.value; });
    });
    expect(wide).toBe("minmax(0, 2fr) minmax(0, 1fr)");

    let stacked: string | undefined;
    dashboard.walkAtRules("container", (query) => {
      if (query.params.replace(/\s/g, "") !== "(max-width:900px)") return;
      query.walkRules(".cols", (rule) => {
        rule.walkDecls("grid-template-columns", (decl) => { stacked = decl.value; });
      });
    });
    expect(stacked).toBe("minmax(0, 1fr)");
  });

  it("wraps row names between words and keeps the whole row as one link", () => {
    let wrapping: string | undefined;
    let cover: string | undefined;
    row.walkRules(".name", (rule) => {
      rule.walkDecls("overflow-wrap", (decl) => { wrapping = decl.value; });
    });
    row.walkRules(".name::after", (rule) => {
      rule.walkDecls("inset", (decl) => { cover = decl.value; });
    });
    expect(wrapping).toBe("anywhere");
    expect(cover).toBe("0");
  });

  it("places the row cells by area at 620px with a selector as heavy as the column rules, so the ring row stacks", () => {
    const phone: string[] = [];
    row.walkAtRules("container", (query) => {
      if (query.params.replace(/\s/g, "") !== "(max-width:620px)") return;
      query.walkRules((rule) => {
        if (rule.selector.startsWith(".row ") && rule.some((n) => n.type === "decl" && n.prop === "grid-area")) phone.push(rule.selector);
      });
    });
    expect(phone).toEqual(expect.arrayContaining([".row .lead", ".row .id", ".row .strip", ".row .act"]));
  });

  it("keeps a slash command in the empty-state lines on one line", () => {
    let nowrap = false;
    dashboard.walkRules(".none code", (rule) => rule.walkDecls("white-space", (d) => { nowrap = d.value === "nowrap"; }));
    expect(nowrap).toBe(true);
  });
});
