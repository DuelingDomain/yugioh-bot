// Checklist verdicts and the leak scan for the multi-seat preset runs. Pure code: no Playwright, no I/O.
// A verdict is "pass", "fail", "not-reached" (the move or the state never came) or "unchecked" (a human must look at
// the screenshots: the views we capture cannot prove it). Every verdict names the revision and the screenshot it is based on.

export interface BoardSeat {
  seat: number;
  lp: number | null;
  eliminated: boolean;
  team: number | null;
  monsters: string[];
  spells: string[];
  grave: string[];
  handCount: number;
}

export interface StepRecord {
  step: number;
  revision: number | null;
  turn: number | null;
  turnSeat: number | null;
  phase: string | null;
  status: string | null;
  result: unknown;
  board: BoardSeat[];
  chain: Array<{ seat: number; name?: string }>;
  /** Retained engine events survive chain windows between samples. */
  events?: Array<{ kind: string; seat?: number; chainIndex?: number }>;
  prompt: { seat: number; kind: string; title: string; options: string[] } | null;
  /** Prompts of the bot seats and the partner, from debug-trace (empty without it). */
  hostPrompts: Array<{ seat: number; kind: string; title: string; options: string[] }>;
  traceSeen: boolean;
  screenshot: string | null;
}

export interface DriverRecord {
  revision: number;
  note: string;
}

export type VerdictValue = "pass" | "fail" | "not-reached" | "unchecked";

export interface Verdict {
  item: number;
  text: string;
  verdict: VerdictValue;
  revision: number | null;
  screenshot: string | null;
  detail: string;
}

interface Ctx {
  steps: StepRecord[];
  driver: DriverRecord[];
  format: string;
}

interface Hit {
  verdict: VerdictValue;
  step?: StepRecord;
  detail: string;
}

type Check = (ctx: Ctx) => Hit;

const did = (ctx: Ctx, note: string) => ctx.driver.find((entry) => entry.note === note);
const seatOf = (step: StepRecord, seat: number): BoardSeat | undefined => step.board.find((entry) => entry.seat === seat);
const has = (list: string[], name: string) => list.includes(name);

/** The first step after `from` where `test` holds. */
function firstStep(ctx: Ctx, test: (step: StepRecord) => boolean, from = 0): StepRecord | undefined {
  return ctx.steps.find((step) => step.step > from && test(step));
}

/** "pass" at the first step where `test` holds; else "not-reached" when the move did not happen, else "fail". */
function expectState(ctx: Ctx, moves: string[], test: (step: StepRecord) => boolean, what: string): Hit {
  const missing = moves.filter((move) => !did(ctx, move));
  if (missing.length > 0) return { verdict: "not-reached", detail: `the move was not played: ${missing.join(", ")}` };
  const moved = Math.max(...moves.map((move) => did(ctx, move)!.revision));
  const hit = ctx.steps.find((step) => step.revision !== null && step.revision > moved && test(step));
  if (hit) return { verdict: "pass", step: hit, detail: what };
  return { verdict: "fail", step: ctx.steps.at(-1), detail: `not seen after the move: ${what}` };
}

/** "pass" when `test` holds on every step, "fail" (with the first bad step) otherwise. */
function always(ctx: Ctx, test: (step: StepRecord) => boolean, what: string): Hit {
  if (ctx.steps.length === 0) return { verdict: "not-reached", detail: "no revision was seen" };
  const bad = ctx.steps.find((step) => !test(step));
  return bad ? { verdict: "fail", step: bad, detail: `broken: ${what}` } : { verdict: "pass", step: ctx.steps.at(-1), detail: what };
}

const manual = (why: string): Check => () => ({ verdict: "unchecked", detail: `needs a human look: ${why}` });

/** Uses debug-trace prompts when they exist; else unchecked. `bad` says which prompt breaks the rule. */
function noHostPrompt(bad: (prompt: NonNullable<StepRecord["prompt"]>) => boolean, what: string, when: (step: StepRecord) => boolean = () => true): Check {
  return (ctx) => {
    if (!ctx.steps.some((step) => step.traceSeen)) return { verdict: "unchecked", detail: `needs debug-trace (host op) to see the prompts of the other seats: ${what}` };
    const offender = ctx.steps.find((step) => when(step) && step.hostPrompts.some(bad));
    return offender ? { verdict: "fail", step: offender, detail: `seen: ${what}` } : { verdict: "pass", step: ctx.steps.at(-1), detail: what };
  };
}

