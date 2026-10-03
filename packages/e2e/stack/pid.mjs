import { readFileSync } from "node:fs";

export function readPid(file) {
  try {
    const value = readFileSync(file, "utf8").trim();
    const pid = Number(value);
    return /^[1-9]\d*$/.test(value) && Number.isSafeInteger(pid) ? pid : undefined;
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

export function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    if (error.code === "EPERM") return true;
    throw error;
  }
}
