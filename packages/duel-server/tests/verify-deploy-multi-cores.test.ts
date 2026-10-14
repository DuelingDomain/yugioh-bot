import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, cpSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, it } from "vitest";

it("verifies installed multi cores through the authenticated duel host", () => {
  const root = mkdtempSync(join(import.meta.dirname, ".verify-deploy-"));
  try {
    const dataDirectory = join(root, "data");
    mkdirSync(join(dataDirectory, "card-scripts"), { recursive: true });
    // An empty WASM module is valid; this check reads capabilities without starting a game.
    const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
    const sha = createHash("sha256").update(wasm).digest("hex");
    for (const stem of ["ocgcore.standard", "ocgcore.domain", "ocgcore.multi", "ocgcore.multi-domain"]) {
      writeFileSync(join(dataDirectory, `${stem}.wasm`), wasm);
      writeFileSync(join(dataDirectory, `${stem}.sha256`), `${sha}\n`);
    }
    writeFileSync(join(dataDirectory, "manifest.json"), JSON.stringify({ bundleVersion: "test", sources: {} }));
    const cards = new Database(join(dataDirectory, "cards.cdb"));
    cards.exec("create table datas (id integer primary key, alias integer, type integer); create table texts (id integer primary key, name text)");
    cards.close();

    // Run the unchanged script with source modules so the unit suite needs no duel build or engine bundle.
    mkdirSync(join(root, "scripts"));
    const script = join(root, "scripts", "verify-deploy-multi-cores.mjs");
    cpSync(join(import.meta.dirname, "..", "scripts", "verify-deploy-multi-cores.mjs"), script);
    symlinkSync(join(import.meta.dirname, "..", "src"), join(root, "dist"), "dir");
    const outputPath = join(root, "verify.log");
    const output = openSync(outputPath, "w");
    try {
      const run = spawnSync(process.execPath, ["--import", "tsx", script], {
        stdio: ["ignore", output, output], timeout: 15000,
        env: { ...process.env, DUEL_DATA_DIR: dataDirectory, DUEL_1V1_ENGINE: "pinned" },
      });
      const log = readFileSync(outputPath, "utf8");
      expect(run.error).toBeUndefined();
      expect(run.status, log).toBe(0);
      expect(log).toContain("multiCoreAvailable=true multiDomainCoreReady=true");
    } finally {
      closeSync(output);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
