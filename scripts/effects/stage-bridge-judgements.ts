import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { BRIDGE_JUDGEMENT_FILE } from "../ci/bridge-judgements.mjs";

const root = resolve(import.meta.dirname, "../.."), args = process.argv.slice(2), index = args.indexOf("--output");
if (index < 0 || !args[index + 1]) throw new Error("Pass --output DIRECTORY");
const output = resolve(args[index + 1]!), path = join(output, "update.json"), candidate = JSON.parse(readFileSync(path, "utf8"));
const before = execFileSync("git", ["show", `HEAD:${BRIDGE_JUDGEMENT_FILE}`], { cwd: root, maxBuffer: 30_000_000 }), after = readFileSync(join(root, BRIDGE_JUDGEMENT_FILE));
if (!before.equals(after)) {
  const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  candidate.bridgeJudgements = { files: [BRIDGE_JUDGEMENT_FILE], base_sha256: sha(before), sha256: sha(after), records: gunzipSync(after, { maxOutputLength: 150_000_000 }).toString("utf8").split("\n").filter(Boolean).length };
  mkdirSync(dirname(join(output, BRIDGE_JUDGEMENT_FILE)), { recursive: true }); copyFileSync(join(root, BRIDGE_JUDGEMENT_FILE), join(output, BRIDGE_JUDGEMENT_FILE));
  candidate.changed = true; writeFileSync(path, JSON.stringify(candidate, null, 2) + "\n");
}
const report = readFileSync(join(output, "report.md"), "utf8").split("\n\n## Bridge judging\n")[0];
writeFileSync(join(output, "report.md"), `${report}\n\n${readFileSync(join(output, "bridge-judge-report.md"), "utf8")}`);
