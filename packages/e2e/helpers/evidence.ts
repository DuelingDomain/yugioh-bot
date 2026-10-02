import type { BrowserContext, Page, TestInfo, WebSocket } from "@playwright/test";
import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { relative } from "node:path";
import { dbPath, duelDataDir, repoRoot, stackLogFile } from "../stack/env.mjs";
import { playerName, type PlayerKey } from "./players";
import { NumberCapture } from "./leaks";
import { browserEntries, journalEntries, mergeTimeline, oneLine, renderTimelineMarkdown, stackEntry, type TimelineEntry } from "./timeline";

// Failure evidence. `PlayerEvidence` listens to every page of one player context for the whole test.
// Nothing is written while the test passes (unless E2E_EVIDENCE=always). `attachFailureEvidence` runs once for a failed test and writes
// the recorded events, the duel state, the duel journal and the stack log next to the test results.

const CONSOLE_MAX = 1000;
const PAGE_ERROR_MAX = 200;
const REQUEST_MAX = 500;
const FRAME_MAX = 2000;
const FRAME_TEXT_MAX = 1500;
const BINARY_MAX = 4096;
const TEXT_MAX = 2000;
const STACK_LOG_MAX_LINES = 3000;
/** Hard cap for the whole collection, so a hung page cannot hold the test teardown. */
const COLLECT_MAX_MS = 25_000;
/** The stack supervisor writes its log asynchronously. */
const LOG_FLUSH_MS = 400;

/** Keeps the newest `max` entries and counts what it dropped. */
class Ring<T> {
  items: T[] = [];
  dropped = 0;
  constructor(private readonly max: number) {}
  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.max) {
      this.items.shift();
      this.dropped += 1;
    }
  }
}

function clip(text: string, max = TEXT_MAX): string {
  return text.length > max ? `${text.slice(0, max)}...[+${text.length - max} chars]` : text;
}

type Stamp = { at: string; ms: number };

export class PlayerEvidence {
  readonly console = new Ring<Stamp & { page: number; type: string; text: string; source: string }>(CONSOLE_MAX);
  readonly pageErrors = new Ring<Stamp & { page: number; message: string; stack?: string }>(PAGE_ERROR_MAX);
  readonly requests = new Ring<Stamp & { page: number; kind: "failed" | "http-error"; method: string; url: string; detail: string }>(REQUEST_MAX);
  readonly frames = new Ring<Stamp & { page: number; socket: number; event: "open" | "sent" | "received" | "close" | "error"; url?: string; bytes?: number; payload?: string; base64?: string; truncated?: boolean }>(FRAME_MAX);
  /** Duel slugs this player talked to, in order of first use. */
  readonly slugs: string[] = [];
  /** Every 5 to 10 digit number that reached this player in a WebSocket frame or a room JSON. See helpers/leaks.ts. */
  readonly numbers = new NumberCapture();
  /** What the last room read said about this player. */
  lastRole: string | null = null;
  lastSeat: number | null = null;
  private readonly pages: Page[] = [];
  private socketCount = 0;

  constructor(
    readonly key: PlayerKey,
    readonly context: BrowserContext,
    readonly startedAt: number,
  ) {
    context.on("page", (page) => this.watch(page));
  }

  private stamp(): Stamp {
    const now = Date.now();
    return { at: new Date(now).toISOString(), ms: now - this.startedAt };
  }

