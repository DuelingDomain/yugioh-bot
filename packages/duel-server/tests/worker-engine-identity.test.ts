import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getCurrentEngineResources } from "../src/engine-resource-resolver.js";
import { handleWorkerRequest } from "../src/worker.js";
import { GameWorker } from "../src/worker-client.js";

const { create, legacyCreate } = vi.hoisted(() => ({ create: vi.fn(), legacyCreate: vi.fn() }));
vi.mock("../src/cards.js", () => ({ loadCardDatabase: vi.fn() }));
vi.mock("../src/engine.js", () => ({ createEngineGame: create }));
vi.mock("../src/legacy/index.js", () => ({ createLegacyEngineGame: legacyCreate }));
vi.mock("node:worker_threads", async () => {
  const { EventEmitter } = await import("node:events");
  return { parentPort: null, Worker: class extends EventEmitter {
    postMessage(request: Parameters<typeof handleWorkerRequest>[0]) {
      void handleWorkerRequest(request).then(response => this.emit("message", response));
    }
    async terminate() { return 0; }
  } };
});

const directories: string[] = [];
afterEach(async () => {
  await handleWorkerRequest({ id: 0, op: "close" });
  vi.clearAllMocks();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function options() {
  const directory = mkdtempSync(join(tmpdir(), "worker-identity-"));
  directories.push(directory);
  mkdirSync(join(directory, "card-scripts"));
  writeFileSync(join(directory, "card-scripts/constant.lua"), "constant");
  writeFileSync(join(directory, "manifest.json"), JSON.stringify({ bundleVersion: "test-bundle" }));
  writeFileSync(join(directory, "cards.cdb"), "cards");
  writeFileSync(join(directory, "ocgcore.standard.wasm"), "core");
  const { identity } = getCurrentEngineResources(directory, { mode: "normal", engine: "pinned" });
  return { mode: "normal" as const, engine: "pinned" as const, dataDirectory: directory, decks: [], seed: [], engineIdentity: identity };
}

describe("worker resource identity gate", () => {
  it.each([0, 1] as const)("keeps script error occurrence keys stable when replay supplies sort version %s", async (sortOrderVersion) => {
    create.mockImplementation(async ({ onScriptError }) => ({
      answer() {
        onScriptError({ code: 3743515, scriptFile: "c3743515.lua", line: 1, message: "fixture error",
          mode: "normal", format: "1v1", engine: "pinned", scriptErrorMode: "tolerant" });
      },
      close: vi.fn(),
    }));
    const input = { mode: "normal" as const, dataDirectory: "unused", decks: [], seed: ["saved-seed"] };
    const answer = { op: "answer" as const, seat: 0, promptId: "p1", answer: { choice: "attack:0" } };
    expect(await handleWorkerRequest({ id: 1, op: "create", options: input })).toMatchObject({ ok: true });
    const live = await handleWorkerRequest({ id: 2, ...answer });
    expect(live).toMatchObject({ ok: true, scriptErrors: [{ commandHash: expect.stringMatching(/^[a-f0-9]{64}$/), index: 1, journalPosition: 0 }] });
    await handleWorkerRequest({ id: 3, op: "close" });
    expect(await handleWorkerRequest({ id: 4, op: "create", options: input })).toMatchObject({ ok: true });
    const replay = await handleWorkerRequest({ id: 5, ...answer, sortOrderVersion });
    expect(replay.scriptErrors).toEqual(live.scriptErrors);
  });

  it("refuses a changed core before calling either engine factory", async () => {
    const input = options();
    writeFileSync(join(input.dataDirectory, "ocgcore.standard.wasm"), "changed");
    const result = await handleWorkerRequest({ id: 1, op: "create", options: input });
    expect(result).toMatchObject({ ok: false, code: "ENGINE_UNAVAILABLE_FOR_SOURCE" });
    expect(create).not.toHaveBeenCalled();
    expect(legacyCreate).not.toHaveBeenCalled();
  });

  it("preserves the stable error through the worker client", async () => {
    const input = options();
    input.engineIdentity.wrapperHash = "0".repeat(64);
    const worker = new GameWorker();
    try {
      await expect(worker.create(input)).rejects.toMatchObject({ code: "ENGINE_UNAVAILABLE_FOR_SOURCE", status: 409 });
    } finally { await worker.close(); }
  });

  it("accepts an exact identity and passes the saved rules to the engine", async () => {
    const input = options();
    create.mockResolvedValueOnce({ close: vi.fn() });
    expect(await handleWorkerRequest({ id: 1, op: "create", options: { ...input, firstTurnDraw: false } })).toMatchObject({ ok: true });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ engineIdentity: input.engineIdentity, firstTurnDraw: false }));
  });

  it("passes replay history cursors through the client and worker without changing default views", async () => {
    const view = vi.fn(() => ({ revision: 1 }));
    create.mockResolvedValueOnce({ view, close: vi.fn() });
    const worker = new GameWorker();
    try {
      await worker.create(options());
      const history = { logAfter: 100, eventsAfter: 200 };
      await expect(worker.view(0, history)).resolves.toEqual({ revision: 1 });
      expect(view).toHaveBeenLastCalledWith(0, history);
      await worker.view(null);
      expect(view).toHaveBeenLastCalledWith(null, undefined);
    } finally { await worker.close(); }
  });
});