const monstersOf = (step: StepRecord, seat: number) => seatOf(step, seat)?.monsters ?? [];
const allEmptyBut = (step: StepRecord, keep: number[]) => step.board.every((seat) => keep.includes(seat.seat) || seat.monsters.length === 0);

const heavyStormResolution: Check = (ctx) => {
  if (!did(ctx, "activate Heavy Storm")) return { verdict: "not-reached", detail: "Heavy Storm was not activated" };
  let last: StepRecord | undefined;
  let seen: number[] = [];
  for (const step of ctx.steps) {
    const resolving = (step.events ?? []).filter((event) => event.kind === "chain-resolving");
    for (let start = 0; start < resolving.length; start += 1) {
      const links = resolving.slice(start, start + 4);
      if (links[0]?.chainIndex !== 4) continue;
      last = step;
      seen = links.map((link) => link.seat ?? -1);
      if (links.length === 4 && links.every((link, index) => link.chainIndex === 4 - index && link.seat === 3 - index)) {
        return { verdict: "pass", step, detail: "retained chain-resolving events show links 4,3,2,1 from seats 3,2,1,0" };
      }
    }
  }
  return { verdict: last ? "fail" : "not-reached", step: last, detail: `four-link resolution seats seen: ${seen.join(",") || "none"}; expected 3,2,1,0` };
};

