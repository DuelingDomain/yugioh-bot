import { readFileSync } from "node:fs";
import postcss, { type Rule } from "postcss";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../src/components/tournament/sheet/sheet-header.module.css", import.meta.url), "utf8");
const root = postcss.parse(css);

describe("SheetHeader responsive track CSS", () => {
  it("makes the track full width and aligns plates and caption left only at sheet widths up to 760px", () => {
    const containers = root.nodes.filter((node) => node.type === "atrule" && node.name === "container" && node.params === "(max-width: 760px)");
    expect(containers).toHaveLength(1);
    const rules: Rule[] = [];
    root.walkRules((rule) => { rules.push(rule); });

    const track = rules.find((rule) => rule.selector === ":global(.ms) .track:global(.trk)");
    const caption = rules.find((rule) => rule.selector === ":global(.ms) .track :global(.trk-cap)");
    expect(track?.parent).toBe(containers[0]);
    expect(caption?.parent).toBe(containers[0]);

    const declarations = (rule: Rule | undefined) => {
      const values: Record<string, string> = {};
      rule?.walkDecls((decl) => { values[decl.prop] = decl.value; });
      return values;
    };
    expect(declarations(track)).toEqual({ width: "100%", "justify-items": "start" });
    expect(declarations(caption)).toEqual({ "text-align": "left" });
    expect(rules).toHaveLength(2);
  });
});
