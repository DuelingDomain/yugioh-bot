import { readFileSync } from "node:fs";
import postcss from "postcss";
import { expect, it } from "vitest";

const shell = postcss.parse(readFileSync(new URL("../../../src/components/layout/shell.module.css", import.meta.url), "utf8"));

it("allows vertical scrolling of the viewport-height sidebar to reach its footer", () => {
  const sidebar = shell.nodes.find((node) => node.type === "rule" && node.selector === ".aside");
  expect(sidebar).toBeDefined();
  if (sidebar?.type !== "rule") return;
  const declarations = Object.fromEntries(sidebar.nodes.flatMap((node) => node.type === "decl" ? [[node.prop, node.value]] : []));
  expect(declarations.height).toBe("100%");
  expect(["auto", "scroll"]).toContain(declarations["overflow-y"] ?? declarations.overflow);
});
