import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { describe, expect, it, vi } from "vitest";
import { bridgeGate, buildBridgeJudgeEvidence, type ArchetypeBridge, type BridgeJudgeClient } from "@yugidraft/shared/cards/effects";
import { storedBridgeLegalIds } from "../../shared/dist/cards/effects/bridge-legality-store.js";
import { BridgeApi } from "../src/bridge-api.js";
import { DeckSuggestionWorkers } from "../src/deck-suggestion-workers.js";
import { seedIdentity } from "./helpers/identity.js";
import { writeBridgeDatabase, writeEffectDatabase } from "./helpers/bridge-worker-database.js";

describe("bridge engine cache and host isolation", () => {
  it("builds cold and revised legality sets in a scanner and retries a stale worker snapshot", async () => {
    const directory = mkdtempSync(join(tmpdir(), "bridge-worker-legality-"));
    const path = join(directory, "app.sqlite");
    writeBridgeDatabase(path);
    const db = new Database(path);
    db.pragma("journal_mode = WAL");
    const external = new Database(db.name);
    let calls = 0;
    const client: BridgeJudgeClient = { messages: { create: async request => {
      // A catalog import can change unrelated legality while a provider is pending.
      if (!calls++) external.prepare("UPDATE card_capability SET capabilities_json=json_set(capabilities_json,'$.card.banTcg',null) WHERE passcode=89631139").run();
      const evidence = JSON.parse(request.messages[0]!.content as string);
      return { id: `msg_legality_${calls}`, model: request.model, stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 50 },
        content: [{ type: "text", text: JSON.stringify({ verdict: "valid", grade: "good", pros: [], cons: [], lock_note: "",
          line: evidence.cards.slice(0, 3).map((card: { name: string }) => card.name), format_ok: true }) }] };
    } } };
    const workers = new DeckSuggestionWorkers(db, directory, 120_000, { client, env: {}, log: () => {} });
    const original = db.prepare.bind(db);
    const prepare = vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
      if (/FROM card_capability\s*(?:ORDER BY passcode)?\s*$/i.test(sql)) throw new Error("Global catalog scan on host");
      return original(sql);
    });
    const post = Worker.prototype.postMessage;
    let changed = false;
    const messages = vi.spyOn(Worker.prototype, "postMessage").mockImplementation(function (this: Worker, message, ...args) {
      if (message.kind === "bridge-legality" && !changed) {
        this.prependOnceListener("message", () => {
          changed = true;
          external.prepare("UPDATE card_capability SET capabilities_json=json_set(capabilities_json,'$.card.banTcg','Forbidden') WHERE passcode=89631139").run();
        });
      }
      return post.call(this, message, ...args);
    });
    try {
      const row = await workers.bridgeCandidates({ kind: "bridges", op: "explain", source: "Fire Formation", target: "Lunalight", format: "advanced" }) as ArchetypeBridge;
      const read = (state = "pending") => workers.withBridgeLegality("advanced", () => {
        expect(db.inTransaction).toBe(true);
        expect(bridgeGate(db, row).state).toBe(state);
        return storedBridgeLegalIds(db, "advanced");
      });
      const initial = await read();
      expect(changed).toBe(true);
      expect(initial.has(89631139)).toBe(false);
      expect(await read()).toBe(initial);
      expect(messages.mock.calls.filter(([scan]) => scan.kind === "bridge-legality")).toHaveLength(2);
      external.prepare("UPDATE card_capability SET capabilities_json=json_set(capabilities_json,'$.card.banTcg',null) WHERE passcode=89631139").run();
      const revised = await read();
      expect(revised).not.toBe(initial);
      expect(revised.has(89631139)).toBe(true);
      expect(messages.mock.calls.filter(([scan]) => scan.kind === "bridge-legality")).toHaveLength(3);
      // Initial and final judge gates both refresh legality off the host thread.
      external.prepare("UPDATE card_capability SET capabilities_json=json_set(capabilities_json,'$.card.banTcg','Forbidden') WHERE passcode=89631139").run();
      await workers.rateBridge(row);
      expect(calls).toBe(2);
      expect((await read("shown")).has(89631139)).toBe(true);
      expect(messages.mock.calls.filter(([scan]) => scan.kind === "bridge-legality")).toHaveLength(5);
      expect(prepare.mock.calls.some(([sql]) => /FROM card_capability\s*(?:ORDER BY passcode)?\s*$/i.test(sql))).toBe(false);
    } finally {
      messages.mockRestore(); prepare.mockRestore(); await workers.close();
      external.close(); db.close(); rmSync(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("keeps cold directed list projection and deep engine resolution out of the host catalog scan", async () => {
    const directory = mkdtempSync(join(tmpdir(), "bridge-cold-host-"));
    const path = join(directory, "app.sqlite");
    writeEffectDatabase(path);
    const db = new Database(path);
    const identity = seedIdentity(db), workers = new DeckSuggestionWorkers(db, directory);
    const api = new BridgeApi(db, workers);
    const original = db.prepare.bind(db);
    const prepare = vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
      if (/SELECT capabilities_json FROM card_capability ORDER BY passcode/i.test(sql)) throw new Error("Full bridge graph loaded on host");
      return original(sql);
    });
    const call = (bridgeRequest: Record<string, unknown>) => api.handle({ userId: identity.userId, bridgeRequest }, "g", identity.playerId);
    try {
      const stored = db.prepare("SELECT bridge_json FROM archetype_bridge WHERE source='Odion' AND target='Blue-Eyes' AND format='advanced'").get() as { bridge_json: string };
      const niche = JSON.parse(stored.bridge_json) as ArchetypeBridge;
      expect(buildBridgeJudgeEvidence(db, niche)).not.toBeNull();
      expect(bridgeGate(db, niche).state).toBe("pending");
      await expect(call({ op: "between", source: "Odion", target: "Argostars" })).resolves.toHaveProperty("results");
      await expect(call({ op: "from", source: "Odion" })).resolves.toHaveProperty("results");
      // Joining an absent job resolves explicit engines without starting any paid work.
      await expect(call({ op: "start", engines: ["Odion"], join: true })).rejects.toMatchObject({ status: 404 });
    } finally { prepare.mockRestore(); await api.jobs.close(); await workers.close(); db.close(); rmSync(directory, { recursive: true, force: true }); }
  }, 20_000);

  it("projects directed deep results and next engines in one worker request within the status deadline", async () => {
    const directory = mkdtempSync(join(tmpdir(), "bridge-status-budget-"));
    const path = join(directory, "app.sqlite");
    writeBridgeDatabase(path);
    const db = new Database(path);
    const identity = seedIdentity(db), workers = new DeckSuggestionWorkers(db, directory);
    vi.spyOn(workers, "bridgeCandidates").mockResolvedValue([]);
    let now = Date.now();
    const api = new BridgeApi(db, workers, () => now);
    const messages = vi.spyOn(Worker.prototype, "postMessage");
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const call = (bridgeRequest: Record<string, unknown>) => api.handle({ userId: identity.userId, bridgeRequest }, "g", identity.playerId);
    try {
      const started = await call({ op: "start", source: "Temple of the Kings" }) as { jobId: string };
      await api.jobs.close();
      messages.mockClear();
      const status = () => call({ op: "status", jobId: started.jobId });
      await expect(status()).resolves.toMatchObject({ state: "done", results: [], next: [] });
      expect(messages.mock.calls.map(([scan]) => (scan as { kind: string }).kind)).toEqual(["bridge-directed-projection"]);
      now += 6000; // Expire the completed projection cache.
      // A scanner that stops answering must release the caller's status slot
      // before the web's five-second read deadline, including this combined work.
      messages.mockImplementation(() => {});
      vi.useFakeTimers({ shouldClearNativeTimers: true });
      const rejectedBeforeWebDeadline = expect(Promise.race([status(), new Promise((_, reject) => {
        deadline = setTimeout(() => reject(new Error("Status exceeded its five-second web deadline")), 5000);
      })])).rejects.toMatchObject({ status: 503 });
      await vi.advanceTimersByTimeAsync(5000);
      await rejectedBeforeWebDeadline;
    } finally {
      clearTimeout(deadline); vi.useRealTimers(); messages.mockRestore();
      await api.jobs.close(); await workers.close(); db.close(); rmSync(directory, { recursive: true, force: true });
    }
  }, 20_000);
});
