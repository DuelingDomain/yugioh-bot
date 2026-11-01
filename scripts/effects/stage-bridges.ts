import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { BRIDGE_FILES } from "../ci/bridge-artifacts.mjs";
import { bridgeHash } from "@yugidraft/shared/cards/effects";

const root = resolve(import.meta.dirname, "../.."), args = process.argv.slice(2);
const output = args[args.indexOf("--output") + 1], kind = args[args.indexOf("--kind") + 1];
if (!args.includes("--output") || !["effects", "engine"].includes(kind)) throw new Error("Pass --output DIRECTORY --kind effects|engine");
const path = join(output, "update.json"), candidate = JSON.parse(readFileSync(path, "utf8"));
if (candidate.changed) {
  const bytes = readFileSync(join(root, "packages/shared/data/effects/bridges-manifest.json"));
  const manifest = JSON.parse(bytes.toString("utf8"));
  candidate.bridge = { files: BRIDGE_FILES, version: manifest.version, manifest_sha256: bridgeHash(bytes.toString("utf8")) };
  for (const file of BRIDGE_FILES) {
    mkdirSync(dirname(join(output, file)), { recursive: true }); copyFileSync(join(root, file), join(output, file));
  }
  if (kind === "engine") candidate.files = [...new Set([...candidate.files, ...BRIDGE_FILES.filter((file: string) => execFileSync("git", ["diff", "--numstat", "--", file], { cwd: root, encoding: "utf8" }).trim())])];
  const reportPath = join(output, "report.md"), report = readFileSync(reportPath, "utf8").split("\n\n## Archetype bridges\n")[0];
  writeFileSync(reportPath, `${report}\n\n## Archetype bridges\n\nRebuilt ${manifest.files.advanced.records} Advanced and ${manifest.files.genesys.records} Genesys directed candidates from ${manifest.files.capabilities.records} engine identities. All rows passed deterministic validation; engine verification and paid judgements remain pending.\n\nEvidence version: \`${manifest.version}\`.\n`);
  writeFileSync(path, JSON.stringify(candidate, null, 2) + "\n");
}
