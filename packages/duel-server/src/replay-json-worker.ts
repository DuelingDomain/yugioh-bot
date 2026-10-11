import { parentPort } from "node:worker_threads";

// A view can contain large hands/graveyards. JSON conversion never runs on the live host thread.
parentPort!.on("message", ({ id, view }) => {
  try {
    const json = JSON.stringify(view);
    parentPort!.postMessage({ id, json, bytes: Buffer.byteLength(json) });
  } catch { parentPort!.postMessage({ id, error: true }); }
});
