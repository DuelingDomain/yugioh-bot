import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { execFileSync } from "node:child_process";
import { cpSync, symlinkSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import type { ArchetypeProfile, Card } from "@yugidraft/shared/cards/effects";
import { hashCardEffectSourceText } from "@yugidraft/shared/cards/effects";

const roots: string[] = [], servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); })));
  roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }));
});
const rootPath = fileURLToPath(new URL("../../../", import.meta.url));
const fixtureCards = () => JSON.parse(readFileSync(join(rootPath, "scripts/effects/tagging-example-cards.json"), "utf8")).cards as Card[];
const changedCards = () => fixtureCards().map(card => ({ ...card, text: `${card.text}\nUpdated printed effect.` }));
const rawTags = new Map(gunzipSync(readFileSync(new URL("../../../packages/shared/data/effects/tags.jsonl.gz", import.meta.url))).toString("utf8").trim().split("\n").map(line => { const row = JSON.parse(line); return [row.id, row.tags] as const; }));

const profileFixture: ArchetypeProfile = { plan: "Uses Fiends to build a field.", hooks: [{ label: "Fiend support", why: "Fiends share support.", does: null, reacts_to: null, card: null, supports: { types: ["Fiend"], attributes: [] }, phrases: [] }] };
const rowsInPinnedProfiles = () => gunzipSync(readFileSync(join(rootPath, "packages/shared/data/effects/profiles.jsonl.gz"))).toString().trim().split("\n").length;
const profileCards = () => changedCards().map(card => ({ ...card, archetype: "CI Fiends" }));

function resignCandidate(output: string, key = "profiles") {
  const data = join(output, "packages/shared/data/effects"), sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
  const manifest = JSON.parse(readFileSync(join(data, "manifest.json"), "utf8"));
  const compressed = readFileSync(join(data, key === "releases" ? "releases.json.gz" : "profiles.jsonl.gz")), raw = gunzipSync(compressed);
  Object.assign(manifest.files[key], { bytes: raw.length, sha256: sha(raw), gzipBytes: compressed.length, gzipSha256: sha(compressed), records: key === "releases" ? JSON.parse(raw.toString()).length : raw.toString().trim().split("\n").length });
  const { artifactVersion: _old, ...identity } = manifest;
  manifest.artifactVersion = sha(JSON.stringify(identity));
  const bytes = JSON.stringify(manifest, null, 2) + "\n";
  writeFileSync(join(data, "manifest.json"), bytes);
  const metadata = JSON.parse(readFileSync(join(output, "update.json"), "utf8"));
  Object.assign(metadata, { artifactVersion: manifest.artifactVersion, manifestSha256: sha(bytes) });
  writeFileSync(join(output, "update.json"), JSON.stringify(metadata));
  const source = join(output, "packages/shared/src/cards/effects/artifact.ts");
  writeFileSync(source, readFileSync(source, "utf8").replace(/(export const CARD_EFFECT_ARTIFACT_VERSION = ")[a-f0-9]{64}/, `$1${manifest.artifactVersion}`).replace(/(export const CARD_EFFECT_ARTIFACT_MANIFEST_SHA256 = ")[a-f0-9]{64}/, `$1${sha(bytes)}`));
}

