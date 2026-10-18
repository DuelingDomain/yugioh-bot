import { createServer, type Server } from "node:http";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import type { Card } from "@yugidraft/shared/cards/effects";
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
async function setup(now = "2026-10-10T12:00:00Z") {
  const ledger = await import("../budget-ledger.js");
  const { runTagging } = await import("../tag-cards.js");
  const { AnthropicBatchClient } = await import("../batch-client.js");
  const directory = mkdtempSync(join(tmpdir(), "effect-batch-integration-")); roots.push(directory);
  const store = new ledger.FileLedgerStore(join(directory, "ledger.json"));
  await store.compareAndSwap(undefined, ledger.createEmptyLedger());
  return { ...ledger, directory, store, runTagging, AnthropicBatchClient, now: () => new Date(now) };
}
async function endpoint(options: { uncertain?: boolean; badTags?: boolean; partial?: boolean; duplicate?: boolean; processing?: boolean; onSubmit?: () => Promise<void> } = {}) {
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
        return { custom_id: req.custom_id, result: { type: "succeeded", message: { model: "claude-haiku-4-5-20251001", stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 50 }, content: [{ type: "text", text: options.badTags ? "not JSON" : JSON.stringify({ cards }) }] } } };
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

describe("Haiku Batch tagging against a fake HTTP endpoint and durable ledger", () => {
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
    expect(recovered.months["2026-10"]).toBe(175);
    expect(recovered.reservations[0]).toMatchObject({ state: "settled", batchId: "msgbatch_fixture_1", actualMicros: 175 });
    expect(recovered.reservations[0].accepted).toHaveLength(6);
    expect(api.events.filter(event => event.startsWith("POST"))).toHaveLength(1);
  });

  it("durably reserves before HTTP, collects validated tags, and reuses results before PR merge", async () => {
    const context = await setup(), api = await endpoint({ onSubmit: async () => {
      expect((await context.store.read())!.ledger.reservations[0]).toMatchObject({ state: "submission_started", reservedMicros: 150_000 });
    } });
    const client = new context.AnthropicBatchClient({ baseUrl: api.baseUrl, apiKey: "fake", allowLoopback: true });
    const first = await context.runTagging({ cards: changedCards(), store: context.store, client, dryRun: false, now: context.now });
    expect(first.submitted).toBe(1);
    const durable = (await context.store.read())!.ledger;
    expect(durable.reservations[0]).toMatchObject({ state: "submitted", reservedMicros: 150_000, batchId: "msgbatch_fixture_1" });
    const params = api.batches[0].requests[0].params;
    expect(params.model).toBe("claude-haiku-4-5-20251001"); expect(params.max_tokens).toBe(20_000);
    for (const key of ["thinking", "tools", "cache_control"]) expect(params).not.toHaveProperty(key);
    expect(params.output_config).not.toHaveProperty("effort");
    const second = await context.runTagging({ cards: changedCards(), store: context.store, client, dryRun: false, now: context.now });
    expect(second.accepted).toHaveLength(6); expect(second.submitted).toBe(0); expect(second.usedMicros).toBe(175);
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
    expect(report.usedMicros).toBe(150_000); expect(report.submitted).toBe(0);
    expect(api.events.filter(event => event.startsWith("POST"))).toHaveLength(1);
  });

  it.each([{ partial: true }, { duplicate: true }])("holds the entire reservation for incomplete or duplicate results (%j)", async failure => {
    const context = await setup(), api = await endpoint(failure);
    const client = new context.AnthropicBatchClient({ baseUrl: api.baseUrl, apiKey: "fake", allowLoopback: true });
    await context.runTagging({ cards: changedCards(), store: context.store, client, dryRun: false, now: context.now });
    await expect(context.runTagging({ cards: changedCards(), store: context.store, client, dryRun: false, now: context.now })).rejects.toThrow(/results|duplicate|incomplete/i);
    expect((await context.store.read())!.ledger.reservations[0]).toMatchObject({ state: "submitted", reservedMicros: 150_000 });
  });

  it("settles billed usage even when every returned tag fails validation", async () => {
    const context = await setup(), api = await endpoint({ badTags: true });
    const client = new context.AnthropicBatchClient({ baseUrl: api.baseUrl, apiKey: "fake", allowLoopback: true });
    await context.runTagging({ cards: changedCards(), store: context.store, client, dryRun: false, now: context.now });
    const report = await context.runTagging({ cards: changedCards(), store: context.store, client, dryRun: false, now: context.now, maxRequests: 0 });
    expect(report.accepted).toEqual([]); expect(report.usedMicros).toBe(175);
    expect((await context.store.read())!.ledger.reservations[0]).toMatchObject({ state: "settled", actualMicros: 175 });
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
    for (const months of [{}, { "2026-10": 0 }, { "2026-10": 176 }, { "2026-10": 175, "2026-11": 0 }]) {
      writeFileSync(join(history.directory, "ledger.json"), JSON.stringify({ ...valid, months }));
      const store = { read: () => history.store.read(), compareAndSwap: async () => { writes++; throw new Error("Unexpected write"); } };
      await expect(history.runTagging({ cards: changedCards(), store, client, dryRun: false, now: history.now })).rejects.toThrow(/monthly|totals|ledger/i);
    }
    expect(api.events).toEqual([]); expect(writes).toBe(0);
  });

  it("writes a reviewable next pin with actual tagged-input hashes and unchanged profiles/popularity", async () => {
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
    expect(manifest.generation).toMatchObject({ model: "claude-haiku-4-5-20251001", acceptedCards: 6 });
    const sidecar = JSON.parse(gunzipSync(readFileSync(join(output, "packages/shared/data/effects/source-hashes.json.gz"))).toString("utf8"));
    expect(sidecar.hashes[14558127]).toBe(hashCardEffectSourceText(changedCards()[0]));
    for (const file of ["profiles.jsonl.gz", "popularity.json.gz"]) {
      expect(readFileSync(join(output, "packages/shared/data/effects", file))).toEqual(readFileSync(join(rootPath, "packages/shared/data/effects", file)));
    }
    expect(readFileSync(join(output, "packages/shared/src/cards/effects/artifact.ts"), "utf8")).toContain(manifest.artifactVersion);
    expect(readFileSync(join(rootPath, "packages/shared/src/cards/effects/artifact.ts"), "utf8")).toBe(original);
    writeFileSync(join(output, "report.json"), JSON.stringify(report));
    const publisherPath = "../../ci/publish-effect-tags.mjs";
    const { validateEffectCandidate } = await import(publisherPath);
    expect(validateEffectCandidate(rootPath, output).changed).toBe(true);
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
  });
});
