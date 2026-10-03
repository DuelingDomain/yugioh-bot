import type { TestInfo } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { lastJournalCommands, readJournal, roomBody, stackTail, type PlayerEvidence } from "./evidence";
import { playerName } from "./players";
import type { TimelineEntry } from "./timeline";

/**
 * Stall detector. A timer polls the room JSON of every player (the same `/api/duels/<slug>` read the recorder
 * uses). While a duel is `active` and its revision does not change for `stallMs`, it writes `stall-<n>.json`
 * at once (not at the end of the test) and calls `onStall`, which the fixture uses to stop the test.
 * It also writes one timeline note for each revision change, so timeline.md can name the last progress point.
 * `E2E_STALL_MS` sets the limit (default 60000). 0 turns the watcher off. A test that waits on purpose can call
 * `test.use({ stallMs: 0 })`.
 */
// Multi-browser setup and inspection can exceed 20 s without answering a prompt, especially across parallel slots.
// Leave room for those steps while still detecting a stuck duel before Playwright's 120 s test timeout.
export const DEFAULT_STALL_MS = 60_000;

export function stallMsFromEnv(): number {
  const value = process.env.E2E_STALL_MS;
  if (value === undefined || value === "") return DEFAULT_STALL_MS;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_STALL_MS;
}

interface Tracked {
  revision: number;
  changedAt: number;
  reported: boolean;
}

export interface StallReport {
  n: number;
  slug: string;
  message: string;
  file: string;
}

export class DuelWatch {
  readonly notes: TimelineEntry[] = [];
  readonly stalls: StallReport[] = [];
  private readonly tracked = new Map<string, Tracked>();
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(
    private readonly testInfo: TestInfo,
    private readonly recorders: PlayerEvidence[],
    private readonly stallMs: number,
    private readonly onStall: (report: StallReport) => Promise<void>,
  ) {}

  start(): void {
    if (this.stallMs <= 0) return;
    const every = Math.min(2000, Math.max(500, Math.floor(this.stallMs / 5)));
    const tick = () => {
      if (this.stopped) return;
      this.running = this.poll().catch(() => undefined);
      void this.running.then(() => {
        if (!this.stopped) this.timer = setTimeout(tick, every);
      });
    };
    this.timer = setTimeout(tick, every);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.running;
  }

  private async poll(): Promise<void> {
    const now = Date.now();
    const bySlug = new Map<string, Array<{ recorder: PlayerEvidence; body: NonNullable<ReturnType<typeof roomBody>> }>>();
    for (const recorder of this.recorders) {
      const slug = recorder.currentSlug();
      if (!slug) continue;
      const body = roomBody(await recorder.room(slug));
      if (!body?.session) continue;
      bySlug.set(slug, [...(bySlug.get(slug) ?? []), { recorder, body }]);
    }
    for (const [slug, views] of bySlug) {
      const session = views[0]!.body.session!;
      const revision = Math.max(...views.map((view) => view.body.engine?.revision ?? -1));
      if (session.status !== "active" || revision < 0) {
        this.tracked.delete(slug);
        continue;
      }
      const seen = this.tracked.get(slug);
      if (!seen || seen.revision !== revision) {
        this.tracked.set(slug, { revision, changedAt: now, reported: false });
        const engine = views.find((view) => view.body.engine)?.body.engine;
        const holder = views.find((view) => view.body.engine?.prompt)?.body.engine?.prompt;
        this.notes.push({
          t: now,
          at: new Date(now).toISOString(),
          source: "watcher",
          kind: "room",
          level: "info",
          text: `${slug} revision ${revision}, turn ${engine?.turn ?? "?"} ${engine?.phase ?? ""}${holder ? `, open prompt seat ${holder.seat} "${holder.title}"` : ", no open prompt visible"}`,
          data: { progress: true, slug, revision },
        });
        continue;
      }
      if (!seen.reported && now - seen.changedAt >= this.stallMs) {
        seen.reported = true;
        const report = await this.report(slug, views, revision, now - seen.changedAt);
        this.stalls.push(report);
        await this.onStall(report);
      }
    }
  }

