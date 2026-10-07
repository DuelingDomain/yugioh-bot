import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import createCore, { OcgDuelMode, OcgLocation, OcgLogType, OcgPosition, OcgType, type OcgDuelHandle } from "ocgcore-wasm";
import { isOptionalCardScript, loadCardDatabase } from "../src/cards.js";

export interface PrereleaseScriptExclusion { code: number; errors: string[] }
export interface PrereleaseSmokeResult { checked: number; excluded: PrereleaseScriptExclusion[] }
type Message = { kind: "active"; code: number } | { kind: "checked"; code: number; errors: string[] } | { kind: "done" } | { kind: "fatal"; error: string };
const detail = (error: unknown) => error instanceof Error ? error.message : String(error);

async function smokeInProcess(directory: string, codes: number[]): Promise<void> {
  const cards = loadCardDatabase(directory);
  try {
    for (const code of codes) if (!cards.get(code)?.prerelease) throw new Error(`Card ${code} is not a retained prerelease card`);
    const core = await createCore({ sync: true }); // Oldest installed production Standard core.
    const team = { startingLP: 8000, startingDrawCount: 0, drawCountPerTurn: 0 };
    let errors: string[] = [];
    const initialize = (): OcgDuelHandle => {
      errors = [];
      const duel = core.createDuel({ flags: OcgDuelMode.MODE_MR5, seed: [1n, 2n, 3n, 4n], team1: team, team2: team,
        cardReader: code => cards.cardData(code),
        scriptReader: name => {
          const source = cards.readScript(name);
          if (source === null && !isOptionalCardScript(name, cards.cardData)) errors.push(`Missing script ${name}`);
          return source;
        },
        errorHandler: (type, text) => { if (type === OcgLogType.ERROR || type === OcgLogType.UNDEFINED) errors.push(text); },
      });
      if (!duel) throw new Error("Failed to create prerelease smoke duel");
      try {
        for (const name of ["constant.lua", "utility.lua"]) {
          const source = cards.readScript(name);
          if (source === null || !core.loadScript(duel, name, source) || errors.length) throw new Error(`Prerelease smoke infrastructure: ${name}: ${errors.join("; ") || "missing/failed helper"}`);
        }
        return duel;
      } catch (error) { core.destroyDuel(duel); throw error; }
    };
    // Fresh duel per card prevents an earlier broken script from poisoning other
    // cards' helpers/tables or cached script loads. Infrastructure precedes active.
    for (const code of codes) {
      const duel = initialize();
      process.send?.({ kind: "active", code } satisfies Message);
      try {
        const data = cards.cardData(code)!;
        const extra = (data.type & (OcgType.FUSION | OcgType.SYNCHRO | OcgType.XYZ | OcgType.LINK)) !== 0;
        core.duelNewCard(duel, { code, team: 0, duelist: 0, controller: 0, location: extra ? OcgLocation.EXTRA : OcgLocation.DECK, sequence: 0, position: OcgPosition.FACEDOWN_DEFENSE });
      } catch (error) { errors.push(detail(error)); }
      finally { core.destroyDuel(duel); }
      process.send?.({ kind: "checked", code, errors: [...new Set(errors)] } satisfies Message);
    }
    process.send?.({ kind: "done" } satisfies Message);
  } finally { cards.close(); }
}

/** Register previews natively (load + initial_effect only). A timed-out or crashed
 * card is isolated and excluded; missing core/helpers/IPC abort preparation. */
export async function smokePrereleaseScripts(directory: string, codes: number[], options: { timeoutMs?: number } = {}): Promise<PrereleaseSmokeResult> {
  const remaining = [...new Set(codes)].sort((a, b) => a - b);
  const result: PrereleaseSmokeResult = { checked: 0, excluded: [] };
  while (remaining.length) {
    await new Promise<void>((resolveBatch, reject) => {
      const child = fork(fileURLToPath(import.meta.url), ["--prerelease-smoke-worker"], {
        execArgv: ["--import", "tsx"], stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      let active: number | undefined, finished = false, diagnostics = "";
      const timeoutMs = options.timeoutMs ?? 5_000;
      const finish = (error?: Error) => {
        if (finished) return;
        finished = true; clearTimeout(timer); child.kill("SIGKILL");
        if (error) reject(error); else resolveBatch();
      };
      const failed = (message: string) => {
        if (active === undefined) { finish(new Error(`Prerelease smoke infrastructure: ${message}`)); return; }
        result.checked++; result.excluded.push({ code: active, errors: [message] });
        remaining.splice(remaining.indexOf(active), 1);
        finish(); // Restart only the untested cards after an attributable failure.
      };
      const timer = setTimeout(() => failed(`Script load/initial_effect timed out after ${timeoutMs}ms`), timeoutMs);
      const restartTimer = () => { timer.refresh(); };
      child.stdout?.resume();
      child.stderr?.on("data", (chunk: Buffer) => { diagnostics = (diagnostics + chunk.toString()).slice(-4_000); });
      child.once("error", error => finish(new Error(`Prerelease smoke process: ${error.message}`)));
      child.once("exit", (code, signal) => { if (!finished) failed(`Smoke worker exited (${signal ?? code})${diagnostics ? `: ${diagnostics.trim()}` : ""}`); });
      child.on("message", (message: Message) => {
        if (finished) return;
        if (message.kind === "fatal") { finish(new Error(message.error)); return; }
        if (message.kind === "active") {
          if (message.code !== remaining[0] || active !== undefined) { finish(new Error("Invalid prerelease smoke progress")); return; }
          active = message.code; restartTimer();
        } else if (message.kind === "checked") {
          if (message.code !== active) { finish(new Error("Invalid prerelease smoke result")); return; }
          result.checked++; if (message.errors.length) result.excluded.push({ code: message.code, errors: message.errors });
          remaining.shift(); active = undefined; restartTimer();
        } else if (message.kind === "done") {
          finish(remaining.length ? new Error("Incomplete prerelease smoke result") : undefined);
        }
      });
      child.send({ directory: resolve(directory), codes: [...remaining] }, error => { if (error) finish(error); });
    });
  }
  return result;
}

if (process.argv[2] === "--prerelease-smoke-worker" && process.send) {
  process.once("message", async ({ directory, codes }: { directory: string; codes: number[] }) => {
    try { await smokeInProcess(directory, codes); }
    catch (error) { process.send?.({ kind: "fatal", error: detail(error) } satisfies Message); }
    process.disconnect?.();
  });
}
