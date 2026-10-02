import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";

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
export async function withBuildLock(directory, build) {
  const deadline = Date.now() + 10 * 60_000;
  let waiting = false;
  for (;;) {
    try {
      mkdirSync(directory);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for web build lock ${directory}. Check for a running build before removing a stale lock.`);
      if (!waiting) console.log("[e2e:prepare] waiting for another web build");
      waiting = true;
      await new Promise((done) => setTimeout(done, 100));
    }
  }
  try {
    writeFileSync(`${directory}/pid`, String(process.pid));
    return await build();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Slot builds must leave the worktree's tracked Next/TypeScript configuration unchanged. */
export async function withPreservedFiles(files, build) {
  const before = files.map((file) => existsSync(file) ? readFileSync(file) : null);
  try {
    return await build();
  } finally {
    files.forEach((file, index) => {
      if (before[index] === null) rmSync(file, { force: true });
      else if (!existsSync(file) || !readFileSync(file).equals(before[index])) writeFileSync(file, before[index]);
    });
  }
}
