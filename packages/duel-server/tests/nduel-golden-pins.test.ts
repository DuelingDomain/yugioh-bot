import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { multiScriptsFolderHash } from "../src/multi-scripts.js";

const script = fileURLToPath(new URL("../scripts/run-nduel.sh", import.meta.url));
const roots: string[] = [];
const pins = { scripts: "a".repeat(40), database: "b".repeat(40), strings: "c".repeat(40) };
const fingerprint = (sources: typeof pins) => createHash("sha256").update(JSON.stringify(sources)).digest("hex");
const diagnostic = "data pins changed: re-record with run-nduel.sh --record";

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(current = pins, metadata = fingerprint(pins)) {
  const root = mkdtempSync(join(tmpdir(), "nduel-pins-"));
  roots.push(root);
  const scripts = join(root, "packages/duel-server/scripts");
  mkdirSync(join(scripts, "native"), { recursive: true });
  const runner = join(scripts, "run-nduel.sh");
  copyFileSync(script, runner);
  writeFileSync(join(scripts, "prepare-data.ts"), `const sources = {\n  corePackage: "test-core",\n${Object.entries(current).map(([key, value]) => `  ${key}: "${value}",`).join("\n")}\n};\n`);
  const overlay = join(scripts, "../domain-core/multi-scripts");
  const patches = join(scripts, "../domain-core/patches");
  mkdirSync(join(overlay, "nested"), { recursive: true });
  mkdirSync(patches, { recursive: true });
  writeFileSync(join(overlay, "nested/c1.lua"), "-- overlay\n");
  writeFileSync(join(overlay, "MANIFEST.json"), "{}\n");
  writeFileSync(join(patches, "0001-test.patch"), "patch\n");
  const folderMetadata = `# multi-scripts-sha256=${multiScriptsFolderHash(overlay)}\n# patches-sha256=${multiScriptsFolderHash(patches)}\n`;
  const golden = join(scripts, "native/golden.tsv");
  writeFileSync(golden, `n\tmode\tseed\tsteps\thash\n# turns=60 lp=3000\n${metadata ? `# data-pins-sha256=${metadata}\n` : ""}${folderMetadata}2\tffa\t1\t1\tfixture-hash\n`);
  // Reaching this stub demonstrates that the metadata guard passed, without building a core.
  const built = join(root, "builder-reached");
  writeFileSync(join(scripts, "build-native-core.sh"), `#!/usr/bin/env bash\ntouch '${built}'\necho fixture-build-boundary\nexit 2\n`);
  const work = join(root, "work");
  const run = (mode = "--check", overrides: NodeJS.ProcessEnv = {}) => spawnSync("bash", [runner, mode], {
    encoding: "utf8",
    timeout: 10_000,
    env: { ...process.env, NDUEL_DIR: work, NDUEL_STATUS_DIR: join(root, "status"), NDUEL_NO_LOCK: "1",
      DUEL_MULTI_SCRIPTS_DIR: overlay, NDUEL_SKIP_BUILD: "0", NDUEL_DOMAIN: "0", NDUEL_CASES: "n2", NDUEL_SEEDS: "1", NDUEL_JOBS: "1", ...overrides },
  });
  return { golden, built, work, run, overlay, patches };
}

describe("nduel golden data pins", () => {
  it.each(["scripts", "database", "strings"] as const)("rejects changed %s pins before reaching the build", (key) => {
    const f = fixture({ ...pins, [key]: "d".repeat(40) });
    const result = f.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(diagnostic);
    expect(existsSync(f.built)).toBe(false);
    expect(existsSync(f.work)).toBe(false);
  });

  it("requires re-recording when golden metadata is missing", () => {
    const f = fixture(pins, "");
    const result = f.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(diagnostic);
    expect(existsSync(f.built)).toBe(false);
  });

  it("continues to the build when the fingerprint matches", () => {
    const f = fixture();
    const result = f.run();
    expect(result.status).toBe(2);
    expect(result.stdout).toContain("fixture-build-boundary");
    expect(result.stderr).not.toContain(diagnostic);
    expect(existsSync(f.built)).toBe(true);
  });

  it("records current pins beside the golden rows", () => {
    const current = { ...pins, scripts: "d".repeat(40) };
    const f = fixture(current);
    mkdirSync(join(f.work, "data"), { recursive: true });
    writeFileSync(join(f.work, "data/cards.tsv"), "");
    writeFileSync(join(f.work, "data/pool.txt"), "");
    // A shell-only fixture stands in for the native driver; no real duels run.
    writeFileSync(join(f.work, "nduel"), "#!/usr/bin/env bash\necho 'NDUEL ok steps=1 hash=fixture-hash'\n", { mode: 0o755 });
    const result = f.run("--record", { NDUEL_SKIP_BUILD: "1" });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const golden = readFileSync(f.golden, "utf8");
    expect(golden).toContain(`# data-pins-sha256=${fingerprint(current)}\n`);
    expect(golden).toContain("2\tffa\t1\t1\tfixture-hash\n");
    expect(golden).not.toContain(current.scripts);
    expect(golden).toContain(`# multi-scripts-sha256=${multiScriptsFolderHash(f.overlay)}\n`);
    expect(golden).toContain(`# patches-sha256=${multiScriptsFolderHash(f.patches)}\n`);
    const check = f.run("--check", { NDUEL_SKIP_BUILD: "1" });
    expect(check.status, check.stdout + check.stderr).toBe(0);
    expect(check.stdout).toContain("1 rows checked, 0 skipped, 0 mismatches");
  });
});

const folderDiagnostic = "overlay/patches changed: re-record with run-nduel.sh --record";
describe("nduel golden overlay and patches", () => {
  it.each(["overlay", "patches"] as const)("rejects edited %s before creating work or building", (folder) => {
    const f = fixture();
    writeFileSync(join(f[folder], folder === "overlay" ? "nested/c1.lua" : "0001-test.patch"), "changed\n");
    const result = f.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(folderDiagnostic);
    expect(existsSync(f.built)).toBe(false);
    expect(existsSync(f.work)).toBe(false);
  });

  it.each(["multi-scripts", "patches"])("rejects missing %s metadata", (field) => {
    const f = fixture();
    writeFileSync(f.golden, readFileSync(f.golden, "utf8").replace(new RegExp(`^# ${field}-sha256=.*\\n`, "m"), ""));
    expect(f.run().stderr).toContain(folderDiagnostic);
    expect(existsSync(f.work)).toBe(false);
  });

  it("detects a patch rename even when the bytes are unchanged", () => {
    const f = fixture();
    renameSync(join(f.patches, "0001-test.patch"), join(f.patches, "0002-test.patch"));
    expect(f.run().stderr).toContain(folderDiagnostic);
    expect(existsSync(f.work)).toBe(false);
  });
});