  private async report(slug: string, views: Array<{ recorder: PlayerEvidence; body: NonNullable<ReturnType<typeof roomBody>> }>, revision: number, idleMs: number): Promise<StallReport> {
    const n = this.stalls.length + 1;
    const dir = this.testInfo.outputPath("evidence");
    mkdirSync(dir, { recursive: true });
    const session = views[0]!.body.session!;
    const engine = views.find((view) => view.body.engine)?.body.engine;
    const journal = readJournal(slug);
    const screenshots = (await Promise.all(this.recorders.map((recorder) => recorder.screenshots(dir, `stall-${n}`)))).flat();
    const seatName = (seat: number) => session.seats?.find((entry) => entry.seat === seat);
    const promptOf = (view: (typeof views)[number]) => {
      const prompt = view.body.engine?.prompt;
      return prompt && { id: prompt.id, seat: prompt.seat, kind: prompt.kind, title: prompt.title, description: prompt.description, options: prompt.options?.slice(0, 12).map((option) => option.label) };
    };
    const holders = views.filter((view) => view.body.engine?.prompt).map((view) => ({ player: view.recorder.key, seat: view.body.mySeat ?? null, prompt: view.body.engine?.prompt?.title }));
    const openSeats = [...new Set(views.map((view) => view.body.engine?.prompt?.seat).filter((seat): seat is number => seat !== undefined))];
    const name = `stall-${slug}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    const message =
      `Duel ${slug} stalled: revision ${revision} did not change for ${Math.round(idleMs / 1000)} s (limit ${Math.round(this.stallMs / 1000)} s, E2E_STALL_MS). ` +
      (holders.length
        ? `Open prompt held by ${holders.map((holder) => `${holder.player} (seat ${holder.seat}) "${holder.prompt}"`).join(", ")}.`
        : openSeats.length
          ? `The open prompt is for seat ${openSeats.join(", ")}, no player browser holds it${openSeats.some((seat) => seatName(seat)?.isBot) ? " (a bot seat)" : ""}.`
          : "No player sees an open prompt.") +
      ` See ${name} and timeline.md.`;
    const file = `${dir}/${name}`;
    writeFileSync(
      file,
      JSON.stringify(
        {
          kind: "stall",
          n,
          slug,
          detectedAt: new Date().toISOString(),
          stallMs: this.stallMs,
          idleMs,
          message,
          session: { status: session.status, mode: session.mode, seats: session.seats },
          revision,
          turn: engine?.turn ?? null,
          phase: engine?.phase ?? null,
          promptHolders: holders,
          promptSeats: openSeats.map((seat) => ({ seat, name: seatName(seat)?.displayName ?? null, isBot: seatName(seat)?.isBot ?? null })),
          players: views.map((view) => ({
            player: view.recorder.key,
            name: playerName(view.recorder.key),
            role: view.body.role ?? null,
            seat: view.body.mySeat ?? null,
            revision: view.body.engine?.revision ?? null,
            prompt: promptOf(view) ?? null,
            lastLog: (view.body.engine?.log ?? []).slice(-10).map((entry) => entry.text),
          })),
          acceptedAnswers: "commands" in journal ? journal.commands.length : null,
          lastAnswerPerSeat: lastJournalCommands(journal),
          lastAnswers: "commands" in journal ? journal.commands.slice(-5) : [],
          stackLogLast30: stackTail(new Date(this.recorders[0]!.startedAt).toISOString(), 30),
          screenshots,
        },
        null,
        1,
      ),
    );
    await this.testInfo.attach(name, { path: file, contentType: "application/json" });
    for (const name of screenshots) await this.testInfo.attach(name, { path: `${dir}/${name}`, contentType: "image/png" });
    const at = Date.now();
    this.notes.push({ t: at, at: new Date(at).toISOString(), source: "watcher", kind: "stall", level: "error", text: message });
    return { n, slug, message, file };
  }
}
