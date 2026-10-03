import { readFileSync } from "node:fs";
import postcss from "postcss";
import { expect, it } from "vitest";

const shell = postcss.parse(readFileSync(new URL("../../../src/components/layout/shell.module.css", import.meta.url), "utf8"));
function leftOf(selector: string, inMedia = false): string | undefined {
  const rules: postcss.Rule[] = [];
  shell.walkRules((rule) => {
    const inside = rule.parent?.type === "atrule";
    if (inside === inMedia && rule.selectors.includes(selector)) rules.push(rule);
  });
  let left: string | undefined;
  for (const rule of rules) rule.walkDecls("left", (decl) => { left = decl.value; });
  return left;
}

it("puts the Report bug button past the 236px sidebar, past the 68px rail, and at the edge on a phone", () => {
  expect(leftOf(".bugFab")).toBe("calc(236px + 12px)");
  expect(leftOf('.frame[data-sidebar-collapsed="true"] .bugFab')).toBe("calc(68px + 12px)");
  expect(leftOf(".bugFab", true)).toBe("12px");
});

it("keeps the button under the sidebar's layer next to the rail, so the rail's account menu opens over it", () => {
  const zOf = (selector: string, inMedia: boolean) => {
    let z: string | undefined;
    shell.walkRules((rule) => {
      if ((rule.parent?.type === "atrule") === inMedia && rule.selectors.includes(selector)) rule.walkDecls("z-index", (decl) => { z = decl.value; });
    });
    return z;
  };
  expect(zOf('.frame[data-sidebar-collapsed="true"] .bugFab', false)).toBe("29");
  expect(zOf('.frame[data-sidebar-collapsed="true"] .bugFab', true)).toBe("40");
});
