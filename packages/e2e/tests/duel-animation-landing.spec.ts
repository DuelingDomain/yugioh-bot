import type { Page, TestInfo } from "@playwright/test";
import { test, expect, type Seat } from "../helpers/fixtures";
import { surrender } from "../helpers/duel";
import { activateSingleResponse, endTurn, handCard, startDuel, startTable, useCard } from "../helpers/board";
import { FILLER, withFiller, type DeckSpec } from "../helpers/decks";
import { armLandingProbe, describeZone, installLandingProbe, pairLandings, readLandingProbe, type Landing, type ProbeRaw } from "../helpers/landing-probe";
import { answerIfAsked, isAction, pickNamed, promptOf, resolveWith, waitPrompt, waitQuiet, zoneIfAsked, post, type Handler } from "../helpers/landing-drive";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Landing order of a card move: the animation comes first, then the card shows in its zone (owner rule).
// For every kind of move this records, in the browser, when the moved card first shows at its destination and when the
// flying card (the move animation) ends, and fails when the card shows more than one frame early. The probe reads only
// the DOM and the Web Animations of the page (helpers/landing-probe.ts). The real engine decides every move.
// Runs at 1920x1080 with full motion, in the 1v1 room and in the 3-seat table (FFA3).

test.use({ reducedMotion: "no-preference", viewport: { width: 1920, height: 1080 } });

const CELTIC = "Celtic Guardian";
const XYZ = "Minerva, the Exalted Lightsworn";

/** Deck of the first duelist. In the opening hand (first 5): the cards of turn 1. Turn 1 uses them in this order. */
const deckA = (): DeckSpec => ({
  main: withFiller([FILLER, "Bottomless Trap Hole", "Foolish Burial", "Monster Reborn", "Reinforcement of the Army", FILLER, CELTIC, CELTIC, CELTIC], 24),
  extra: [XYZ],
});
/** Deck of the second duelist: a summon for the trap to answer, a Set trap and the spell that returns it, and Dark Hole for the end. */
const deckB = (): DeckSpec => ({ main: withFiller([FILLER, "Giant Trunade", "Mirror Force", "Dark Hole"], 24) });
const deckC = (): DeckSpec => ({ main: withFiller([], 24) });

type Want = { from?: string; to: string; draw?: boolean; style?: string; /** Not every client animates this move with a flying card: a missing flight is reported, not failed. */ optional?: boolean };
type Row = {
  shell: string;
  kind: string;
  page: string;
  /** Milliseconds the card showed before the animation ended. Negative: after. null: no card of this kind flew. */
  earlyMs: number | null;
  verdict: string;
  detail: string;
};

const rows: Row[] = [];
const promptLog: string[] = [];
const dumps: Array<{ shell: string; kind: string; pages: unknown }> = [];

function describe(landing: Landing): string {
  const f = landing.flight;
  const a = landing.arrival;
  return `${f.style} flight ${describeZone(f.from)} -> ${describeZone(f.dest)}, ghost ${Math.round(f.firstSeen)}..${Math.round(f.travelEnd ?? 0)} ms${a ? `, card showed at ${Math.round(a.t)} ms (${a.via}, opacity ${a.opacity})` : ", card never showed"}`;
}

/**
 * A card that stays hidden after its animation is over is a bug that "no-arrival" would hide: once the animations are
 * done (and the hide failsafe has passed) no zone or hand card may still be hidden by the animation layers.
 */
async function expectNothingStuckHidden(page: Page, name: string): Promise<void> {
  const stuck = () => page.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll<HTMLElement>("[data-card-hidden]").forEach((el) => out.push(`[data-card-hidden]@${el.closest("[data-zones]")?.getAttribute("data-zones") ?? "?"}`));
    document.querySelectorAll<HTMLElement>("[data-zones] [data-fi], [data-hand-seat] *").forEach((el) => {
      if (el.style.visibility === "hidden") out.push(`${el.tagName.toLowerCase()}${el.dataset.fi != null ? `[fi=${el.dataset.fi}]` : ""}@${el.closest("[data-zones]")?.getAttribute("data-zones") ?? "hand"}`);
    });
    return out;
  });
  let left = await stuck();
  for (let waited = 0; left.length > 0 && waited < 3_000; waited += 250) {
    await page.waitForTimeout(250);
    left = await stuck();
  }
  expect.soft(left, `${name}: cards still hidden after their animations ended`).toEqual([]);
}

