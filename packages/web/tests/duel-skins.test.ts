import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SOLID_SKIN, SOLID_SLOT_MODULES } from "@/components/duel/solid/skins";

const dir = resolve(__dirname, "../src/components/duel");
const classNames = (file: string) => {
  const css = readFileSync(resolve(dir, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  return new Set([...css.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((match) => match[1]));
};

describe("solid skin", () => {
  it("covers every skin slot", () => {
    expect(Object.keys(SOLID_SKIN).sort()).toEqual(Object.keys(SOLID_SLOT_MODULES).sort());
  });

  it("never gives one class name to two modules of the same slot", () => {
    for (const [slot, { names }] of Object.entries(SOLID_SLOT_MODULES)) {
      const seen = new Map<string, string>();
      for (const name of names) {
        for (const key of classNames(`solid/${name}.module.css`)) {
          // Numbers inside values such as `.5s` are not class names; real class names start with a letter.
          expect(seen.get(key), `${slot}: .${key} is in ${seen.get(key)} and ${name}`).toBeUndefined();
          seen.set(key, name);
        }
      }
    }
  });

  it("never reuses a class name of the V1 module it skins in the field slot", () => {
    const base = classNames("field.module.css");
    const clash = [...classNames("solid/table.module.css"), ...classNames("solid/rails.module.css"), ...classNames("solid/docks.module.css")]
      .filter((key) => base.has(key));
    expect(clash).toEqual([]);
  });
});
