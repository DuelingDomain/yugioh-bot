import { once } from "node:events";
import { Worker } from "node:worker_threads";
import { expect, it } from "vitest";

it("runs the inherited instrument preload in a real worker without loading the Sentry SDK", async () => {
  const instrument = new URL("../src/instrument.ts", import.meta.url).href;
  const worker = new Worker(`
    const { parentPort } = require('node:worker_threads');
    const { registerHooks } = require('node:module');
    import('tsx/esm/api').then(async ({ tsImport }) => {
      registerHooks({ resolve(specifier, context, next) {
        if (specifier.startsWith('@sentry/')) throw new Error('Sentry SDK loaded in a worker');
        return next(specifier, context);
      } });
      await tsImport(${JSON.stringify(instrument)}, ${JSON.stringify(import.meta.url)});
      parentPort.postMessage('ready');
    });
  `, { eval: true, execArgv: [] });
  try { expect(await once(worker, "message")).toEqual(["ready"]); }
  finally { await worker.terminate(); }
});
