import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

const hash = (bytes: string) => createHash("sha256").update(bytes).digest("hex");

it.each([
  "packages/duel-server/scripts/build-domain-core.sh",
  "packages/duel-server/scripts/build-standard-core.sh",
  "packages/duel-server/legacy-1v1/scripts/build-domain-core.sh",
  "scripts/ci/assemble-core-bundle.mjs",
  "packages/e2e/stack/manual-data.mjs",
])("%s preserves bundle identity across SQLite output and overlay changes", file => {
  const source = readFileSync(resolve(import.meta.dirname, "../../..", file), "utf8");
  // Exercise each writer's actual hash calculation without compiling or running a core.
  const calculation = source.match(/^(?:  )?(?:const \{[^\n]*\} = manifest\.integrity;\n(?:  )?)?manifest\.bundleVersion = [^\n]+;/m)?.[0];
  expect(calculation).toBeTruthy();
  const version = (cardsMerged: string, multiScripts: string, cards = "pinned-inputs") => {
    const manifest = { sources: { database: "pin" }, integrity: { cards, cardsMerged, multiScripts }, bundleVersion: "" };
    runInNewContext(calculation!, { manifest, hash, createHash });
    return manifest.bundleVersion;
  };
  expect(version("sqlite-old", "overlay-old")).toBe(version("sqlite-new", "overlay-new"));
  expect(version("sqlite-new", "overlay-new", "changed-inputs")).not.toBe(version("sqlite-new", "overlay-new"));
});