async function setup(now = "2026-10-10T12:00:00Z") {
  const ledger = await import("../budget-ledger.js");
  const { runTagging } = await import("../tag-cards.js");
  const { AnthropicBatchClient } = await import("../batch-client.js");
  const directory = mkdtempSync(join(tmpdir(), "effect-batch-integration-")); roots.push(directory);
  const store = new ledger.FileLedgerStore(join(directory, "ledger.json"));
  await store.compareAndSwap(undefined, ledger.createEmptyLedger());
  return { ...ledger, directory, store, runTagging, AnthropicBatchClient, now: () => new Date(now) };
}
async function endpoint(options: { uncertain?: boolean; badTags?: boolean; partial?: boolean; duplicate?: boolean; processing?: boolean; badProfile?: boolean; onSubmit?: () => Promise<void> } = {}) {
  const events: string[] = [], batches: Array<{ id: string; requests: Array<{ custom_id: string; params: Record<string, any> }> }> = [];
  const server = createServer(async (request, response) => {
    events.push(`${request.method} ${request.url}`);
    let body = ""; for await (const chunk of request) body += chunk;
    response.setHeader("content-type", "application/json");
    if (request.method === "POST" && request.url === "/v1/messages/batches") {
      await options.onSubmit?.();
      const batch = { id: `msgbatch_fixture_${batches.length + 1}`, requests: JSON.parse(body).requests }; batches.push(batch);
      if (options.uncertain) { request.socket.destroy(); return; }
      response.end(JSON.stringify({ id: batch.id, processing_status: "in_progress" })); return;
    }
    const batch = batches.find(value => request.url?.includes(value.id));
    if (!batch) { response.statusCode = 404; response.end("{}"); return; }
    if (request.url?.endsWith("/results")) {
      let result = batch.requests.map(req => {
        const ids = [...String(req.params.messages[0].content).matchAll(/<card id="(\d+)">/g)].map(match => Number(match[1]));
        const cards = ids.map(id => ({ id: String(id), ...rawTags.get(id), supports: { ...rawTags.get(id)?.supports, names: ["Made-Up Card"] } }));
        return { custom_id: req.custom_id, result: { type: "succeeded", message: { model: req.params.model, stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 50 }, content: [{ type: "text", text: options.badTags ? "not JSON" : JSON.stringify(req.params.output_config.format.schema.properties.plan ? (options.badProfile ? { ...profileFixture, hooks: [{ ...profileFixture.hooks[0], phrases: ["CI Fiends"] }] } : profileFixture) : { cards }) }] } } };
      }).reverse();
      if (options.partial) result = result.slice(0, -1);
      if (options.duplicate && result.length) result.push(result[0]);
      response.end(result.map(line => JSON.stringify(line)).join("\n") + "\n"); return;
    }
    response.end(JSON.stringify({ id: batch.id, processing_status: options.processing ? "in_progress" : "ended", request_counts: { succeeded: batch.requests.length, errored: 0, expired: 0, canceled: 0, processing: 0 } }));
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  return { baseUrl: `http://127.0.0.1:${address.port}`, events, batches };
}

async function releaseEndpoint(data: unknown[], failures = 0, sets: unknown[] = []) {
  const events: string[] = [];
  const server = createServer((request, response) => {
    events.push(`${request.method} ${request.url}`);
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/v7/cardsets.php") { response.end(JSON.stringify(sets)); return; }
    response.statusCode = events.filter(event => event.includes("cardinfo")).length <= failures ? 503 : 200;
    response.end(JSON.stringify({ data }));
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return { events, endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v7/cardinfo.php?misc=yes` };
}

it("fills missing release months through bulk HTTP, keeps families and valid dates, and rejects non-additive publication", async () => {
  const context = await setup();
  const data = "packages/shared/data/effects";
  const before = JSON.parse(gunzipSync(readFileSync(join(rootPath, data, "releases.json.gz"))).toString());
  const missing = before.find((row: any) => row.tcgDate === null);
  const good = before.find((row: any) => row.tcgDate && row.ocgDate && row.aliases.length);
  const reprint = before.find((row: any) => row.tcgDate && row.tcgDate > "2003-01" && row.id !== good.id);
  const api = await releaseEndpoint([
    { id: missing.id, name: missing.name, misc_info: [{ tcg_date: "2026-10-18", ocg_date: "1998-01-01" }] },
    { id: good.id, name: good.name, card_images: good.aliases.map((id: number) => ({ id })), misc_info: [{ tcg_date: "2026-10-18", ocg_date: "2026-10-18" }] },
    { id: reprint.id, name: reprint.name, card_sets: [{ set_name: "First print", set_code: "FIRST-EN001" }], misc_info: [{ tcg_date: "2027-03-01" }] },
    { id: 99999996, name: "Invalid placeholder fixture", misc_info: [{ tcg_date: "2001-12-01", ocg_date: "1998-12-01" }] },
    { id: 99999997, name: "New release fixture", misc_info: [{ tcg_date: "2026-11-01", ocg_date: "2026-10-01" }] },
  ], 1, [{ set_name: "First print", set_code: "FIRST", tcg_date: "2003-01-01" }]);
  const { refreshReleaseCandidate } = await import("../fill-releases.js");
  const options = { root: rootPath, outputDirectory: join(context.directory, "candidate"), cacheDirectory: join(context.directory, "cache"), baseSha: "a".repeat(40), endpoint: api.endpoint, backoffMs: 1 };
  const result = await refreshReleaseCandidate(options);
  expect(result.status).toBe("updated");
  expect(result.filledCards).toBe(3);
  expect(result.corrections).toEqual([expect.objectContaining({ id: reprint.id, region: "tcg", previous: reprint.tcgDate, month: "2003-01", firstSetMonth: "2003-01" })]);
  expect(result.flags).toEqual(expect.arrayContaining([expect.objectContaining({ id: reprint.id, region: "tcg", sourceMonth: "2027-03", firstSetMonth: "2003-01" })]));
  expect(api.events.filter(event => event.includes("cardinfo"))).toEqual(Array(2).fill("GET /api/v7/cardinfo.php?misc=yes"));
  expect(api.events.filter(event => event.includes("cardsets"))).toHaveLength(1);
  const after = JSON.parse(gunzipSync(readFileSync(join(options.outputDirectory, data, "releases.json.gz"))).toString());
  expect(after.find((row: any) => row.id === missing.id)).toEqual({ ...missing, tcgDate: "2026-10" });
  expect(after.find((row: any) => row.id === good.id)).toEqual(good);
  expect(after.find((row: any) => row.id === reprint.id)).toEqual({ ...reprint, tcgDate: "2003-01" });
  expect(after.find((row: any) => row.id === 99999996)).toBeUndefined();
  expect(after.filter((row: any) => good.aliases.includes(row.id))).toEqual(before.filter((row: any) => good.aliases.includes(row.id)));
  const publisherPath = "../../ci/publish-effect-tags.mjs";
  const { validateEffectCandidate } = await import(publisherPath);
  expect(validateEffectCandidate(rootPath, options.outputDirectory).changed).toBe(true);
  await refreshReleaseCandidate(options);
  expect(api.events).toHaveLength(3); // persistent bulk cache; no per-card calls
  const original = readFileSync(join(options.outputDirectory, data, "releases.json.gz"));
  for (const mutate of [
    (rows: any[]) => { rows.find(row => row.id === good.id).tcgDate = "2026-10"; },
    (rows: any[]) => { rows.find(row => row.id === good.id).tcgDate = "2002-01"; }, // earlier needs evidence
    (rows: any[]) => { rows.find(row => row.id === reprint.id).tcgDate = "2003-02"; }, // must match evidence
    (rows: any[]) => { rows.find(row => row.id === good.id).name += " changed"; },
    (rows: any[]) => { rows.splice(rows.findIndex(row => row.id === good.id), 1); },
    (rows: any[]) => { rows.push(rows[0]); },
    (rows: any[]) => { rows.find(row => row.id === 99999997).aliases.push(good.id); },
    (rows: any[]) => { rows.find(row => row.id === 99999997).id = good.aliases[0]; },
  ]) {
    const rows = JSON.parse(gunzipSync(original).toString()); mutate(rows);
    writeFileSync(join(options.outputDirectory, data, "releases.json.gz"), gzipSync(JSON.stringify(rows) + "\n"));
    resignCandidate(options.outputDirectory, "releases");
    expect(() => validateEffectCandidate(rootPath, options.outputDirectory)).toThrow(/release|additive/i);
  }
});

describe("Haiku Batch tagging against a fake HTTP endpoint and durable ledger", { timeout: 30_000 }, () => {
  it("defaults to a keyless dry run with no API or durable-state mutation", async () => {
    const context = await setup(), api = await endpoint();
    const before = await context.store.read();
    const report = await context.runTagging({ cards: changedCards(), store: context.store, now: context.now,
      client: new context.AnthropicBatchClient({ baseUrl: api.baseUrl, apiKey: "fake", allowLoopback: true }) });
    expect(report.mode).toBe("dry-run"); expect(report.candidates).toBe(6);
    expect(api.events).toEqual([]); expect(await context.store.read()).toEqual(before);
  });

  it("aligns uniquely named source artwork IDs before deciding that a card needs paid tags", async () => {
    const context = await setup();
    const original = await context.runTagging({ cards: fixtureCards(), store: context.store, now: context.now });
    const cards = fixtureCards().map(card => card.id === 14558127 ? { ...card, id: 14558128 } : card);
    const report = await context.runTagging({ cards, store: context.store, now: context.now });
    expect(report.candidates).toBe(original.candidates);
  });

  it.each(["Dark World", "Tearlaments"])("preserves the curated %s profile when the engine catalog has 40 members", async archetype => {
    const context = await setup();
    const cards = Array.from({ length: 40 }, (_, index) => ({ ...changedCards()[0], id: 10000000 + index, archetype }));
    const before = await context.store.read();
    const report = await context.runTagging({ cards, store: context.store, now: context.now });
    expect(report.profileCandidates).toBe(0);
    expect(await context.store.read()).toEqual(before);
    const { profileCandidates } = await import("../profile-archetypes.js");
    // Examples remain protected if absent from an artifact, as do other curated rows.
    expect(profileCandidates(cards, [])).toEqual([]);
    expect(profileCandidates(cards.map(card => ({ ...card, archetype: "Curated Fiends" })), [
      { archetype: "Curated Fiends", cards: 3, model: "hand-written", profile: profileFixture },
    ])).toEqual([]);
  });

  it("keeps named functional aliases from a real SQLite engine-shaped catalog", async () => {
    const context = await setup(), engine = join(context.directory, "engine");
    mkdirSync(join(engine, "card-scripts"), { recursive: true }); writeFileSync(join(engine, "strings.conf"), "");
    const fixture = JSON.parse(readFileSync(new URL("./named-alias-cards.json", import.meta.url), "utf8")).cards as Card[];
    const cdb = new Database(join(engine, "cards.cdb"));
    cdb.exec(`CREATE TABLE datas(id INTEGER PRIMARY KEY,ot INTEGER,alias INTEGER,setcode INTEGER,type INTEGER,atk INTEGER,def INTEGER,level INTEGER,race INTEGER,attribute INTEGER);
      CREATE TABLE texts(id INTEGER PRIMARY KEY,name TEXT,desc TEXT);`);
    for (const card of fixture) {
      cdb.prepare("INSERT INTO datas VALUES(?,3,?,0,?,1300,1400,4,512,8)").run(card.id, card.name === "Harpie Lady 1" ? 76812113 : 0, card.name === "Harpie Lady 1" ? 33 : 17);
      cdb.prepare("INSERT INTO texts VALUES(?,?,?)").run(card.id, card.name, card.text);
    }
    cdb.close();
    const { loadTaggingCatalog, isTaggable } = await import("../catalog.js");
    const cards = await loadTaggingCatalog(engine), one = cards.find(card => card.name === "Harpie Lady 1")!;
    expect(one.id).toBe(fixture.find(card => card.name === "Harpie Lady 1")!.id); expect(isTaggable(one)).toBe(true);
    expect(cards.find(card => card.name === "Harpie Lady")?.id).toBe(76812113);
  });

  it("recovers an uncertain submission only after its complete immutable result IDs match", async () => {
    const context = await setup(), api = await endpoint({ uncertain: true });
    const client = new context.AnthropicBatchClient({ baseUrl: api.baseUrl, apiKey: "fake", allowLoopback: true });
    await expect(context.runTagging({ cards: changedCards(), store: context.store, client, dryRun: false, now: context.now })).rejects.toThrow(/uncertain/);
    const reservationId = (await context.store.read())!.ledger.reservations[0].id;
    const { recoverTaggingSubmission } = await import("../tag-cards.js");
    expect(await recoverTaggingSubmission(context.store, client, reservationId, "msgbatch_fixture_1")).toBe(true);
    const recovered = (await context.store.read())!.ledger;
    expect(recovered.months["2026-10"]).toBe(18);
    expect(recovered.reservations[0]).toMatchObject({ state: "settled", batchId: "msgbatch_fixture_1", actualMicros: 18 });
    expect(recovered.reservations[0].accepted).toHaveLength(6);
    expect(api.events.filter(event => event.startsWith("POST"))).toHaveLength(1);
  });

  it("durably reserves before HTTP, collects validated tags, and reuses results before PR merge", async () => {
    const context = await setup(), api = await endpoint({ onSubmit: async () => {
      expect((await context.store.read())!.ledger.reservations[0]).toMatchObject({ state: "submission_started", reservedMicros: 275_000 });
    } });
    const client = new context.AnthropicBatchClient({ baseUrl: api.baseUrl, apiKey: "fake", allowLoopback: true });
    const first = await context.runTagging({ cards: changedCards(), store: context.store, client, dryRun: false, now: context.now });
    expect(first.submitted).toBe(1);
    const durable = (await context.store.read())!.ledger;
    expect(durable.reservations[0]).toMatchObject({ state: "submitted", reservedMicros: 275_000, batchId: "msgbatch_fixture_1" });
    const params = api.batches[0].requests[0].params;
    expect(params.model).toBe("claude-haiku-5-5"); expect(params.max_tokens).toBe(20_000);
    expect(params.thinking).toEqual({ type: "disabled" });
    for (const key of ["tools", "cache_control"]) expect(params).not.toHaveProperty(key);
    expect(params.output_config).not.toHaveProperty("effort");
    const second = await context.runTagging({ cards: changedCards(), store: context.store, client, dryRun: false, now: context.now });
    expect(second.accepted).toHaveLength(6); expect(second.submitted).toBe(0); expect(second.usedMicros).toBe(18);
    for (const tag of second.accepted) { expect(tag.tags.supports.names).toEqual([]); expect(tag.inputHash).toBe(hashCardEffectSourceText(changedCards().find(card => card.id === tag.id)!)); }
    const third = await context.runTagging({ cards: changedCards(), store: context.store, client, dryRun: false, now: context.now });
    expect(third.reused).toBe(6); expect(api.events.filter(event => event.startsWith("POST"))).toHaveLength(1);
  });

  it("retains uncertain submissions across restarts and UTC month rollover without retrying", async () => {
    const context = await setup(), api = await endpoint({ uncertain: true });
    const client = new context.AnthropicBatchClient({ baseUrl: api.baseUrl, apiKey: "fake", allowLoopback: true });
    await expect(context.runTagging({ cards: changedCards(), store: context.store, client, dryRun: false, now: context.now })).rejects.toThrow(/uncertain|ambiguous/i);
    expect((await context.store.read())!.ledger.reservations[0].state).toBe("submission_started");
    const reopened = new context.FileLedgerStore(join(context.directory, "ledger.json"));
    const report = await context.runTagging({ cards: changedCards(), store: reopened, client, dryRun: false, now: () => new Date("2026-11-10T12:00:00Z") });
    expect(report.usedMicros).toBe(275_000); expect(report.submitted).toBe(0);
    expect(api.events.filter(event => event.startsWith("POST"))).toHaveLength(1);
  });

  it.each([{ partial: true }, { duplicate: true }])("holds the entire reservation for incomplete or duplicate results (%j)", async failure => {
    const context = await setup(), api = await endpoint(failure);
    const client = new context.AnthropicBatchClient({ baseUrl: api.baseUrl, apiKey: "fake", allowLoopback: true });
    await context.runTagging({ cards: changedCards(), store: context.store, client, dryRun: false, now: context.now });
    await expect(context.runTagging({ cards: changedCards(), store: context.store, client, dryRun: false, now: context.now })).rejects.toThrow(/results|duplicate|incomplete/i);
    expect((await context.store.read())!.ledger.reservations[0]).toMatchObject({ state: "submitted", reservedMicros: 275_000 });
  });

  it("settles billed usage even when every returned tag fails validation", async () => {
    const context = await setup(), api = await endpoint({ badTags: true });
    const client = new context.AnthropicBatchClient({ baseUrl: api.baseUrl, apiKey: "fake", allowLoopback: true });
    await context.runTagging({ cards: changedCards(), store: context.store, client, dryRun: false, now: context.now });
    const report = await context.runTagging({ cards: changedCards(), store: context.store, client, dryRun: false, now: context.now, maxRequests: 0 });
    expect(report.accepted).toEqual([]); expect(report.usedMicros).toBe(18);
    expect((await context.store.read())!.ledger.reservations[0]).toMatchObject({ state: "settled", actualMicros: 18 });
  });

  it("refuses budget exhaustion, end-of-month submission, missing ledgers and lost CAS races before HTTP", async () => {
    const context = await setup(), api = await endpoint();
    const client = new context.AnthropicBatchClient({ baseUrl: api.baseUrl, apiKey: "fake", allowLoopback: true });
    const history = await setup(), historyApi = await endpoint();
    const historyClient = new history.AnthropicBatchClient({ baseUrl: historyApi.baseUrl, apiKey: "fake", allowLoopback: true });
    await history.runTagging({ cards: changedCards(), store: history.store, client: historyClient, dryRun: false, now: history.now });
    await history.runTagging({ cards: changedCards(), store: history.store, client: historyClient, dryRun: false, now: history.now });
    const prior = (await history.store.read())!.ledger.reservations[0];
    const snapshot = (await context.store.read())!;
    snapshot.ledger.reservations = Array.from({ length: 66 }, (_, index) => ({ ...structuredClone(prior), id: index.toString(16).padStart(32, "0"), actualMicros: 150_000, accepted: [], failures: [] }));
    snapshot.ledger.months["2026-10"] = 9_900_000;
    await context.store.compareAndSwap(snapshot.revision, snapshot.ledger);
    const budget = await context.runTagging({ cards: changedCards(), store: context.store, client, dryRun: false, now: context.now });
    expect(budget.deferred).toContain("monthly-budget");
    const monthEnd = await context.runTagging({ cards: changedCards(), store: context.store, client, dryRun: false, now: () => new Date("2026-10-31T23:59:00Z") });
    expect(monthEnd.deferred).toContain("month-end");
    const missing = new context.FileLedgerStore(join(context.directory, "missing.json"));
    await expect(context.runTagging({ cards: changedCards(), store: missing, client, dryRun: false, now: context.now })).rejects.toThrow(/ledger/i);
    const fresh = await setup();
    const conflict = { read: () => fresh.store.read(), compareAndSwap: async () => { throw new Error("Ledger CAS conflict"); } };
    await expect(fresh.runTagging({ cards: changedCards(), store: conflict, client, dryRun: false, now: fresh.now })).rejects.toThrow(/CAS/);
    expect(api.events).toEqual([]);
  });

  it("rejects understated, missing and invented monthly totals from durable state before HTTP or CAS", async () => {
    const history = await setup(), historyApi = await endpoint();
    const historyClient = new history.AnthropicBatchClient({ baseUrl: historyApi.baseUrl, apiKey: "fake", allowLoopback: true });
    await history.runTagging({ cards: changedCards(), store: history.store, client: historyClient, dryRun: false, now: history.now });
    await history.runTagging({ cards: changedCards(), store: history.store, client: historyClient, dryRun: false, now: history.now });
    const valid = (await history.store.read())!.ledger;
    const api = await endpoint(); let writes = 0;
    const client = new history.AnthropicBatchClient({ baseUrl: api.baseUrl, apiKey: "fake", allowLoopback: true });
    for (const months of [{}, { "2026-10": 0 }, { "2026-10": 19 }, { "2026-10": 18, "2026-11": 0 }]) {
      writeFileSync(join(history.directory, "ledger.json"), JSON.stringify({ ...valid, months }));
      const store = { read: () => history.store.read(), compareAndSwap: async () => { writes++; throw new Error("Unexpected write"); } };
      await expect(history.runTagging({ cards: changedCards(), store, client, dryRun: false, now: history.now })).rejects.toThrow(/monthly|totals|ledger/i);
    }
    expect(api.events).toEqual([]); expect(writes).toBe(0);
  });

  it("writes a reviewable next pin with actual tagged-input hashes and unchanged profiles/popularity/releases", async () => {
    const context = await setup(), api = await endpoint();
    const client = new context.AnthropicBatchClient({ baseUrl: api.baseUrl, apiKey: "fake", allowLoopback: true });
    await context.runTagging({ cards: changedCards(), store: context.store, client, dryRun: false, now: context.now });
    const report = await context.runTagging({ cards: changedCards(), store: context.store, client, dryRun: false, now: context.now });
    const { writeEffectArtifactCandidate } = await import("../artifact-output.js");
    const original = readFileSync(join(rootPath, "packages/shared/src/cards/effects/artifact.ts"), "utf8");
    const output = join(context.directory, "candidate");
    const candidate = writeEffectArtifactCandidate({ root: rootPath, outputDirectory: output, baseSha: "a".repeat(40), accepted: report.accepted });
    expect(candidate.changed).toBe(true);
    const manifest = JSON.parse(readFileSync(join(output, "packages/shared/data/effects/manifest.json"), "utf8"));
    expect(manifest.source.commit).toBe("9b2d952f8e7c389e13267d4bba6504cc8ea4cb5c");
    expect(manifest.generation).toMatchObject({ models: ["claude-haiku-5-5"], acceptedCards: 6 });
    const sidecar = JSON.parse(gunzipSync(readFileSync(join(output, "packages/shared/data/effects/source-hashes.json.gz"))).toString("utf8"));
    expect(sidecar.hashes[14558127]).toBe(hashCardEffectSourceText(changedCards()[0]));
    for (const file of ["profiles.jsonl.gz", "popularity.json.gz", "releases.json.gz"]) {
      expect(readFileSync(join(output, "packages/shared/data/effects", file))).toEqual(readFileSync(join(rootPath, "packages/shared/data/effects", file)));
    }
    expect(readFileSync(join(output, "packages/shared/src/cards/effects/artifact.ts"), "utf8")).toContain(manifest.artifactVersion);
    expect(readFileSync(join(rootPath, "packages/shared/src/cards/effects/artifact.ts"), "utf8")).toBe(original);
    writeFileSync(join(output, "report.json"), JSON.stringify(report));
    const publisherPath = "../../ci/publish-effect-tags.mjs";
    const { validateEffectCandidate } = await import(publisherPath);
    const { refreshReleaseCandidate } = await import("../fill-releases.js");
    const down = await releaseEndpoint([], 99);
    const skipped = await refreshReleaseCandidate({ root: rootPath, outputDirectory: output, cacheDirectory: join(context.directory, "cache"), baseSha: "a".repeat(40), endpoint: down.endpoint, backoffMs: 1 });
    expect(skipped.status).toBe("skipped");
    expect(down.events).toHaveLength(3);
    expect(validateEffectCandidate(rootPath, output).changed).toBe(true);
    const releasePath = join(output, "packages/shared/data/effects/releases.json.gz");
    const releaseBytes = readFileSync(releasePath);
    writeFileSync(releasePath, "corrupt");
    expect(() => validateEffectCandidate(rootPath, output)).toThrow(/release|unrelated|integrity/i);
    writeFileSync(releasePath, releaseBytes);
    // A real Git commit object models an amend retaining bot author identity
    // while a reviewer becomes the committer. No workspace ref/commit is made.
    const bare = join(context.directory, "history.git");
    execFileSync("git", ["init", "--bare", "--quiet", bare]);
    const git = (args: string[], input?: string) => execFileSync("git", ["--git-dir", bare, ...args], { encoding: "utf8", input,
      env: { ...process.env, GIT_AUTHOR_NAME: "github-actions[bot]", GIT_AUTHOR_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com", GIT_COMMITTER_NAME: "Reviewer", GIT_COMMITTER_EMAIL: "reviewer@example.invalid" } }).trim();
    const tree = git(["mktree"], ""), commit = git(["commit-tree", tree], "fixture\n");
    const history = git(["log", "--format=%an%x00%ae%x00%cn%x00%ce", commit]);
    const { effectBranchHasHumanEdits } = await import(publisherPath);
    expect(effectBranchHasHumanEdits(history)).toBe(true);
    // A prior push can succeed while PR creation or Test dispatch fails. Real
    // compressed candidate data is revalidated; fake CLI processes model the
    // already-pushed remote branch without making any GitHub/network writes.
    writeFileSync(join(output, "report.md"), "Validated effect tag update.\n");
    const bin = join(context.directory, "bin"); mkdirSync(bin);
    const callsFile = join(context.directory, "publisher-calls.jsonl");
    const bot = "github-actions[bot]\0" + "41898282+github-actions[bot]@users.noreply.github.com";
    const cli = `#!${process.execPath}\nconst fs = require('node:fs');
      const args = process.argv.slice(2), command = process.argv[1].endsWith('/git') ? 'git' : 'gh';
      fs.appendFileSync(process.env.EFFECT_TEST_CALLS, JSON.stringify({ command, args }) + '\\n');
      let result = '';
      if (command === 'git') {
        if (args[0] === 'ls-remote') result = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\trefs/heads/chore/effect-tags';
        else if (args[0] === 'rev-parse') result = args[1].endsWith('/main') ? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' : 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
        else if (args[0] === 'log') result = JSON.parse(process.env.EFFECT_TEST_BOT_HISTORY);
        else if (args[0] === 'show') result = JSON.stringify({ artifactVersion: process.env.EFFECT_TEST_PIN });
        else if (!['check-ref-format', 'fetch'].includes(args[0])) throw new Error('Unexpected Git mutation: ' + args.join(' '));
      } else if (args[0] === 'pr' && args[1] === 'list') result = process.env.EFFECT_TEST_PR;
      else if (!(args[0] === 'pr' && ['create', 'edit'].includes(args[1])) && !(args[0] === 'workflow' && args[1] === 'run')) throw new Error('Unexpected gh call');
      process.stdout.write(result);\n`;
    for (const name of ["git", "gh"]) { writeFileSync(join(bin, name), cli); chmodSync(join(bin, name), 0o755); }
    const { publishEffectTags } = await import(publisherPath);
    for (const priorPr of ["", "https://github.com/example/repository/pull/1"]) {
      writeFileSync(callsFile, "");
      const resumed = await publishEffectTags({ root: rootPath, outputDirectory: output, env: { ...process.env,
        PATH: `${bin}:${process.env.PATH}`, GITHUB_REPOSITORY: "example/repository", EFFECT_TEST_CALLS: callsFile,
        EFFECT_TEST_BOT_HISTORY: JSON.stringify(`${bot}\0${bot}`), EFFECT_TEST_PIN: manifest.artifactVersion, EFFECT_TEST_PR: priorPr } });
      expect(resumed).toMatchObject({ status: "published", pushed: false });
      const calls = readFileSync(callsFile, "utf8").trim().split("\n").map(line => JSON.parse(line) as { command: string; args: string[] });
      expect(calls.filter(call => call.command === "gh" && call.args[0] === "pr").map(call => call.args[1])).toEqual(["list", priorPr ? "edit" : "create"]);
      expect(calls.find(call => call.command === "gh" && call.args[0] === "workflow")?.args).toEqual(["workflow", "run", "test.yml", "--repo", "example/repository", "--ref", "chore/effect-tags", "-f", "nightly=false"]);
      expect(calls.some(call => call.command === "git" && ["push", "commit", "switch", "add"].includes(call.args[0]))).toBe(false);
    }
    writeFileSync(join(output, "packages/shared/src/cards/effects/artifact.ts"), `${original}\nprocess.exit(1);\n`);
    expect(() => validateEffectCandidate(rootPath, output)).toThrow(/pin constants|code outside/);
  }, 15_000);
  it("profiles grown archetypes in the same durable batch, reuses inputs, and publishes only accepted profiles", async () => {
    const context = await setup(), api = await endpoint();
    const client = new context.AnthropicBatchClient({ baseUrl: api.baseUrl, apiKey: "fake", allowLoopback: true });
    const before = await context.runTagging({ cards: profileCards(), store: context.store, now: context.now });
    expect(before.profileCandidates).toBe(1); expect(api.events).toEqual([]);
    await context.runTagging({ cards: profileCards(), store: context.store, client, dryRun: false, now: context.now });
    expect(api.batches[0].requests).toHaveLength(2);
    for (const request of api.batches[0].requests) expect(request.params.thinking).toEqual({ type: "disabled" });
    const profileRequest = (await context.store.read())!.ledger.reservations[0].requests.find(request => request.archetype)!;
    const profileParams = api.batches[0].requests.find(request => request.params.output_config.format.schema.properties.plan)!.params;
    expect(profileRequest).not.toHaveProperty("systemPrompt");
    expect(profileRequest.promptHash).toBe(createHash("sha256").update(profileParams.system).digest("hex"));
    const report = await context.runTagging({ cards: profileCards(), store: context.store, client, dryRun: false, now: context.now });
    expect(report.acceptedProfiles).toHaveLength(1);
    expect(report.acceptedProfiles[0]).toMatchObject({ archetype: "CI Fiends", cards: 6, profile: profileFixture });
    expect(report.acceptedProfiles[0].promptHash).toBe(profileRequest.promptHash);
    expect(report.usedMicros).toBe(36);
    const output = join(context.directory, "profiles-candidate");
    const { writeEffectArtifactCandidate } = await import("../artifact-output.js");
    const candidate = writeEffectArtifactCandidate({ root: rootPath, outputDirectory: output, baseSha: "a".repeat(40), accepted: report.accepted, acceptedProfiles: report.acceptedProfiles });
    expect(candidate.files).toContain("packages/shared/data/effects/profiles.jsonl.gz");
    writeFileSync(join(output, "report.json"), JSON.stringify(report));
    const publisherPath = "../../ci/publish-effect-tags.mjs";
    const { validateEffectCandidate } = await import(publisherPath);
    expect(validateEffectCandidate(rootPath, output).changed).toBe(true);
    // Load the newly pinned source in a disposable package, then import into real SQLite.
    const generatedPin = readFileSync(join(output, "packages/shared/src/cards/effects/artifact.ts"));
    cpSync(join(rootPath, "packages/shared/src"), join(output, "packages/shared/src"), { recursive: true });
    writeFileSync(join(output, "packages/shared/src/cards/effects/artifact.ts"), generatedPin);
    writeFileSync(join(output, "package.json"), '{"type":"module"}');
    symlinkSync(join(rootPath, "node_modules"), join(output, "node_modules"), "dir");
    const moduleUrl = pathToFileURL(join(output, "packages/shared/src/cards/effects/artifact.ts")).href;
    const dbUrl = pathToFileURL(join(output, "packages/shared/src/db/connection.ts")).href;
    const imported = JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
      `import { importCardEffectArtifact } from ${JSON.stringify(moduleUrl)}; import { openDatabase } from ${JSON.stringify(dbUrl)}; const db = openDatabase(":memory:"); const report = importCardEffectArtifact(db); console.log(JSON.stringify({profiles: report.profiles, profile: db.prepare("SELECT cards FROM card_tag_profiles WHERE archetype='CI Fiends'").get()})); db.close();`], { cwd: rootPath, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
    expect(imported.profile).toEqual({ cards: 6 });
    expect(imported.profiles).toBe(rowsInPinnedProfiles() + 1);
    const { profileCandidates } = await import("../profile-archetypes.js");
    const rows = gunzipSync(readFileSync(join(output, "packages/shared/data/effects/profiles.jsonl.gz"))).toString("utf8").trim().split("\n").map(line => JSON.parse(line));
    expect(profileCandidates(profileCards(), rows)).toEqual([]);
    expect(profileCandidates(profileCards().map((card, index) => index === 0 ? { ...card, atk: (card.atk ?? 0) + 100 } : card), rows)).toHaveLength(1);
    expect(profileCandidates([...profileCards(), { ...profileCards()[0], id: 123456789 }], rows)).toHaveLength(1);
    // Even recomputed SHA pins must not hide an accepted new profile's missing row.
    writeFileSync(join(output, "packages/shared/data/effects/profiles.jsonl.gz"), gzipSync(Buffer.from(rows.filter(row => row.archetype !== "CI Fiends").map(row => JSON.stringify(row)).join("\n") + "\n")));
    resignCandidate(output);
    expect(() => validateEffectCandidate(rootPath, output)).toThrow(/profile/i);
    const again = await context.runTagging({ cards: profileCards(), store: context.store, client, dryRun: false, now: context.now });
    expect(again.acceptedProfiles).toHaveLength(1); expect(again.submitted).toBe(0);
    expect(api.events.filter(event => event.startsWith("POST"))).toHaveLength(1);
  });

  it("limits combined tag/profile liability to $2 per run even when more work is requested", async () => {
    const context = await setup(), api = await endpoint();
    const client = new context.AnthropicBatchClient({ baseUrl: api.baseUrl, apiKey: "fake", allowLoopback: true });
    const cards = Array.from({ length: 100 }, (_, index) => ({ ...profileCards()[0], id: 10000000 + index, name: `Fixture ${index}`, archetype: `Group ${Math.floor(index / 4)}` }));
    await context.runTagging({ cards, store: context.store, client, dryRun: false, now: context.now, maxRequests: 66 });
    const entries = (await context.store.read())!.ledger.reservations;
    expect(entries.reduce((sum, entry) => sum + entry.reservedMicros, 0)).toBeLessThanOrEqual(2_000_000);
    expect(api.batches[0].requests.length).toBeLessThanOrEqual(7);
  });

  it("settles old Haiku 4.5 reservations without changing their held amount or billing rate", async () => {
    const context = await setup(), api = await endpoint();
    const client = new context.AnthropicBatchClient({ baseUrl: api.baseUrl, apiKey: "fake", allowLoopback: true });
    await context.runTagging({ cards: changedCards(), store: context.store, client, dryRun: false, now: context.now });
    const snapshot = (await context.store.read())!, reservation = snapshot.ledger.reservations[0];
    delete reservation.model; reservation.reservedMicros = 150_000;
    for (const request of api.batches[0].requests) request.params.model = context.LEGACY_MODEL;
    await context.store.compareAndSwap(snapshot.revision, snapshot.ledger);
    const report = await context.runTagging({ cards: changedCards(), store: context.store, client, dryRun: false, now: context.now, maxRequests: 0 });
    expect(report.usedMicros).toBe(175); expect(report.accepted[0].model).toBe(context.LEGACY_MODEL);
    expect(api.events.filter(event => event.startsWith("POST"))).toHaveLength(1);
  });

  it.each([false, true])("publishes truthful model provenance for legacy results (mixed current results: %s)", async mixed => {
    const context = await setup(), api = await endpoint();
    const client = new context.AnthropicBatchClient({ baseUrl: api.baseUrl, apiKey: "fake", allowLoopback: true });
    const cards = changedCards();
    await context.runTagging({ cards: mixed ? cards.slice(0, 3) : cards, store: context.store, client, dryRun: false, now: context.now });
    const snapshot = (await context.store.read())!, reservation = snapshot.ledger.reservations[0];
    delete reservation.model; reservation.reservedMicros = 150_000;
    for (const request of api.batches[0].requests) request.params.model = context.LEGACY_MODEL;
    await context.store.compareAndSwap(snapshot.revision, snapshot.ledger);
    await context.runTagging({ cards, store: context.store, client, dryRun: false, now: context.now });
    const report = await context.runTagging({ cards, store: context.store, client, dryRun: false, now: context.now, maxRequests: 0 });
    expect(report.accepted).toHaveLength(6);
    const output = join(context.directory, "legacy-model-candidate");
    const { writeEffectArtifactCandidate } = await import("../artifact-output.js");
    writeEffectArtifactCandidate({ root: rootPath, outputDirectory: output, baseSha: "a".repeat(40), accepted: report.accepted });
    writeFileSync(join(output, "report.json"), JSON.stringify(report));
    const manifestPath = join(output, "packages/shared/data/effects/manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest.generation.models).toEqual(mixed ? [context.LEGACY_MODEL, context.MODEL].sort() : [context.LEGACY_MODEL]);
    const publisherPath = "../../ci/publish-effect-tags.mjs";
    const { validateEffectCandidate } = await import(publisherPath);
    expect(validateEffectCandidate(rootPath, output).changed).toBe(true);
    // Recomputed pins cannot hide a model omitted from generation provenance.
    manifest.generation.models = [context.MODEL];
    writeFileSync(manifestPath, JSON.stringify(manifest));
    resignCandidate(output);
    expect(() => validateEffectCandidate(rootPath, output)).toThrow(/model/i);
  });

  it("bills invalid profiles, defers only unchanged inputs, and reserves enough for the highest price tier", async () => {
    const context = await setup(), api = await endpoint({ badProfile: true });
    const client = new context.AnthropicBatchClient({ baseUrl: api.baseUrl, apiKey: "fake", allowLoopback: true });
    await context.runTagging({ cards: profileCards(), store: context.store, client, dryRun: false, now: context.now });
    const report = await context.runTagging({ cards: profileCards(), store: context.store, client, dryRun: false, now: context.now });
    expect(report.acceptedProfiles).toEqual([]); expect(report.usedMicros).toBe(36);
    expect(report.submitted).toBe(0);
    expect((await context.store.read())!.ledger.reservations[0].profileFailures).toEqual(["CI Fiends"]);
    const revised = profileCards().map((card, index) => index === 0 ? { ...card, atk: (card.atk ?? 0) + 100 } : card);
    const retried = await context.runTagging({ cards: revised, store: context.store, client, dryRun: false, now: context.now, maxRequests: 1 });
    expect(retried.submitted).toBe(1);
    expect(retried.deferred).not.toContain("failed-output-this-month");
    expect(api.batches[1].requests).toHaveLength(1);
    expect(api.batches[1].requests[0].params.output_config.format.schema.properties).toHaveProperty("plan");
    const failedAgain = await context.runTagging({ cards: revised, store: context.store, client, dryRun: false, now: context.now });
    expect(failedAgain.submitted).toBe(0); expect(failedAgain.usedMicros).toBe(54);
    const originalAgain = await context.runTagging({ cards: profileCards(), store: context.store, client, dryRun: false, now: context.now });
    expect(originalAgain.submitted).toBe(0);
    expect(api.events.filter(event => event.startsWith("POST"))).toHaveLength(2);
    expect(context.billedMicros(context.MODEL, 100_000, 20_000)).toBe(10_000);
    expect(context.billedMicros(context.MODEL, 100_001, 20_000)).toBe(50_001);
    expect(context.billedMicros(context.MODEL, context.MAX_INPUT_TOKENS, context.MAX_OUTPUT_TOKENS)).toBe(context.REQUEST_RESERVATION_MICROS);
  });

  it("resizes never-submitted legacy reservations before intent without blocking future months", async () => {
    const context = await setup(), api = await endpoint();
    const client = new context.AnthropicBatchClient({ baseUrl: api.baseUrl, apiKey: "fake", allowLoopback: true });
    let writes = 0;
    const crashingStore = { read: () => context.store.read(), compareAndSwap: async (revision: string | undefined, ledger: import("../budget-ledger.js").Ledger) => {
      if (++writes === 2) throw new Error("Crash before submission intent");
      return context.store.compareAndSwap(revision, ledger);
    } };
    await expect(context.runTagging({ cards: changedCards(), store: crashingStore, client, dryRun: false, now: context.now })).rejects.toThrow(/before submission/);
    expect(api.events).toEqual([]);
    const snapshot = (await context.store.read())!, reservation = snapshot.ledger.reservations[0];
    delete reservation.model; reservation.state = "reserved";
    reservation.requests = Array.from({ length: 66 }, (_, index) => ({ ...reservation.requests[0], customId: `legacy_${index}` }));
    reservation.reservedMicros = 9_900_000;
    await context.store.compareAndSwap(snapshot.revision, snapshot.ledger);
    const resumedApi = await endpoint(), resumedClient = new context.AnthropicBatchClient({ baseUrl: resumedApi.baseUrl, apiKey: "fake", allowLoopback: true });
    const report = await context.runTagging({ cards: changedCards(), store: context.store, client: resumedClient, dryRun: false, now: context.now });
    expect(report.submitted).toBe(1);
    expect(report.usedMicros).toBeLessThanOrEqual(2_000_000);
    expect(resumedApi.batches[0].requests).toHaveLength(7);
  });

  it.each(["hash", "legacy", "mismatch"] as const)("resumes durable profile prompts safely after restart (%s)", async kind => {
    const context = await setup(), api = await endpoint();
    const client = new context.AnthropicBatchClient({ baseUrl: api.baseUrl, apiKey: "fake", allowLoopback: true });
    let writes = 0;
    const crashingStore = { read: () => context.store.read(), compareAndSwap: async (revision: string | undefined, ledger: import("../budget-ledger.js").Ledger) => {
      if (++writes === 2) throw new Error("Crash before submission intent");
      return context.store.compareAndSwap(revision, ledger);
    } };
    await expect(context.runTagging({ cards: profileCards(), store: crashingStore, client, dryRun: false, now: context.now })).rejects.toThrow(/before submission/);
    const snapshot = (await context.store.read())!, request = snapshot.ledger.reservations[0].requests.find(request => request.archetype)!;
    const { buildSynergyPrompt } = await import("../synergy-prompt.js");
    let expectedPrompt = buildSynergyPrompt();
    expect(request).not.toHaveProperty("systemPrompt");
    expect(request.promptHash).toBe(createHash("sha256").update(expectedPrompt).digest("hex"));
    if (kind === "legacy") {
      request.systemPrompt = expectedPrompt = `Historical profile instructions.\n${expectedPrompt}`;
      delete request.promptHash;
    } else if (kind === "mismatch") request.promptHash = "0".repeat(64);
    await context.store.compareAndSwap(snapshot.revision, snapshot.ledger);
    const reopened = new context.FileLedgerStore(join(context.directory, "ledger.json"));
    if (kind === "mismatch") {
      const before = await reopened.read();
      await expect(context.runTagging({ cards: profileCards(), store: reopened, client, dryRun: false, now: context.now })).rejects.toThrow(/profile prompt hash/i);
      expect(await reopened.read()).toEqual(before);
      expect(api.events).toEqual([]);
      return;
    }
    await context.runTagging({ cards: profileCards(), store: reopened, client, dryRun: false, now: context.now });
    expect(api.batches[0].requests.find(request => request.params.output_config.format.schema.properties.plan)!.params.system).toBe(expectedPrompt);
    const report = await context.runTagging({ cards: profileCards(), store: reopened, client, dryRun: false, now: context.now, maxRequests: 0 });
    expect(report.acceptedProfiles[0].promptHash).toBe(createHash("sha256").update(expectedPrompt).digest("hex"));
    expect(api.events.filter(event => event.startsWith("POST"))).toHaveLength(1);
  });


});


it('shares the monthly cap with settled runtime spend and uncertain runtime reservations', async () => {
  const context = await setup();
  const { READING_RESERVATION_MICROS, budgetUsed } = await import('../budget-ledger.js');
  const snapshot = (await context.store.read())!;
  snapshot.ledger.runtime = Array.from({ length: 20 }, (_, i) => ({
    id: i.toString(16).padStart(32, '0'), model: 'claude-haiku-5-5' as const,
    month: '2026-10', createdAt: '2026-10-10T12:00:00Z', phraseHash: 'a'.repeat(64),
    state: i === 19 ? 'settled' as const : 'submission_started' as const,
    reservedMicros: READING_RESERVATION_MICROS,
    ...(i === 19 ? { actualMicros: 400_000, messageId: 'msg_settled' } : {}),
  }));
  snapshot.ledger.months['2026-10'] = 400_000;
  await context.store.compareAndSwap(snapshot.revision, snapshot.ledger);
  expect(budgetUsed((await context.store.read())!.ledger, '2026-10')).toBe(9_948_640);
  let posts = 0;
  const report = await context.runTagging({ cards: changedCards(), store: context.store, dryRun: false, now: context.now,
    client: { create: async () => { posts++; throw new Error('Must not spend'); }, retrieve: async () => { throw new Error('No batches'); }, results: async () => [] },
  });
  expect(report.deferred).toContain('monthly-budget');
  expect(posts).toBe(0);
});
