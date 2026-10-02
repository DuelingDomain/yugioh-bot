import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot, stackDir } from "./env.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function verifyInstalledWrapper() {
  // Do not bless a corrupt or arbitrary installed wrapper by changing its manifest hash.
  const checked = spawnSync("git", ["apply", "--reverse", "--check", "patches/ocgcore-wasm+0.1.2.patch"], {
    cwd: repoRoot, encoding: "utf8",
  });
  if (checked.status !== 0) throw new Error("Installed ocgcore-wasm does not match the checked-in patch. Reinstall that dependency and apply the patch before starting the manual stack.");
}

/**
 * The engine worktree may record a different wrapper from the merged UI branch. Keep the copied cores immutable;
 * derive only a local manifest, following prepare-data.ts's bundleVersion algorithm. Normal E2E is unchanged.
 * @param {string} sourceDirectory
 * @param {{ outputDirectory?: string, wrapperPath?: string, verifyWrapper?: () => void }} [options]
 */
export function prepareManualData(sourceDirectory, {
  outputDirectory = resolve(stackDir, "manual-duel-data"),
  wrapperPath = fileURLToPath(import.meta.resolve("ocgcore-wasm")),
  verifyWrapper = verifyInstalledWrapper,
} = {}) {
  const source = realpathSync(sourceDirectory);
  const manifest = JSON.parse(readFileSync(join(source, "manifest.json"), "utf8"));
  const wrapperHash = hash(readFileSync(wrapperPath));
  if (manifest.integrity?.wrapper === wrapperHash) return source;
  verifyWrapper();
  const output = resolve(outputDirectory);
  if (source === output || source.startsWith(output + sep)) throw new Error("Manual runtime directory must not contain the core snapshot.");
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  for (const entry of readdirSync(source)) {
    if (entry !== "manifest.json") symlinkSync(join(source, entry), join(output, entry));
  }
  manifest.integrity = { ...manifest.integrity, wrapper: wrapperHash };
  const { multiScripts: _overlay, ...engine } = manifest.integrity;
  manifest.bundleVersion = hash(JSON.stringify({ sources: manifest.sources, integrity: engine }));
  writeFileSync(join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log("[e2e:manual] pinned runtime manifest to the checked-in wrapper; snapshot cores unchanged");
  return output;
}
