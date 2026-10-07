import type Database from "better-sqlite3";
import { createDuelHost, type DuelHost } from "../../src/host.js";

const fixtures = new WeakMap<DuelHost, { db: Database.Database; resetDice: () => void }>();

/** Other host suites keep their seat fixtures. Dice timing and seat changes have dedicated tests. */
export function createTestDuelHost(options: Parameters<typeof createDuelHost>[0]): DuelHost {
  let roll = 0;
  const host = createDuelHost({ ...options, rollDie: options.rollDie ?? (() => 6 - roll++) });
  fixtures.set(host, { db: options.db, resetDice: () => { roll = 0; } });
  return host;
}

/** End the reveal without waiting in suites that test the active game, then let the real host start it. */
export async function finishTestDiceOpening<T>(
  host: DuelHost,
  body: Record<string, unknown>,
  result: { status: number; data: T },
  send: (body: Record<string, unknown>) => Promise<{ status: number; data: T }>,
): Promise<{ status: number; data: T }> {
  const data = result.data as { opening?: { phase?: string } } | null;
  if (body.op !== "start" || result.status !== 200 || data?.opening?.phase !== "dice") return result;
  const fixture = fixtures.get(host);
  if (!fixture) throw new Error("Test host needs createTestDuelHost");
  // The next table (or retry) gets a fresh high-to-low sequence, regardless of this table's size.
  fixture.resetDice();
  fixture.db.prepare("update duels set opening_json = json_set(opening_json, '$.deadline', 0) where web_slug = ?")
    .run(body.slug);
  return send({ ...body, op: "view" });
}
