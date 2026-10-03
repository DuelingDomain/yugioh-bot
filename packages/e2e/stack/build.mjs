import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { isProcessAlive, readPid } from "./pid.mjs";

/** Latest input mtime, ignoring generated Next output and dependencies. */
export function newest(paths) {
  let latest = 0;
  const walk = (path) => {
    if (!existsSync(path)) return;
    const info = statSync(path);
    if (info.isDirectory()) {
      for (const entry of readdirSync(path)) {
        if (entry !== "node_modules" && !entry.startsWith(".next")) walk(`${path}/${entry}`);
      }
    } else latest = Math.max(latest, info.mtimeMs);
  };
  paths.forEach(walk);
  return latest;
}

export function isBuildFresh(output, inputs) {
  return existsSync(output) && statSync(output).mtimeMs >= newest(inputs);
}

/** Next also writes next-env.d.ts and tsconfig.json: serialize web builds across slots. */
export async function withBuildLock(directory, build, { signal } = {}) {
  const deadline = Date.now() + 10 * 60_000;
  let waiting = false;
  let ownedDirectory;
  for (;;) {
    signal?.throwIfAborted();
    try {
      mkdirSync(directory);
      ownedDirectory = statSync(directory);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const pid = readPid(`${directory}/pid`);
      if (pid !== undefined && !isProcessAlive(pid)) {
        // Serialize recovery itself. Otherwise a second stale waiter can remove a newly
        // acquired live lock between the PID recheck and recursive removal. A dead
        // recovery holder is handled by the same protocol in another sibling lock.
        // Keep coordination outside the tree removed by recovery or normal release.
        try {
          await withBuildLock(`${directory}.recovery`, () => {
            if (readPid(`${directory}/pid`) === pid && !isProcessAlive(pid)) {
              // Detach the whole directory atomically before deleting it. Waiters can
              // then acquire a new lock without recreating entries inside our removal.
              const abandoned = `${directory}.stale-${process.pid}-${randomUUID()}`;
              renameSync(directory, abandoned);
              rmSync(abandoned, { recursive: true, force: true });
            }
          }, { signal });
        } catch (error) {
          if (error.code !== "ENOENT") throw error; // Another recovery already removed the lock.
        }
        continue;
      }
      if (pid === undefined && Date.now() >= deadline) throw new Error(`Timed out waiting for web build lock ${directory} without a holder pid. Check for a running build before removing the lock.`);
      if (!waiting) console.log("[e2e:prepare] waiting for another web build");
      waiting = true;
      await delay(100, undefined, { signal });
    }
  }
  try {
    writeFileSync(`${directory}/pid`, String(process.pid));
    return await build();
  } finally {
    // Never remove a replacement owner's lock if this directory was recovered.
    try {
      const current = statSync(directory);
      const pid = readPid(`${directory}/pid`);
      if (current.dev === ownedDirectory.dev && current.ino === ownedDirectory.ino && (pid === undefined || pid === process.pid)) {
        rmSync(directory, { recursive: true, force: true });
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

/** Slot builds must leave the worktree's tracked Next/TypeScript configuration unchanged. */
export async function withPreservedFiles(files, build) {
  const before = files.map((file) => existsSync(file) ? { bytes: readFileSync(file), info: statSync(file) } : null);
  try {
    return await build();
  } finally {
    files.forEach((file, index) => {
      if (before[index] === null) rmSync(file, { force: true });
      else {
        if (!existsSync(file) || !readFileSync(file).equals(before[index].bytes)) writeFileSync(file, before[index].bytes);
        if (statSync(file).mtimeMs !== before[index].info.mtimeMs) utimesSync(file, before[index].info.atime, before[index].info.mtime);
      }
    });
  }
}
