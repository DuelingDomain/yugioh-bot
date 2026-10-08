/** Finalize the report after duel:prepare, using the exact prepared candidate bundle. */
import { readFile, writeFile, appendFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { boundedReport, withValidation, readProdScriptErrors, prodScriptErrorReport } from "./engine-data-report.js";
import { probeEngineData } from "./probe-engine-data.js";
import { loadCardDatabase } from "../src/cards.js";
import { loadMultiScriptsFor } from "../src/multi-scripts.js";
import { cardScriptHash } from "../src/card-script-hash.js";
import { loadCardPasscodeRemaps } from "@yugidraft/shared/db";

const artifact = resolve(process.env.UPDATE_ARTIFACT_DIR!);
const metadata = JSON.parse(await readFile(join(artifact, "update.json"), "utf8"));
const reportPath = join(artifact, "report.md");
let report = await readFile(reportPath, "utf8");
const prod = await readProdScriptErrors(join(artifact, "prod-script-errors.json"));
let prodSection = prodScriptErrorReport(prod);
if (process.env.DRY_RUN === "true") report = report.replace("Mode: update.", "Mode: workflow dry run (candidate applied only in the disposable checkout; no publication).");
if (metadata.changed) {
  const dataDirectory = process.env.DUEL_DATA_DIR;
  if (!dataDirectory) throw new Error("DUEL_DATA_DIR is required for candidate validation");
  const manifest = JSON.parse(await readFile(join(dataDirectory, "manifest.json"), "utf8"));
  for (const key of ["scripts", "database", "strings"]) {
    if (manifest.sources[key] !== metadata.next[key]) throw new Error(`Prepared ${key} pin differs from candidate`);
  }
  const probe = await probeEngineData(dataDirectory, metadata.changedPaths);
  // An incomplete scan must still publish its blocking findings without opening the invalid bundle again.
  if (!probe.artworkScriptScanError) {
    const cards = loadCardDatabase(dataDirectory), remaps = loadCardPasscodeRemaps(dataDirectory);
    prodSection = prodScriptErrorReport(prod, (code, kind, helperScripts) => cardScriptHash(cards, remaps.get(code) ?? code, kind, kind?.startsWith("multi-") ? loadMultiScriptsFor(dataDirectory, join(dataDirectory, "multi-scripts")) : undefined, helperScripts));
  }
  const overlayExit = Number(await readFile(join(artifact, "overlay-exit.txt"), "utf8"));
  if (!Number.isInteger(overlayExit) || overlayExit < 0) throw new Error("Invalid overlay check exit status");
  const overlayLog = await readFile(join(artifact, "overlay-check.log"), "utf8");
  report = withValidation(report, probe, overlayExit, overlayLog);
  // Write all review artifacts, then fail the job so publication cannot proceed.
  if (probe.artworkScriptScanError || probe.artworkScriptFallbacks?.length) process.exitCode = 1;
  report += "\n## Bundle validation\n\n`npm run duel:prepare` passed with the candidate pins in a temporary DUEL_DATA_DIR. The core probe above ran against this prepared bundle.\n";
  await writeFile(join(artifact, "probe.json"), JSON.stringify(probe, null, 2) + "\n");
}
report = report.replace(/## Script errors in prod \(last 7 days\)\n[\s\S]*?(?=\n## |$)/, prodSection);
await writeFile(reportPath, report);
const runUrl = `${process.env.GITHUB_SERVER_URL || "https://github.com"}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
await writeFile(join(artifact, "pr-body.md"), boundedReport(report, runUrl, 60_000));
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, boundedReport(report, runUrl, 1_000_000));
