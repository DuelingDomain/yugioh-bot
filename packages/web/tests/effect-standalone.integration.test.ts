import Database from "better-sqlite3";
import { migrate } from "../../shared/src/db/schema";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const exec = promisify(execFile);

it.skipIf(!process.env.EFFECT_STANDALONE_DIR)("initializes a cold seed from an isolated standalone copy, including native SQLite and child dependencies", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-standalone-"));
  try {
    await cp(resolve(process.env.EFFECT_STANDALONE_DIR!), directory, { recursive: true, verbatimSymlinks: true });
    // Create the disk fixture with the normal migrations before starting the
    // isolated runtime. The helper does not need the public DB barrel shipped.
    const fixture = new Database(join(directory, "probe.sqlite"));
    try { migrate(fixture); } finally { fixture.close(); }
    const script = `
      (async () => {
        const root = process.argv[1];
        for (const module of ['@yugidraft/shared/services/cube-seed-index', 'zod', 'better-sqlite3']) {
          if (!require.resolve(module).startsWith(root + '/')) throw new Error('Dependency escaped standalone: ' + module);
        }
        const Database = require('better-sqlite3');
        const {initializeCubeSeedIndex} = await import('@yugidraft/shared/services/cube-seed-index');
        const db = new Database(require('node:path').join(root, 'probe.sqlite'));
        try {
          db.prepare(\`INSERT INTO card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
            VALUES(46986414,'Dark Magician','Normal Monster','normal','i','s','[]',CURRENT_TIMESTAMP)\`).run();
          const first = initializeCubeSeedIndex(db), second = initializeCubeSeedIndex(db);
          if (first !== second) throw new Error('Concurrent cold preparation was not shared');
          const index = await first;
          if (index.candidates[0]?.card.id !== 46986414) throw new Error('Missing prepared candidate');
          console.log('standalone-seed-ready');
        } finally { db.close(); }
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `;
    const result = await exec(process.execPath, ["-e", script, directory], {
      cwd: join(directory, "packages/web"),
      env: { PATH: process.env.PATH, NODE_ENV: "production", DUEL_DATA_DIR: join(directory, "missing-engine") },
      timeout: 30_000,
    });
    expect(result.stdout).toContain("standalone-seed-ready");
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 60_000);
