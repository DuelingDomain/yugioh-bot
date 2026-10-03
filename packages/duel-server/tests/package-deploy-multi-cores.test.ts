import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const roots: string[] = [];
const builtBy = "1".repeat(40);

function fixture() {
  const work = mkdtempSync(join(tmpdir(), "deploy-provenance-"));
  roots.push(work);
  const core = join(work, "packages/duel-server/domain-core");
  const scripts = join(work, "packages/duel-server/scripts");
  const bundle = join(work, "bundle");
  mkdirSync(join(core, "dist"), { recursive: true });
  mkdirSync(scripts, { recursive: true });
  mkdirSync(bundle);
  for (const path of ["pins.json", "patches", "src/apply-domain-multi.mjs"]) {
    cpSync(join(root, "packages/duel-server/domain-core", path), join(core, path), { recursive: true });
  }
  const script = join(scripts, "package-deploy-multi-cores.mjs");
  cpSync(join(root, "packages/duel-server/scripts/package-deploy-multi-cores.mjs"), script);
  const pins = JSON.parse(readFileSync(join(core, "pins.json"), "utf8"));
  const domainMulti = createHash("sha256").update(readFileSync(join(core, "src/apply-domain-multi.mjs"))).digest("hex");
  for (const mode of ["multi", "multi-domain"]) {
    // A minimal valid WASM module; packaging validates bytes without running a duel.
    writeFileSync(join(core, "dist", `ocgcore.${mode}.sync.wasm`), Buffer.from("0061736d01000000", "hex"));
    writeFileSync(join(core, "dist", `ocgcore.${mode}-build-info.json`), JSON.stringify({
      ygoproCore: pins.ygoproCore.commit,
      ocgcoreWasm: pins.ocgcoreWasm.ref,
      lua: pins.lua.commit,
      emscripten: "4.0.9",
      patches: readdirSync(join(core, "patches")).filter((name) => /^\d{4}-.*\.patch$/.test(name)).length,
      luaFixedSeed: 0,
      ...(mode === "multi-domain" ? { applyDomain: 1, domainMulti } : {}),
      builderCommit: builtBy,
    }));
  }
  const git = (...args: string[]) => execFileSync("git", args, { cwd: work, stdio: "pipe" }).toString().trim();
  git("init", "-q");
  git("add", ".");
  git("-c", "user.name=Deploy test", "-c", "user.email=deploy-test@example.invalid", "commit", "-qm", "fixture");
  return { work, bundle, script, deployedBy: git("rev-parse", "HEAD") };
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("deploy multi core provenance", () => {
  it("records the exact builder checkout in both compiler build records", () => {
    const f = fixture();
    const scripts = join(f.work, "packages/duel-server/scripts");
    const builder = join(scripts, "build-deploy-multi-cores.sh");
    cpSync(join(root, "packages/duel-server/scripts/build-deploy-multi-cores.sh"), builder);
    const bin = join(f.work, "bin");
    mkdirSync(bin);
    // Simulate the compiler boundary only: no Docker daemon, pull or core compilation in this unit test.
    const docker = join(bin, "docker");
    writeFileSync(docker, `#!/bin/sh
if [ "$1" = pull ]; then exit 0; fi
for arg in "$@"; do
  case "$arg" in OUT_NAME=*) out_name=\${arg#OUT_NAME=} ;; esac
done
printf '{"luaFixedSeed":0,"head":"compiler-head"}\\n' > "packages/duel-server/domain-core/dist/\${out_name%.sync.wasm}-build-info.json"
`);
    chmodSync(docker, 0o755);
    const result = spawnSync("bash", [builder], {
      encoding: "utf8", env: { PATH: `${bin}:${process.env.PATH ?? ""}` },
    });
    expect(result.status, result.stderr).toBe(0);
    for (const mode of ["multi", "multi-domain"]) {
      const info = JSON.parse(readFileSync(join(f.work, `packages/duel-server/domain-core/dist/ocgcore.${mode}-build-info.json`), "utf8"));
      expect(info.builderCommit).toBe(f.deployedBy);
      expect(info.head).toBe("compiler-head");
      expect(info.luaFixedSeed).toBe(0);
    }
  });

  it("preserves the original builder on a cache hit and records the deploying checkout separately", () => {
    const f = fixture();
    const result = spawnSync(process.execPath, [f.script, f.bundle], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(f.deployedBy).not.toBe(builtBy);
    for (const stem of ["ocgcore.multi", "ocgcore.multi-domain"]) {
      const source = readFileSync(join(f.bundle, `${stem}.SOURCE`), "utf8");
      expect(source).toContain(`builtBy=${builtBy}\n`);
      expect(source).toContain(`deployedBy=${f.deployedBy}\n`);
    }
    expect(result.stdout).toContain(`builtBy=${builtBy}`);
    expect(result.stdout).toContain(`deployedBy=${f.deployedBy}`);
  });

  it.each([undefined, "not-a-commit", "2".repeat(39)])("refuses invalid builder provenance (%s) before copying any core", (commit) => {
    const f = fixture();
    // Remove provenance from the second core to check that validation is all-or-nothing.
    const infoPath = join(f.work, "packages/duel-server/domain-core/dist/ocgcore.multi-domain-build-info.json");
    const info = JSON.parse(readFileSync(infoPath, "utf8"));
    if (commit === undefined) delete info.builderCommit;
    else info.builderCommit = commit;
    writeFileSync(infoPath, JSON.stringify(info));
    const result = spawnSync(process.execPath, [f.script, f.bundle], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("builderCommit");
    expect(readdirSync(f.bundle)).toEqual([]);
  });
});
