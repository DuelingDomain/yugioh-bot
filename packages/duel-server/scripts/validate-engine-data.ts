/** Finalize the report after duel:prepare, using the exact prepared candidate bundle. */
import { createHash } from "node:crypto";
import { readFile, writeFile, appendFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { boundedReport, withValidation, withPrereleaseSmoke } from "./engine-data-report.js";
import { withPreviewExclusions, withCardUpdate } from "./engine-data-card-report.js";
import { probeEngineData } from "./probe-engine-data.js";

const artifact = resolve(process.env.UPDATE_ARTIFACT_DIR!);
const metadata = JSON.parse(await readFile(join(artifact, "update.json"), "utf8"));
const reportPath = join(artifact, "report.md");
let report = await readFile(reportPath, "utf8");
if (process.env.DRY_RUN === "true") report = report.replace("Mode: update.", "Mode: workflow dry run (candidate applied only in the disposable checkout; no publication).");
if (metadata.changed) {
  const dataDirectory = process.env.DUEL_DATA_DIR;
  if (!dataDirectory) throw new Error("DUEL_DATA_DIR is required for candidate validation");
  const manifest = JSON.parse(await readFile(join(dataDirectory, "manifest.json"), "utf8"));
  for (const key of ["scripts", "database", "strings"]) {
    if (manifest.sources[key] !== metadata.next[key]) throw new Error(`Prepared ${key} pin differs from candidate`);
  }
  if (manifest.sources.databaseFormat === "official-releases-prerelease-v4") {
    const remapBytes = await readFile(join(dataDirectory, "card-remaps.json"));
    if (createHash("sha256").update(remapBytes).digest("hex") !== manifest.integrity?.cardRemaps) throw new Error("Prepared card-remaps.json integrity mismatch");
    const artifact = JSON.parse(remapBytes.toString("utf8"));
    if (!artifact.scriptSmoke) throw new Error("Prepared prerelease script smoke results missing");
    report = withPrereleaseSmoke(report, artifact.scriptSmoke);
    if (metadata.cardChanges) report = withCardUpdate(report,
      withPreviewExclusions(metadata.cardChanges, artifact.scriptSmoke.excluded.map((card: { code: number }) => card.code)));
  }
  const probe = await probeEngineData(dataDirectory, metadata.changedPaths);
  const overlayExit = Number(await readFile(join(artifact, "overlay-exit.txt"), "utf8"));
  if (!Number.isInteger(overlayExit) || overlayExit < 0) throw new Error("Invalid overlay check exit status");
  const overlayLog = await readFile(join(artifact, "overlay-check.log"), "utf8");
  report = withValidation(report, probe, overlayExit, overlayLog);
  // Write all review artifacts, then fail the job so publication cannot proceed.
  if (probe.artworkScriptScanError || probe.artworkScriptFallbacks?.length) process.exitCode = 1;
  report += "\n## Bundle validation\n\n`npm run duel:prepare` passed with the candidate pins in a temporary DUEL_DATA_DIR. The core probe above ran against this prepared bundle.\n";
  await writeFile(join(artifact, "probe.json"), JSON.stringify(probe, null, 2) + "\n");
}
await writeFile(reportPath, report);
const runUrl = `${process.env.GITHUB_SERVER_URL || "https://github.com"}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
await writeFile(join(artifact, "pr-body.md"), boundedReport(report, runUrl, 60_000));
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, boundedReport(report, runUrl, 1_000_000));