/** One measured step: arm the probes, run the move, wait until the animations are over, read the probes. */
async function measure(pages: Array<{ name: string; page: Page }>, run: () => Promise<void>): Promise<Array<{ name: string; raw: ProbeRaw; landings: Landing[] }>> {
  for (const { page } of pages) await waitQuiet(page);
  for (const { page } of pages) await armLandingProbe(page);
  await run();
  for (const { page } of pages) await waitQuiet(page);
  for (const { name, page } of pages) await expectNothingStuckHidden(page, name);
  return Promise.all(pages.map(async ({ name, page }) => {
    const raw = await readLandingProbe(page);
    return { name, raw, landings: pairLandings(raw) };
  }));
}

/** Checks one kind of move in a measurement: every flight of that route must land before the card shows. */
function check(shell: string, kind: string, read: Awaited<ReturnType<typeof measure>>, want: Want): void {
  dumps.push({ shell, kind, pages: read.map((r) => ({ name: r.name, flights: r.raw.flights.map((f) => ({ ...f, path: undefined })), arrivals: r.raw.arrivals })) });
  for (const { name, landings } of read) {
    const matched = landings.filter((l) => l.flight.dest?.kind === want.to && (want.from == null || l.flight.from?.kind === want.from) && (want.style == null || l.flight.style === want.style) && (want.draw ? l.flight.style === "draw" : l.flight.style !== "draw"));
    if (matched.length === 0) {
      rows.push({ shell, kind, page: name, earlyMs: null, verdict: "no-flight", detail: `no flying card ${want.from ?? "*"} -> ${want.to}; seen: ${landings.map(describe).join(" | ") || "none"}` });
      if (!want.optional) expect.soft(matched.length, `${shell} / ${kind} / ${name}: no card flew ${want.from ?? "*"} -> ${want.to}`).toBeGreaterThan(0);
      continue;
    }
    for (const landing of matched) {
      const early = landing.earlyMs;
      rows.push({ shell, kind, page: name, earlyMs: early, verdict: landing.verdict, detail: describe(landing) });
      // "no-arrival": the card never showed at the destination (it left again, e.g. a resolved spell). Nothing showed early.
      expect.soft(landing.verdict === "no-arrival" ? "ok" : landing.verdict, `${shell} / ${kind} / ${name}: card showed ${early == null ? "never" : `${Math.round(early)} ms before the animation landed`}. ${describe(landing)}`).toBe("ok");
    }
  }
}

async function activate(seat: Seat, card: string): Promise<void> {
  await useCard(seat.page, handCard(seat.page, card), "Activate");
  await zoneIfAsked(seat.page, "st");
}

async function save(testInfo: TestInfo, shell: string): Promise<void> {
  const mine = rows.filter((row) => row.shell === shell);
  const body = JSON.stringify(mine, null, 2);
  await testInfo.attach(`landing-${shell}.json`, { body, contentType: "application/json" });
  const dir = process.env.LANDING_OUT_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `landing-${shell}.json`), body);
    writeFileSync(join(dir, `landing-${shell}-raw.json`), JSON.stringify(dumps.filter((d) => d.shell === shell)));
  }
  console.log(`[landing:${shell}] prompts answered:\n${promptLog.join("\n")}`);
  console.log(`\n[landing:${shell}] ${mine.length} measurements`);
  for (const row of mine) console.log(`[landing:${shell}] ${row.verdict.padEnd(9)} ${row.earlyMs == null ? "   n/a" : String(Math.round(row.earlyMs)).padStart(6)} ms  ${row.kind} (${row.page})  ${row.detail}`);
}

