import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function changedLayers(files, event) {
  if (event !== "pull_request") return { engine: true, web_engine: true, tests_only: false };
  // Retain main's reviewed PR exemptions. Unknown shared paths still require the engine.
  const nonEngine = /^(packages\/shared\/(tests\/|scripts\/README\.md$|src\/maintenance\/repair-ratings\.ts$|src\/services\/(bug-reports|card-images|cubes|deal|draft-access|draft-decks|draft-tournament|drafts|guild-settings|live-now|players|tournament-registrations)\.ts$)|scripts\/(seed\.ts$|generate-draft-catalog-snapshot\.ts$|data\/draft-catalog-legendary\.json$))/;
  const engine = files.some((file) => !nonEngine.test(file) && /^(packages\/(duel-server|shared|e2e)\/|patches\/|scripts\/|\.github\/workflows\/test\.yml$|package(-lock)?\.json$|turbo\.json$|tsconfig[^/]*\.json$|\.nvmrc$)/.test(file));
  const web_engine = engine || files.some((file) => /^packages\/web\/(src\/components\/(duel|ui)\/|src\/lib\/utils\.ts$|e2e\/|tests\/|package\.json$|vitest\.config\.ts$|tsconfig[^/]*\.json$)/.test(file));
  const tests_only = files.length > 0 && files.every((file) => file.startsWith("packages/duel-server/tests/"));
  return { engine, web_engine, tests_only };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = process.env.EVENT;
  const files = event === "pull_request"
    ? execFileSync("git", ["diff", "--name-only", "--no-renames", "-z", `${process.env.BASE}...${process.env.HEAD}`], { encoding: "utf8" }).split("\0").filter(Boolean)
    : [];
  console.log(files.join("\n"));
  const outputs = { ...changedLayers(files, event), base: process.env.BASE ?? "", head: process.env.HEAD ?? "" };
  for (const [key, value] of Object.entries(outputs)) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}