const CHECKS: Record<string, Check[]> = {
  "raigeki-dark-hole-ffa4": [
    (ctx) => {
      const first = ctx.steps[0];
      if (!first) return { verdict: "not-reached", detail: "no revision was seen" };
      const ok = first.board.length === 4 && first.board.every((seat) => seat.monsters.length === 1);
      return { verdict: ok ? "pass" : "fail", step: first, detail: `monsters per seat: ${first.board.map((seat) => seat.monsters.length).join(",")}` };
    },
    (ctx) => expectState(ctx, ["activate Raigeki"], (step) => [1, 2, 3].every((seat) => monstersOf(step, seat).length === 0) && has(monstersOf(step, 0), "Celtic Guardian"), "bot monsters gone, Celtic Guardian stays"),
    (ctx) => expectState(ctx, ["activate Dark Hole"], (step) => allEmptyBut(step, []) && has(seatOf(step, 0)?.grave ?? [], "Celtic Guardian"), "no monster left, Celtic Guardian in the grave"),
    (ctx) => {
      const darkHole = did(ctx, "activate Dark Hole");
      const resolved = darkHole && ctx.steps.find((step) => step.revision !== null && step.revision > darkHole.revision && allEmptyBut(step, []));
      if (!resolved) return { verdict: "not-reached", detail: "Dark Hole has not resolved" };
      // Normal action prompts on the bots' subsequent turns are outside these spells' response
      // windows. Only the captured interval through Dark Hole's resolution must be plain passes.
      return noHostPrompt((prompt) => prompt.kind !== "choice" || !prompt.options.every((option) => /pass|no|cancel/i.test(option)), "a bot got a prompt that is not a plain pass")({
        ...ctx, steps: ctx.steps.filter((step) => step.revision !== null && step.revision <= resolved.revision!),
      });
    },
  ],
  "raigeki-dark-hole-tag": [
    (ctx) => {
      const first = ctx.steps[0];
      if (!first) return { verdict: "not-reached", detail: "no revision was seen" };
      const teams = first.board.map((seat) => seat.team).join(",");
      return { verdict: teams === "0,1,0,1" ? "pass" : "fail", step: first, detail: `teams by seat: ${teams}` };
    },
    (ctx) => expectState(ctx, ["activate Raigeki"], (step) => monstersOf(step, 1).length === 0 && monstersOf(step, 3).length === 0 && monstersOf(step, 0).length > 0 && monstersOf(step, 2).length > 0, "seats 1 and 3 empty, seat 0 and partner keep monsters"),
    (ctx) => expectState(ctx, ["activate Dark Hole"], (step) => allEmptyBut(step, []), "every monster destroyed, the partner's too"),
  ],
  "mind-crush-ffa4-pick": [
    manual("the hand of the bots is hidden from seat 0 and the spectator; use the host report views"),
    (ctx) => (did(ctx, "pick opponent seat 1") ? { verdict: "pass", step: ctx.steps.find((step) => step.revision === did(ctx, "pick opponent seat 1")!.revision), detail: "the opponent pick prompt was shown and seat 1 chosen" } : { verdict: "not-reached", detail: "no opponent pick prompt was answered" }),
    (ctx) => expectState(ctx, ["announce Sangan"], (step) => has(seatOf(step, 1)?.grave ?? [], "Sangan") && !has(seatOf(step, 2)?.grave ?? [], "Sangan"), "Sangan in the grave of seat 1 only"),
    manual("the wrong-name branch is not played by this run"),
  ],
  "tag-lp-solemn-partner": [
    (ctx) => {
      const first = ctx.steps[0];
      if (!first) return { verdict: "not-reached", detail: "no revision was seen" };
      return { verdict: first.board.every((seat) => seat.lp === 16000) ? "pass" : "fail", step: first, detail: `LP: ${first.board.map((seat) => seat.lp).join(",")}` };
    },
    (ctx) => (did(ctx, "summon Celtic Guardian") ? { verdict: "pass", step: ctx.steps.find((step) => step.revision === did(ctx, "summon Celtic Guardian")!.revision), detail: "summon answered" } : { verdict: "not-reached", detail: "summon was not played" }),
    // Once the rival's Solemn Judgment is on the chain, the partner may answer it. Only an empty chain is the partner's own summon.
    noHostPrompt((prompt) => prompt.seat === 2 && prompt.options.some((option) => /Solemn/i.test(option)), "the partner (seat 2) was offered Solemn Judgment on the summon", (step) => step.chain.length === 0),
    (ctx) => expectState(ctx, ["summon Celtic Guardian"], (step) => seatOf(step, 1)?.lp === 8000 && seatOf(step, 3)?.lp === 8000, "LP of seats 1 and 3 is 8000"),
    (ctx) => (ctx.steps.length === 0 ? { verdict: "not-reached", detail: "no revision was seen" } : always(ctx, (step) => seatOf(step, 0)?.lp === 16000 && seatOf(step, 2)?.lp === 16000, "own team LP stays 16000")),
  ],
  "tag-jinzo-blocks-traps": [
    manual("the set Traps are face-down; the start board needs a look"),
    (ctx) => (did(ctx, "summon Celtic Guardian") ? { verdict: "pass", step: ctx.steps.find((step) => step.revision === did(ctx, "summon Celtic Guardian")!.revision), detail: "summon answered" } : { verdict: "not-reached", detail: "summon was not played" }),
    (ctx) => {
      if (!did(ctx, "summon Celtic Guardian")) return { verdict: "not-reached", detail: "summon was not played" };
      const own = ctx.steps.find((step) => step.prompt && step.revision! > did(ctx, "summon Celtic Guardian")!.revision && step.prompt.options.some((option) => /Mirror Force|Torrential|Trap/i.test(option)));
      if (own) return { verdict: "fail", step: own, detail: "seat 0 was offered a Trap" };
      return noHostPrompt((prompt) => prompt.options.some((option) => /Mirror Force|Torrential|Trap|Solemn|Dust/i.test(option)), "a seat was offered a Trap")(ctx);
    },
    (ctx) => expectState(ctx, ["summon Celtic Guardian"], (step) => has(monstersOf(step, 0), "Celtic Guardian"), "Celtic Guardian stays on the field"),
  ],
  "ffa4-chain-order-heavy-storm": [
    (ctx) => {
      const first = ctx.steps[0];
      if (!first) return { verdict: "not-reached", detail: "no revision was seen" };
      const swords = (seatOf(first, 0)?.spells ?? []).filter((name) => /Swords of Revealing Light/.test(name)).length;
      return { verdict: swords === 3 ? "pass" : "fail", step: first, detail: `Swords of Revealing Light on seat 0: ${swords}` };
    },
    (ctx) => (did(ctx, "activate Heavy Storm") ? { verdict: "pass", step: ctx.steps.find((step) => step.revision === did(ctx, "activate Heavy Storm")!.revision), detail: "Heavy Storm activated" } : { verdict: "not-reached", detail: "Heavy Storm was not activated" }),
    heavyStormResolution,
    manual("our pass after the bots is an answer in driver-log.json"),
    heavyStormResolution,
  ],
  "ffa4-surrender-in-chain": [
    (ctx) => (did(ctx, "activate Heavy Storm") ? { verdict: "pass", step: ctx.steps.find((step) => step.revision === did(ctx, "activate Heavy Storm")!.revision), detail: "Heavy Storm activated" } : { verdict: "not-reached", detail: "Heavy Storm was not activated" }),
    (ctx) => {
      const hit = ctx.steps.find((step) => step.chain.some((link) => link.seat === 1 && /Dust Tornado/.test(link.name ?? "")));
      return hit ? { verdict: "pass", step: hit, detail: "seat 1 has Dust Tornado on the chain" } : { verdict: "not-reached", detail: "no Dust Tornado link of seat 1 seen" };
    },
    (ctx) => {
      const hit = ctx.steps.find((step) => seatOf(step, 1)?.eliminated);
      return hit ? { verdict: "pass", step: hit, detail: "seat 1 is eliminated" } : { verdict: "not-reached", detail: "seat 1 never showed as eliminated" };
    },
    manual("whether Swords dies only to Heavy Storm needs the log and the screenshots"),
    (ctx) => {
      const hit = ctx.steps.find((step) => seatOf(step, 1)?.eliminated);
      if (!hit) return { verdict: "not-reached", detail: "seat 1 never showed as eliminated" };
      const s1 = seatOf(hit, 1)!;
      return { verdict: s1.monsters.length === 0 ? "pass" : "fail", step: hit, detail: `monsters of seat 1 after elimination: ${s1.monsters.join(",") || "none"}` };
    },
    (ctx) => {
      const last = ctx.steps.at(-1);
      const hit = ctx.steps.find((step) => seatOf(step, 1)?.eliminated);
      if (!last || !hit) return { verdict: "not-reached", detail: "seat 1 never showed as eliminated" };
      const ok = [0, 2, 3].every((seat) => !seatOf(last, seat)?.eliminated) && !last.result && last.status === "active";
      return { verdict: ok ? "pass" : "fail", step: last, detail: `status ${last.status}, result ${JSON.stringify(last.result)}` };
    },
  ],
};