/** The scripted duel. `first`, `second` and (3 seats) `third` take turns; the first duelist plays turn 1. */
async function play(shell: string, seats: Seat[], slug: string, firstTurns: [number, number]): Promise<void> {
  const [first, second] = seats as [Seat, Seat];
  const pages = seats.map((seat, index) => ({ name: `seat${index}`, page: seat.page }));
  const log = promptLog;
  const cards = (card: string): Handler[] => [pickNamed(/./, card)];

  // ---- turn of the first duelist ----
  let read = await measure(pages, async () => {
    await useCard(first.page, handCard(first.page, FILLER), /^Set/);
    await zoneIfAsked(first.page, "mz");
  });
  check(shell, "Set monster", read, { from: "hand", to: "mz" });

  read = await measure(pages, async () => {
    await useCard(first.page, handCard(first.page, "Bottomless Trap Hole"), "Set Spell/Trap");
    await zoneIfAsked(first.page, "st");
  });
  check(shell, "Set Spell/Trap", read, { from: "hand", to: "st" });

  read = await measure(pages, async () => {
    await activate(first, "Foolish Burial");
    await resolveWith(first, slug, cards(CELTIC), { log });
  });
  check(shell, "Activate Spell from hand", read, { from: "hand", to: "st" });
  check(shell, "Send to GY by effect (mill from Deck)", read, { from: "deck", to: "gy" });

  read = await measure(pages, async () => {
    await activate(first, "Monster Reborn");
    await resolveWith(first, slug, cards(CELTIC), { log });
  });
  check(shell, "Special Summon (from GY)", read, { from: "gy", to: "mz" });

  read = await measure(pages, async () => {
    await activate(first, "Reinforcement of the Army");
    await resolveWith(first, slug, cards(CELTIC), { log });
  });
  check(shell, "Add from Deck to hand (search)", read, { from: "deck", to: "hand" });

  read = await measure(pages, async () => {
    await endTurn(first.page, 2);
  });
  check(shell, "Draw (turn start)", read, { to: "hand", draw: true });

  // ---- turn of the second duelist: Normal Summon, the Set trap answers (banish), Set trap, return to hand ----
  read = await measure(pages, async () => {
    await useCard(second.page, handCard(second.page, FILLER), "Normal Summon");
    await zoneIfAsked(second.page, "mz");
    await activateSingleResponse(first.page);
    await resolveWith(first, slug, [], { log });
  });
  check(shell, "Normal Summon", read, { from: "hand", to: "mz" });
  check(shell, "Banish", read, { to: "banish" });
  check(shell, "Activate Set Trap (the used trap goes to the GY)", read, { from: "st", to: "gy", optional: true });

  read = await measure(pages, async () => {
    await useCard(second.page, handCard(second.page, "Mirror Force"), "Set Spell/Trap");
    await zoneIfAsked(second.page, "st");
  });
  check(shell, "Set Spell/Trap", read, { from: "hand", to: "st" });

  read = await measure(pages, async () => {
    await activate(second, "Giant Trunade");
    await resolveWith(second, slug, [], { log });
  });
  check(shell, "Return to hand", read, { from: "st", to: "hand" });

  read = await measure(pages, async () => {
    await endTurn(second.page, 3);
    if (seats[2]) await endTurn(seats[2].page, 4);
  });
  check(shell, "Draw (turn start, second)", read, { to: "hand", draw: true });

  // ---- second turn of the first duelist: Normal Summon, Xyz Summon, detach, destroy ----
  read = await measure(pages, async () => {
    await useCard(first.page, handCard(first.page, CELTIC), "Normal Summon");
    await zoneIfAsked(first.page, "mz");
  });
  check(shell, "Normal Summon (second Level 4)", read, { from: "hand", to: "mz" });

  read = await measure(pages, async () => {
    const { prompt, revision } = await waitPrompt(first, slug, (p) => isAction(p) && p.options.some((o) => o.id.startsWith("spsummon:") && o.card?.name === XYZ), "Xyz Summon is offered");
    await post(first, slug, revision, prompt, { choice: prompt.options.find((o) => o.id.startsWith("spsummon:") && o.card?.name === XYZ)!.id });
    await resolveWith(first, slug, [], { log });
  });

  check(shell, "Special Summon (Xyz Summon from the Extra Deck)", read, { to: "mz", optional: true });

  read = await measure(pages, async () => {
    const { prompt, revision } = await waitPrompt(first, slug, (p) => isAction(p) && p.options.some((o) => o.id.startsWith("activate:") && o.card?.name === XYZ), "the Xyz monster can detach");
    await post(first, slug, revision, prompt, { choice: prompt.options.find((o) => o.id.startsWith("activate:") && o.card?.name === XYZ)!.id });
    await resolveWith(first, slug, [], { log });
  });
  check(shell, "Xyz detach to GY", read, { from: "mz", to: "gy" });
  check(shell, "Send to GY by effect (mill, Xyz effect)", read, { from: "deck", to: "gy" });

  // The second duelist keeps Dark Hole for the next turn of theirs (turn 4 in the duel, turn 5 at the table of three).
  read = await measure(pages, async () => {
    await endTurn(first.page, seats.length === 3 ? 5 : 4);
    await activate(second, "Dark Hole");
    // The Xyz monster of the first duelist has a trigger for its own destruction: decline it.
    await answerIfAsked(first, slug, (p) => p.kind === "choice" && p.options.some((o) => o.id === "no"), { choice: "no" }, 2_500);
    await resolveWith(second, slug, [], { log });
  });
  check(shell, "Destroy to GY (monster destroyed by effect)", read, { to: "gy", style: "fade" });

  void firstTurns;
}

