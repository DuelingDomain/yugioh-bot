import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actor = { ok: true as const, guildId: "g1", playerId: 7, duels: { room: vi.fn() } };
const callDuelHost = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/duel-host", async () => {
  const real = await vi.importActual<typeof import("@/lib/duel-host")>("@/lib/duel-host");
  return { ...real, requireDuelActor: vi.fn(async () => actor), callDuelHost };
});

const ctx = { params: Promise.resolve({ slug: "abc" }) };
const post = (body: unknown) => new Request("http://x", { method: "POST", body: JSON.stringify(body) });
const dirs: string[] = [];

describe("report route client-attachments.json", () => {
  let dir: string;
  beforeEach(() => {
    vi.stubEnv("DUEL_SCENARIOS", "1");
    callDuelHost.mockReset();
    actor.duels.room.mockReset();
    dir = mkdtempSync(join(tmpdir(), "report-att-"));
    dirs.push(dir);
    callDuelHost.mockResolvedValue({ ok: true, data: { path: dir } });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("writes the attachments next to the report", async () => {
    const { POST } = await import("../app/api/duels/[slug]/report/route");
    const attachments = { form: { kind: "bug", step: 3 }, list: [1, 2] };
    const res = await POST(post({ note: "n", attachments }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ path: dir, attachments: "written" });
    expect(JSON.parse(readFileSync(join(dir, "client-attachments.json"), "utf8"))).toEqual(attachments);
  });

  it("writes no file without attachments", async () => {
    const { POST } = await import("../app/api/duels/[slug]/report/route");
    const a = await POST(post({ note: "n" }), ctx);
    expect(a.status).toBe(200);
    expect(await a.json()).toEqual({ path: dir, attachments: "none" });
    const b = await POST(post({ note: "n", attachments: null }), ctx);
    expect(b.status).toBe(200);
    expect(await b.json()).toEqual({ path: dir, attachments: "none" });
    expect(existsSync(join(dir, "client-attachments.json"))).toBe(false);
  });

  it("skips the file, but still answers 200, when the attachments are over 1.5 MB", async () => {
    const { POST } = await import("../app/api/duels/[slug]/report/route");
    const res = await POST(post({ note: "n", attachments: { blob: "x".repeat(1_600_000) } }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ path: dir, attachments: "too-large" });
    expect(existsSync(join(dir, "client-attachments.json"))).toBe(false);
  });

  it("still answers 200 when the report folder cannot be written", async () => {
    callDuelHost.mockResolvedValue({ ok: true, data: { path: join(dir, "missing", "deeper") } });
    const { POST } = await import("../app/api/duels/[slug]/report/route");
    const res = await POST(post({ note: "n", attachments: { a: 1 } }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ path: join(dir, "missing", "deeper"), attachments: "failed" });
  });
});
