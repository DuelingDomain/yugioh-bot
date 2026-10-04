import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const bundle = process.env.DUEL_DATA_DIR;
if (!bundle) throw new Error("DUEL_DATA_DIR required");
const dist = "packages/duel-server/domain-core/dist";
mkdirSync(dist, { recursive: true });
const manifestPath = join(bundle, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
// Preserve the serial build's manifest insertion order and its final (legacy) bundleVersion calculation.
for (const target of ["domain", "standard", "legacy-domain", "multi", "multi-domain", "multi-ref", "multi-ref-domain", "multi-trap"]) {
  const root = join(process.env.CI_CORE_OUTPUT ?? "ci-core", target);
  const fragment = JSON.parse(readFileSync(join(root, "bundle/manifest.json"), "utf8"));
  Object.assign(manifest.sources, fragment.sources);
  Object.assign(manifest.integrity, fragment.integrity);
  cpSync(join(root, "bundle"), bundle, { recursive: true, filter: (file) => !file.endsWith("/manifest.json") });
  if (existsSync(join(root, "dist"))) cpSync(join(root, "dist"), dist, { recursive: true });
}
manifest.bundleVersion = createHash("sha256").update(JSON.stringify({ sources: manifest.sources, integrity: manifest.integrity })).digest("hex");
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