export function checklistVerdicts(presetId: string, checklist: string[], ctx: Ctx): Verdict[] {
  const checks = CHECKS[presetId] ?? [];
  return checklist.map((text, index) => {
    const check = checks[index];
    let hit: Hit;
    try {
      hit = check ? check(ctx) : { verdict: "unchecked", detail: "no automatic check for this item" };
    } catch (error) {
      hit = { verdict: "unchecked", detail: `the check threw: ${String(error).slice(0, 120)}` };
    }
    return { item: index + 1, text, verdict: hit.verdict, revision: hit.step?.revision ?? null, screenshot: hit.step?.screenshot ?? null, detail: hit.detail };
  });
}

// ---- leak scan -------------------------------------------------------------------------------------------

interface LeakCard {
  code?: number;
  name?: string;
  position?: number;
}

interface LeakSeat {
  seat: number;
  hand?: Array<LeakCard | null>;
  monsters?: Array<LeakCard | null>;
  spells?: Array<LeakCard | null>;
}

export interface LeakView {
  revision?: number;
  seats?: LeakSeat[];
}

export interface Leak {
  revision: number | null;
  viewer: string;
  message: string;
}

const FACE_DOWN = 0x2 | 0x8;

/**
 * Leak scan over a view that one browser got. `viewerSeat` is a seat number, or null for a spectator. Tag: a seat sees the
 * hand of its partner (seat + 2 mod 4), so that is not a leak. Codes that the spectator view shows in public are allowed.
 */
export function scanLeaks(view: LeakView, viewerSeat: number | null, format: string, publicCodes: ReadonlySet<number>, viewerName: string): Leak[] {
  const out: Leak[] = [];
  const friend = format === "tag" && viewerSeat !== null ? (viewerSeat + 2) % 4 : null;
  for (const seat of view.seats ?? []) {
    if (seat.seat === viewerSeat || seat.seat === friend) continue;
    const show = (card: LeakCard | null | undefined, what: string, mustBeHidden: boolean) => {
      if (!card || card.code === undefined || publicCodes.has(card.code)) return;
      const faceDown = ((card.position ?? 0) & FACE_DOWN) !== 0;
      if (mustBeHidden || faceDown) out.push({ revision: view.revision ?? null, viewer: viewerName, message: `${viewerName} sees ${what} of seat ${seat.seat}: ${card.name ?? card.code}` });
    };
    (seat.hand ?? []).forEach((card) => show(card, "a hand card", true));
    (seat.monsters ?? []).forEach((card) => show(card, "a face-down monster", false));
    (seat.spells ?? []).forEach((card) => show(card, "a face-down spell/trap", false));
  }
  return out;
}

/** Codes that the spectator sees on the public board (monsters, spells, graves) are public now. */
export function publicCodesOf(view: { seats?: Array<{ monsters?: Array<LeakCard | null>; spells?: Array<LeakCard | null>; graveyard?: Array<LeakCard | null>; banished?: Array<LeakCard | null> }> }, into: Set<number>): void {
  for (const seat of view.seats ?? []) {
    for (const card of [...(seat.monsters ?? []), ...(seat.spells ?? []), ...(seat.graveyard ?? []), ...(seat.banished ?? [])]) {
      if (card?.code !== undefined) into.add(card.code);
    }
  }
}
