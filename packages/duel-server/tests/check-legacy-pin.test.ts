import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "..", "scripts", "check-legacy-pin.sh");
const pinFile = join(here, "..", "legacy-1v1", "expected-sha256.txt");
const readme = join(here, "..", "legacy-1v1", "README.md");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const sha = (bytes: string) => createHash("sha256").update(bytes).digest("hex");

function bundle(wasm: string, lua: string): { dir: string; expected: string } {
  const dir = mkdtempSync(join(tmpdir(), "legacy-pin-"));
  roots.push(dir);
  mkdirSync(join(dir, "card-scripts"));
  writeFileSync(join(dir, "ocgcore.domain.legacy.wasm"), wasm);
  writeFileSync(join(dir, "card-scripts", "domain.legacy.lua"), lua);
  const expected = join(dir, "expected.txt");
  writeFileSync(expected, `${sha("wasm")}  ocgcore.domain.legacy.wasm\n${sha("lua")}  card-scripts/domain.legacy.lua\n`);
  return { dir, expected };
}

describe("check-legacy-pin.sh", () => {
  it("accepts files with the expected sha256", () => {
    const { dir, expected } = bundle("wasm", "lua");
    const run = spawnSync("sh", [script, dir, expected], { encoding: "utf8" });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("legacy pin ok");
  });

  it("fails when the legacy wasm is another build", () => {
    const { dir, expected } = bundle("another wasm", "lua");
    const run = spawnSync("sh", [script, dir, expected], { encoding: "utf8" });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("ocgcore.domain.legacy.wasm");
  });

  it("fails when the legacy Lua differs, and when a file is missing", () => {
    const changed = bundle("wasm", "lua changed");
    expect(spawnSync("sh", [script, changed.dir, changed.expected], { encoding: "utf8" }).status).toBe(1);
    const missing = bundle("wasm", "lua");
    rmSync(join(missing.dir, "ocgcore.domain.legacy.wasm"));
    const run = spawnSync("sh", [script, missing.dir, missing.expected], { encoding: "utf8" });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("is missing");
  });

  it("the committed pin file agrees with the shas in the legacy README (the approved legacy pin)", () => {
    const pins = Object.fromEntries(readFileSync(pinFile, "utf8").trim().split("\n").map((line) => {
      const [value, name] = line.split(/\s+/);
      return [name, value];
    }));
    const text = readFileSync(readme, "utf8");
    expect(text).toContain(`\`${pins["ocgcore.domain.legacy.wasm"]}\``);
    expect(text).toContain(`\`${pins["card-scripts/domain.legacy.lua"]}\``);
  });
});
