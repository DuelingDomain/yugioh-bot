import { once } from "node:events";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import { expect } from "vitest";

// A separate thread must release the real file lock while better-sqlite3 blocks
// this thread. The timer starts only when the caller is about to attempt startup.
export async function holdStartupWrite(path: string) {
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    const Database = require(workerData.sqlite);
    const db = new Database(workerData.path);
    db.exec('begin immediate');
    db.prepare('insert or replace into worker_heartbeat(id, at, pid) values (1, ?, ?)').run(Date.now(), process.pid);
    parentPort.once('message', delay => setTimeout(() => {
      db.exec('commit'); db.close(); parentPort.postMessage('released'); parentPort.close();
    }, delay));
    parentPort.postMessage('locked');
  `, { eval: true, workerData: { path, sqlite: createRequire(import.meta.url).resolve("better-sqlite3") } });
  try { expect((await once(worker, "message"))[0]).toBe("locked"); }
  catch (error) { await worker.terminate(); throw error; }
  return worker;
}