  private noteSlug(url: string): void {
    const match = /\/(?:api\/)?duels\/([^/?#]+)/.exec(new URL(url, "http://x").pathname);
    const slug = match?.[1];
    if (slug && !["new", "cards", "client-error"].includes(slug) && !this.slugs.includes(slug)) this.slugs.push(slug);
  }

  private watch(page: Page): void {
    const id = this.pages.push(page);
    page.on("console", (message) => {
      const where = message.location();
      this.console.push({ ...this.stamp(), page: id, type: message.type(), text: clip(message.text()), source: where.url ? `${where.url}:${where.lineNumber}` : "" });
    });
    page.on("pageerror", (error) => this.pageErrors.push({ ...this.stamp(), page: id, message: clip(error.message), stack: error.stack ? clip(error.stack) : undefined }));
    page.on("request", (request) => this.noteSlug(request.url()));
    page.on("requestfailed", (request) =>
      this.requests.push({ ...this.stamp(), page: id, kind: "failed", method: request.method(), url: request.url(), detail: request.failure()?.errorText ?? "" }),
    );
    page.on("response", (response) => {
      // The room JSON is what the page polls. The leak scan reads all of it, not only the last poll.
      const pathname = new URL(response.url()).pathname;
      if (response.status() < 400 && response.request().method() === "GET" && /^\/api\/duels\/[^/]+$/.test(pathname) && !/\/(cards|client-error)$/.test(pathname)) {
        const stamp = this.stamp();
        void response.text().then(
          (body) => {
            try {
              this.numbers.addRoom(JSON.parse(body), stamp.at, stamp.ms);
            } catch {
              // Not JSON: nothing to scan.
            }
          },
          () => undefined,
        );
      }
      if (response.status() < 400) return;
      const request = response.request();
      const stamp = this.stamp();
      // The duel APIs answer `{ "error": "..." }`. The text is the reason the page shows.
      void response.text().then(
        (body) => this.requests.push({ ...stamp, page: id, kind: "http-error", method: request.method(), url: response.url(), detail: `${response.status()} ${clip(body, 500)}` }),
        () => this.requests.push({ ...stamp, page: id, kind: "http-error", method: request.method(), url: response.url(), detail: `${response.status()}` }),
      );
    });
    page.on("websocket", (socket) => this.watchSocket(socket, id));
  }

  private watchSocket(socket: WebSocket, page: number): void {
    const id = (this.socketCount += 1);
    const base = { page, socket: id };
    this.frames.push({ ...this.stamp(), ...base, event: "open", url: socket.url() });
    const frame = (event: "sent" | "received") => (data: { payload: string | Buffer }) => {
      const { payload } = data;
      // Engine.IO ping and pong frames are one character and carry nothing.
      if (payload === "2" || payload === "3") return;
      const binary = typeof payload !== "string";
      // Scan the whole frame. The stored text below is clipped.
      if (event === "received" && !binary) {
        const stamp = this.stamp();
        this.numbers.add(payload, "ws", stamp.at, stamp.ms);
      }
      this.frames.push({
        ...this.stamp(),
        ...base,
        event,
        bytes: binary ? payload.length : Buffer.byteLength(payload),
        payload: binary ? `<binary ${payload.length} bytes>` : clip(payload, FRAME_TEXT_MAX),
        // A binary payload is kept as base64 (at most BINARY_MAX bytes) so it can be decoded later.
        ...(binary ? { base64: payload.subarray(0, BINARY_MAX).toString("base64"), truncated: payload.length > BINARY_MAX } : {}),
      });
    };
    socket.on("framesent", frame("sent"));
    socket.on("framereceived", frame("received"));
    socket.on("socketerror", (error) => this.frames.push({ ...this.stamp(), ...base, event: "error", payload: clip(String(error)) }));
    socket.on("close", () => this.frames.push({ ...this.stamp(), ...base, event: "close" }));
  }

  /** The duel this player is in: the room the page shows now, else the last duel API the page called. */
  currentSlug(): string | null {
    for (const page of [...this.pages].reverse()) {
      if (page.isClosed()) continue;
      const match = /^\/duels\/([^/?#]+)$/.exec(new URL(page.url(), "http://x").pathname);
      if (match && match[1] !== "new") return match[1];
    }
    return this.slugs.at(-1) ?? null;
  }

  events() {
    return {
      player: this.key,
      name: playerName(this.key),
      slugs: this.slugs,
      pages: this.pages.map((page, index) => ({ page: index + 1, url: page.isClosed() ? "(closed)" : page.url() })),
      dropped: { console: this.console.dropped, pageErrors: this.pageErrors.dropped, requests: this.requests.dropped, frames: this.frames.dropped },
      console: this.console.items,
      pageErrors: this.pageErrors.items,
      requests: this.requests.items,
      frames: this.frames.items,
    };
  }

  /** What each open page shows, as text. Helps when the screenshot is cut off. */
  async pageTexts() {
    return Promise.all(
      this.pages.map(async (page, index) => {
        if (page.isClosed()) return { page: index + 1, url: "(closed)" };
        const text = await page.locator("body").innerText({ timeout: 3000 }).catch((error: unknown) => `(unreadable: ${String(error).slice(0, 200)})`);
        return { page: index + 1, url: page.url(), title: await page.title().catch(() => ""), text: clip(text, 6000) };
      }),
    );
  }

  /** A screenshot of every open page, written to `dir`. Returns the file names. A hung page is skipped after 5 s. */
  async screenshots(dir: string, prefix: string): Promise<string[]> {
    const done = await Promise.all(
      this.pages.map(async (page, index) => {
        if (page.isClosed()) return null;
        const name = `${prefix}-${this.key}-page${index + 1}.png`;
        try {
          await page.screenshot({ path: `${dir}/${name}`, timeout: 5000, animations: "disabled" });
          return name;
        } catch {
          return null;
        }
      }),
    );
    return done.filter((name): name is string => name !== null);
  }

  /** The room JSON the duel page polls (`/api/duels/<slug>`): seats, open prompt, board, log. */
  async room(slug: string): Promise<{ status: number; body: unknown } | { error: string }> {
    try {
      const response = await this.context.request.get(`/api/duels/${encodeURIComponent(slug)}`, { timeout: 5000 });
      const body = (await response.json().catch(async () => clip(await response.text().catch(() => "")))) as unknown;
      if (body && typeof body === "object") {
        const room = body as RoomBody;
        this.lastRole = room.role ?? null;
        this.lastSeat = room.mySeat ?? null;
        const stamp = this.stamp();
        this.numbers.addRoom(body, stamp.at, stamp.ms);
      }
      return { status: response.status(), body };
    } catch (error) {
      return { error: String(error).slice(0, 500) };
    }
  }
}

export type RoomBody = {
  session?: { id?: number; name?: string; slug?: string; status?: string; mode?: string; format?: string; masterRule?: number; resultReason?: string | null; winnerSeat?: number | null; winnerTeam?: number | null; seats?: Array<{ seat: number; displayName: string; isBot: boolean; ready: boolean; team?: number; eliminated?: boolean }> };
  role?: string;
  mySeat?: number | null;
  engine?: {
    revision?: number;
    format?: string;
    turn?: number;
    turnSeat?: number;
    phase?: string;
    seats?: Array<{ seat: number; lp: number; team?: number; eliminated?: boolean }>;
    prompt?: { id: string; seat: number; kind: string; title: string; description?: string; options?: Array<{ label?: string }> } | null;
    log?: Array<{ id: number; text: string }>;
    result?: { winnerSeat: number | null; winnerTeam?: number | null; reason: string } | null;
  } | null;
};

export function roomBody(room: Awaited<ReturnType<PlayerEvidence["room"]>>): RoomBody | null {
  return "body" in room && room.body && typeof room.body === "object" ? (room.body as RoomBody) : null;
}

export interface Journal {
  format: "yugidraft-duel-journal/1";
  slug: string;
  name: string;
  mode: string;
  /** Table format: 1v1, tag, ffa3 or ffa4. (`format` above names the journal file format.) */
  tableFormat: string;
  /** The duel setup (surrendered seats and other saved state). */
  setup: unknown;
  /** SHA-256 of each engine wasm in the duel data directory. */
  wasmSha256: Record<string, string>;
  masterRule: number;
  status: string;
  winnerSeat: number | null;
  resultReason: string | null;
  createdAt: string;
  endedAt: string | null;
  bundleVersion: string | null;
  seed: string[] | null;
  settings: unknown;
  seats: Array<{ seat: number; playerId: number | null; isBot: boolean; discordId: string | null }>;
  decks: unknown[];
  commands: Array<{ seq: number; seat: number; at: string; command: unknown }>;
}

/**
 * The answers of one duel as the duel host stored them. The host keeps them in the shared SQLite file
 * (tables `duels`, `duel_seats`, `duel_commands`): seed, decks, settings and every accepted answer.
 * The E2E stack has its own file, so reading it needs no host endpoint. The file is opened read-only.
 * `packages/duel-server/scripts/replay-journal.ts` replays this format in the engine.
 */
/** SHA-256 of each engine wasm in the duel data directory, so a replay can say which core made the duel. */
function wasmHashes(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of ["ocgcore.standard.wasm", "ocgcore.domain.wasm", "ocgcore.multi.wasm", "ocgcore.multi-domain.wasm"]) {
    const file = `${duelDataDir}/${name}`;
    if (existsSync(file)) out[name] = createHash("sha256").update(readFileSync(file)).digest("hex");
  }
  return out;
}

export function readJournal(slug: string): Journal | { error: string } {
  if (!existsSync(dbPath)) return { error: `no database at ${dbPath}` };
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const duel = db
      .prepare("select id, web_slug, name, mode, format, setup_json, master_rule, status, seed_json, bundle_version, settings_json, winner_seat, result_reason, created_at, ended_at from duels where web_slug = ?")
      .get(slug) as undefined | { id: number; web_slug: string; name: string; mode: string; format: string | null; setup_json: string | null; master_rule: number; status: string; seed_json: string | null; bundle_version: string | null; settings_json: string | null; winner_seat: number | null; result_reason: string | null; created_at: string; ended_at: string | null };
    if (!duel) return { error: `no duel with slug ${slug}` };
    const seats = db
      .prepare("select s.seat, s.player_id, s.is_bot, s.deck_json, p.discord_user_id as discord_id from duel_seats s left join players p on p.id = s.player_id where s.duel_id = ? order by s.seat")
      .all(duel.id) as Array<{ seat: number; player_id: number | null; is_bot: number; deck_json: string | null; discord_id: string | null }>;
    const commands = db.prepare("select seq, seat, command_json, created_at from duel_commands where duel_id = ? order by seq").all(duel.id) as Array<{ seq: number; seat: number; command_json: string; created_at: string }>;
    return {
      format: "yugidraft-duel-journal/1",
      slug: duel.web_slug,
      name: duel.name,
      mode: duel.mode,
      tableFormat: duel.format ?? "1v1",
      setup: duel.setup_json ? (JSON.parse(duel.setup_json) as unknown) : null,
      wasmSha256: wasmHashes(),
      masterRule: duel.master_rule,
      status: duel.status,
      winnerSeat: duel.winner_seat,
      resultReason: duel.result_reason,
      createdAt: duel.created_at,
      endedAt: duel.ended_at,
      bundleVersion: duel.bundle_version,
      seed: duel.seed_json ? (JSON.parse(duel.seed_json) as string[]) : null,
      settings: duel.settings_json ? (JSON.parse(duel.settings_json) as unknown) : null,
      seats: seats.map((seat) => ({ seat: seat.seat, playerId: seat.player_id, isBot: seat.is_bot === 1, discordId: seat.discord_id })),
      decks: seats.map((seat) => (seat.deck_json ? (JSON.parse(seat.deck_json) as unknown) : null)),
      commands: commands.map((row) => ({ seq: row.seq, seat: row.seat, at: row.created_at, command: JSON.parse(row.command_json) as unknown })),
    };
  } catch (error) {
    return { error: String(error).slice(0, 500) };
  } finally {
    db.close();
  }
}

/** Lines of the stack log between two instants. Each line starts with an ISO timestamp, so text order is time order. */
export function stackLogLines(fromIso: string, toIso: string): string[] | null {
  if (!existsSync(stackLogFile)) return null;
  const lines = readFileSync(stackLogFile, "utf8").split("\n").filter((line) => line && line.slice(0, 24) >= fromIso && line.slice(0, 24) <= toIso);
  return lines.length > STACK_LOG_MAX_LINES ? lines.slice(-STACK_LOG_MAX_LINES) : lines;
}

/**
 * Writes every piece of failure evidence under the test output folder and attaches it to the test result.
 * Files: evidence-<key>.json, duel-state-<key>.json, duel-journal-<slug>.json, stack-log.txt, failure-summary.json.
 * The Playwright trace, screenshot and video are added next to them by Playwright itself.
 */
export interface EvidenceExtras {
  /** Timeline lines from the stall watcher (revision changes, the stall itself). */
  notes: TimelineEntry[];
  /** Errors the fixture found (a stall, a leak). They are not in `testInfo.errors` yet. */
  errors: string[];
  /** Write the files here instead of `<test output>/evidence`. The multi-seat preset runs use this. */
  outDir?: string;
  /** The scenario preset id of the test. Goes into failure-summary.json; omitted when the test has no preset. */
  presetId?: string;
}

export async function attachFailureEvidence(testInfo: TestInfo, recorders: PlayerEvidence[], extras: EvidenceExtras = { notes: [], errors: [] }): Promise<void> {
  if (recorders.length === 0) return;
  const work = collect(testInfo, recorders, extras);
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<void>((done) => {
    timer = setTimeout(done, COLLECT_MAX_MS);
  });
  try {
    await Promise.race([work, limit]);
  } finally {
    clearTimeout(timer);
  }
}

async function collect(testInfo: TestInfo, recorders: PlayerEvidence[], extras: EvidenceExtras): Promise<void> {
  const endedAt = new Date();
  // TestInfo has no public start time. The fixture passes it to every recorder.
  const startedAt = new Date(recorders[0]!.startedAt);
  const dir = extras.outDir ?? testInfo.outputPath("evidence");
  mkdirSync(dir, { recursive: true });
  const written: Record<string, string> = {};
  const save = async (name: string, body: string, contentType: string) => {
    const path = `${dir}/${name}`;
    writeFileSync(path, body);
    written[name] = relative(process.cwd(), path);
    await testInfo.attach(name, { path, contentType });
  };
  const json = (value: unknown) => JSON.stringify(value, null, 1);

  // One screenshot of every open page of every player (a stall already wrote its own).
  const shots = (await Promise.all(recorders.map((recorder) => recorder.screenshots(dir, "failure")))).flat();
  for (const name of shots) await testInfo.attach(name, { path: `${dir}/${name}`, contentType: "image/png" });
  if (shots.length) written["screenshots"] = shots.join(", ");

  const players: Array<Record<string, unknown>> = [];
  const duels = new Map<string, { seats?: unknown; session?: RoomBody["session"]; log?: Array<{ id: number; text: string }> }>();
  for (const recorder of recorders) {
    const slug = recorder.currentSlug();
    const room = slug ? await recorder.room(slug) : { error: "this player never opened a duel" };
    const body = roomBody(room);
    // Opt-in read-only diagnostics for owner-rule investigations; never answer a prompt.
    const page = recorder.context.pages()[0];
    if (slug && page && process.env.E2E_PROMPT_TRACE === "1") {
      try {
        const { readTableTrace } = await import("./table");
        await save(`prompt-trace-${recorder.key}.json`, json(await readTableTrace(page, slug)), "application/json");
      } catch { /* Keep the original test failure if the debug endpoint is unavailable. */ }
    }

    const prompt = body?.engine?.prompt ?? null;
    if (slug && body && !duels.has(slug)) duels.set(slug, { session: body.session, log: body.engine?.log });
    players.push({
      player: recorder.key,
      name: playerName(recorder.key),
      slug,
      role: body?.role ?? null,
      seat: body?.mySeat ?? null,
      turn: body?.engine?.turn ?? null,
      phase: body?.engine?.phase ?? null,
      revision: body?.engine?.revision ?? null,
      openPrompt: prompt && { id: prompt.id, seat: prompt.seat, kind: prompt.kind, title: prompt.title, description: prompt.description, options: prompt.options?.slice(0, 12).map((option) => option.label) },
    });
    await save(`evidence-${recorder.key}.json`, json(recorder.events()), "application/json");
    await save(
      `duel-state-${recorder.key}.json`,
      json({ player: recorder.key, slug, fetchedAt: new Date().toISOString(), room, pages: await recorder.pageTexts() }),
      "application/json",
    );
  }

  // Extra duels a player visited but does not show now (a test can move between tables) also get a journal.
  const slugs = new Set<string>([...duels.keys(), ...recorders.flatMap((recorder) => recorder.slugs)]);
  const journals: Array<{ slug: string; journal: ReturnType<typeof readJournal> }> = [];
  for (const slug of slugs) {
    const journal = readJournal(slug);
    journals.push({ slug, journal });
    await save(`duel-journal-${slug}.json`, json(journal), "application/json");
  }

  await new Promise((done) => setTimeout(done, LOG_FLUSH_MS));
  const stackLines = stackLogLines(startedAt.toISOString(), endedAt.toISOString());
  await save("stack-log.txt", stackLines ? stackLines.join("\n") + "\n" : "(no stack log file: was the stack started by stack/start.mjs?)\n", "text/plain");

  const presetId = extras.presetId ?? testInfo.annotations.find((note) => note.type === "presetId")?.description;
  const presetField = presetId ? { presetId } : {};
  const summary = {
    test: {
      title: testInfo.titlePath.slice(1).join(" > "),
      file: testInfo.file,
      status: testInfo.status,
      expectedStatus: testInfo.expectedStatus,
      retry: testInfo.retry,
      startedAt: startedAt.toISOString(),
      durationMs: testInfo.duration,
      errors: [...testInfo.errors.map((error) => clip(error.message ?? String(error.value), 3000)), ...extras.errors.map((error) => clip(error, 3000))],
    },
    duels: journals.map(({ slug, journal }) => {
      const known = duels.get(slug);
      return {
        slug,
        table: known?.session?.name ?? ("name" in journal ? journal.name : null),
        duelId: known?.session?.id ?? null,
        status: known?.session?.status ?? ("status" in journal ? journal.status : null),
        result: known?.session ? { winnerSeat: known.session.winnerSeat, reason: known.session.resultReason } : null,
        seats: (known?.session?.seats ?? []).map((seat) => ({
          seat: seat.seat,
          name: seat.displayName,
          isBot: seat.isBot,
          playerKey: recorders.find((recorder) => playerName(recorder.key) === seat.displayName)?.key ?? null,
        })),
        acceptedAnswers: "commands" in journal ? journal.commands.length : null,
        lastAnswerPerSeat: lastJournalCommands(journal),
        lastLog: (known?.log ?? []).slice(-20).map((entry) => entry.text),
        replay: "commands" in journal ? `npx tsx packages/duel-server/scripts/replay-journal.ts ${relative(repoRoot, `${dir}/duel-journal-${slug}.json`)} --views` : null,
      };
    }),
    ...presetField,
    players,
    attachments: written,
    alongside: `Playwright adds trace.zip, test-failed-N.png and video.webm in ${relative(process.cwd(), testInfo.outputDir)}`,
  };
  await save("failure-summary.json", json(summary), "application/json");
  await saveTimeline({ testInfo, recorders, journals, stackLines: stackLines ?? [], extras, endedAt, save });
}

/** Per seat, the newest accepted answer of a duel journal. */
export function lastJournalCommands(journal: ReturnType<typeof readJournal>): Array<{ seat: number; last: unknown }> {
  if (!("commands" in journal)) return [];
  const bySeat = new Map<number, unknown>();
  for (const entry of journal.commands) bySeat.set(entry.seat, { seq: entry.seq, at: entry.at, ...(entry.command as object) });
  return [...bySeat].map(([seat, last]) => ({ seat, last }));
}

/** The newest `count` stack log lines since `sinceIso`. */
export function stackTail(sinceIso: string, count: number): string[] {
  return (stackLogLines(sinceIso, new Date().toISOString()) ?? []).slice(-count);
}

/**
 * timeline.json and timeline.md: every player's browser events, the stack log, the journal answers and the
 * watcher notes in ONE list, oldest first. The first lines of timeline.md name the first error and the last progress point.
 */
async function saveTimeline(input: {
  testInfo: TestInfo;
  recorders: PlayerEvidence[];
  journals: Array<{ slug: string; journal: ReturnType<typeof readJournal> }>;
  stackLines: string[];
  extras: EvidenceExtras;
  endedAt: Date;
  save: (name: string, body: string, contentType: string) => Promise<void>;
}): Promise<void> {
  const { testInfo, recorders, journals, stackLines, extras, endedAt, save } = input;
  const errors = [...testInfo.errors.map((error) => error.message ?? String(error.value)), ...extras.errors];
  const lists: TimelineEntry[][] = [];
  for (const recorder of recorders) {
    const events = recorder.events();
    lists.push(browserEntries({ player: recorder.key, console: events.console, pageErrors: events.pageErrors, requests: events.requests, frames: events.frames as never }));
  }
  lists.push(stackLines.flatMap((line) => stackEntry(line) ?? []));
  for (const { slug, journal } of journals) if ("commands" in journal) lists.push(journalEntries({ slug, commands: journal.commands }));
  lists.push(extras.notes);
  lists.push(
    errors.map((message) => ({
      t: endedAt.getTime(),
      at: endedAt.toISOString(),
      source: "test",
      kind: "test" as const,
      level: "error" as const,
      text: `test error: ${oneLine(message.split("\n")[0] ?? "", 300)}`,
    })),
  );
  const entries = mergeTimeline(...lists);
  const title = testInfo.titlePath.slice(1).join(" > ");
  await save("timeline.json", JSON.stringify({ test: title, entries }, null, 1), "application/json");
  await save("timeline.md", renderTimelineMarkdown(entries, title, { testError: errors[0] }), "text/markdown");
}