test.describe("move animation lands before the card shows", () => {
  test("1v1 room", async ({ player }, testInfo) => {
    test.setTimeout(420_000);
    const alice = await player("p1");
    const bob = await player("p2");
    for (const seat of [alice, bob]) await installLandingProbe(seat.context);
    const { slug } = await startDuel(alice, bob, "landing 1v1", deckA(), deckB());
    try {
      await play("1v1", [alice, bob], slug, [1, 2]);
    } finally {
      await save(testInfo, "1v1");
      await surrender(alice.page).catch(() => undefined);
    }
  });

  test("opening deal (1v1)", async ({ player }, testInfo) => {
    test.setTimeout(240_000);
    const alice = await player("p1");
    const bob = await player("p2");
    for (const seat of [alice, bob]) await installLandingProbe(seat.context, { armOnLoad: true });
    await startDuel(alice, bob, "landing deal", deckA(), deckB());
    try {
      const pages = [{ name: "seat0", page: alice.page }, { name: "seat1", page: bob.page }];
      for (const { page } of pages) await waitQuiet(page, 2_500, 20_000);
      const read = await Promise.all(pages.map(async ({ name, page }) => {
        const raw = await readLandingProbe(page);
        return { name, raw, landings: pairLandings(raw) };
      }));
      check("1v1-deal", "Opening deal (Deck to hand)", read, { to: "hand", draw: true });
    } finally {
      await save(testInfo, "1v1-deal");
      await surrender(alice.page).catch(() => undefined);
    }
  });

  test("3-seat table (FFA3)", async ({ player }, testInfo) => {
    test.setTimeout(600_000);
    const seats = await Promise.all([player("p1"), player("p2"), player("p3")]);
    for (const seat of seats) await installLandingProbe(seat.context);
    const { slug } = await startTable(seats, "landing ffa3", [deckA(), deckB(), deckC()], { ordered: true, looseDecks: true, noBanlist: true, format: "ffa3" });
    try {
      await play("ffa3", seats, slug, [1, 2]);
    } finally {
      await save(testInfo, "ffa3");
      for (const seat of seats) await surrender(seat.page).catch(() => undefined);
    }
  });
});

void promptOf;
