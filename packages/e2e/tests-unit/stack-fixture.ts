import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

/** A tiny isolated checkout: real stack scripts, fake npm, no live services or secrets. */
export function stackFixture() {
  const root = mkdtempSync(resolve(tmpdir(), "e2e-stack-fixture-"));
  const at = (path: string) => resolve(root, path);
  const put = (path: string, bytes: string) => {
    const file = at(path);
    mkdirSync(resolve(file, ".."), { recursive: true });
    writeFileSync(file, bytes);
    utimesSync(file, 1, 1);
  };
  mkdirSync(at("packages/e2e/stack"), { recursive: true });
  for (const name of readdirSync(new URL("../stack/", import.meta.url))) {
    if (name.endsWith(".mjs")) copyFileSync(new URL(`../stack/${name}`, import.meta.url), at(`packages/e2e/stack/${name}`));
  }
  put("package.json", '{"type":"module"}');
  put("tsconfig.json", "{}");
  for (const name of ["shared", "ws", "duel-server", "worker"]) {
    put(`packages/${name}/src/${name === "worker" ? "index" : "server"}.ts`, "source");
    put(`packages/${name}/package.json`, "{}");
    put(`packages/${name}/tsconfig.json`, "{}");
    put(`packages/${name}/tsconfig.build.json`, "{}");
    put(`packages/${name}/dist/${name === "shared" ? "services/index.js" : name === "worker" ? "index.js" : "server.js"}`, "compiled");
  }
  // Service outputs are newer than shared outputs, and all inputs are older.
  utimesSync(at("packages/shared/dist/services/index.js"), 2, 2);
  utimesSync(at("packages/shared/dist/services"), 2, 2);
  utimesSync(at("packages/shared/dist"), 2, 2);
  for (const [name, entry] of [["ws", "server.js"], ["duel-server", "server.js"], ["worker", "index.js"]]) utimesSync(at(`packages/${name}/dist/${entry}`), 3, 3);
  put("packages/web/next-env.d.ts", "original Next types");
  put("packages/web/tsconfig.json", "original config");
  put("bin/npm", `#!${process.execPath}
    import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
    import { resolve } from 'node:path';
    import { spawn } from 'node:child_process';
    const root = process.cwd();
    appendFileSync(resolve(root, 'commands.jsonl'), JSON.stringify(process.argv.slice(2)) + '\\n');
    if (process.argv.includes('--workspace=packages/web') && !process.argv.includes('package:standalone')) {
      writeFileSync(resolve(root, 'packages/web/next-env.d.ts'), 'Next changed types');
      writeFileSync(resolve(root, 'packages/web/tsconfig.json'), 'Next changed config');
      writeFileSync(resolve(root, 'build-started'), String(process.pid));
      if (process.env.FIXTURE_BLOCK_BUILD === '1') {
        const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });
        writeFileSync(resolve(root, 'build-child.pid'), String(child.pid));
        setInterval(() => {}, 1000);
      } else {
        const output = resolve(root, 'packages/web', process.env.E2E_NEXT_DIST_DIR || '.next', 'standalone/packages/web');
        mkdirSync(output, { recursive: true });
        writeFileSync(resolve(output, 'server.js'), 'server');
      }
    }
  `);
  chmodSync(at("bin/npm"), 0o755);
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("E2E_")) delete env[key];
  return {
    root, at,
    env: { ...env, PATH: `${at("bin")}:${process.env.PATH}`, E2E_SLOT: "2", E2E_WEB_PORT: "0", E2E_WS_PORT: "0", E2E_WS_INTERNAL_PORT: "0", E2E_DUEL_PORT: "0" },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
