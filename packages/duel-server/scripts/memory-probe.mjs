import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { threadId } from "node:worker_threads";
import {
  getHeapStatistics,
  getHeapSpaceStatistics,
  writeHeapSnapshot,
} from "node:v8";
// Prevent even an attempted dotenv read from accessing a .env file.
const read = fs.readFileSync;
fs.readFileSync = function (path, ...args) {
  if (/(^|\/)\.env(?:\.[^/]*)?$/.test(String(path)))
    return args[0] ? "" : Buffer.alloc(0);
  return read.call(this, path, ...args);
};
syncBuiltinESMExports();
globalThis.memoryProbe = () => ({
  threadId,
  at: Date.now(),
  usage: process.memoryUsage(),
  heap: getHeapStatistics(),
  spaces: getHeapSpaceStatistics(),
});
globalThis.memorySnapshot = (path) => writeHeapSnapshot(path);
if (process.env.MEMORY_RUN) {
  const target = `${process.env.MEMORY_RUN}/thread-${threadId}.json`;
  const record = () => {
    fs.writeFileSync(
      `${target}.tmp`,
      JSON.stringify(globalThis.memoryProbe()),
    );
    fs.renameSync(`${target}.tmp`, target);
  };
  record();
  setInterval(record, 500).unref();
}
