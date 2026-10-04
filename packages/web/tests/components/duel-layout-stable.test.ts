import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

// The board size follows the space left under the header and above the track, and nothing else.
// An alert that shows for a moment ("Connection lost", "Action failed") used to sit in flow above
// the layout and shrink the whole board while it showed. jsdom does not lay out, so these tests
// read the source.

const duel = join(fileURLToPath(new URL("../../", import.meta.url)), "src/components/duel");
const css = readFileSync(join(duel, "room.module.css"), "utf8");
const tsx = readFileSync(join(duel, "room.tsx"), "utf8");
const room = ts.createSourceFile("room.tsx", tsx, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const table = ts.createSourceFile("table-shell.tsx", readFileSync(join(duel, "table/table-shell.tsx"), "utf8"),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function descendants<T extends ts.Node>(node: ts.Node, matches: (node: ts.Node) => node is T): T[] {
  const found: T[] = [];
  const visit = (child: ts.Node) => {
    if (matches(child)) found.push(child);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

function classElements(node: ts.Node, className: string): ts.JsxElement[] {
  return descendants(node, ts.isJsxElement).filter((element) => element.openingElement.attributes.properties.some((attribute) =>
    ts.isJsxAttribute(attribute) && attribute.name.getText() === "className" && attribute.initializer != null &&
    ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression?.getText() === className));
}

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

  it("renders every alert inside its render path's notices box, inside the layout", () => {
    // The notices are one node (`noticesNode`), built once and rendered by the flat layout and by the 3D mode room.
    const noticesDeclaration = descendants(room, ts.isVariableDeclaration).filter((declaration) => declaration.name.getText() === "noticesNode");
    expect(noticesDeclaration).toHaveLength(1);
    const legacyNotices = classElements(noticesDeclaration[0], "styles.notices");
    expect(legacyNotices).toHaveLength(1);
    const legacyAlerts = classElements(legacyNotices[0], "styles.error");
    expect(legacyAlerts).toHaveLength(3);
    const legacyLayouts = classElements(room, "styles.layout");
    expect(legacyLayouts).toHaveLength(1);
    const renderedLegacy = descendants(legacyLayouts[0], ts.isJsxExpression).filter((expression) => expression.expression?.getText() === "noticesNode");
    expect(renderedLegacy).toHaveLength(1);

    // Both live shells (TableShell and the Tag Rooftop) get the same `shellProps` object, so its notices are the table path's.
    const shellProps = descendants(room, ts.isVariableDeclaration).filter((declaration) => declaration.name.getText() === "shellProps");
    expect(shellProps).toHaveLength(1);
    const noticeProps = descendants(shellProps[0], ts.isPropertyAssignment).filter((assignment) => assignment.name.getText() === "notices");
    expect(noticeProps).toHaveLength(1);
    const tableAlerts = classElements(noticeProps[0], "styles.error");
    expect(tableAlerts).toHaveLength(3);

    // Every alert must belong to one of the two protected paths; alerts elsewhere fail this guard.
    expect(new Set([...legacyAlerts, ...tableAlerts])).toEqual(new Set(classElements(room, "styles.error")));

    const tableLayouts = classElements(table, "roomStyles.layout");
    expect(tableLayouts).toHaveLength(1);
    const tableNotices = classElements(tableLayouts[0], "roomStyles.notices");
    expect(tableNotices).toHaveLength(1);
    const renderedNotices = descendants(tableNotices[0], ts.isJsxExpression).filter((expression) =>
      expression.expression?.getText() === "notices");
    expect(renderedNotices).toHaveLength(1);
  });

  it("clips the shell so focus cannot scroll the room", () => {
    expect(rule(".shell")).toMatch(/overflow:\s*clip/);
  });
});
