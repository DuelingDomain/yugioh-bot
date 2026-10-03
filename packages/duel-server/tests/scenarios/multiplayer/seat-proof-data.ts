import type { Scenario } from "../../support/dsl.js";
import { mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';
import { currentEngineDataDirectory } from '../../engine-data-dir.js';
// Private test labels. A real Tribute hint cannot satisfy the actor observer.
const source = currentEngineDataDirectory();
export const seatProofData = mkdtempSync(join(tmpdir(), 'owner-seat-proof-'));
for (const name of readdirSync(source)) if (name !== 'strings.conf') symlinkSync(join(source, name), join(seatProofData, name));
writeFileSync(join(seatProofData, 'strings.conf'), readFileSync(join(source, 'strings.conf'), 'utf8') + '\n!system 65535 SEAT_PROOF_ACTOR_OK\n!system 65534 SEAT_PROOF_CONFIRM_OK\n');
afterAll(() => rmSync(seatProofData, { recursive: true, force: true }));

// DECISIONS (evening 2026-10-02): Standard MR4/5 skips only the opening draw;
// Domain draws on the opening turn in every format. Each proof starts in MR5.
export function applySeatProofDrawRule(scenario: Scenario): void {
  if (scenario.setup.mode !== "domain") return;
  const first = scenario.setup.p0;
  // Keep the intended Kaiju targets in the Deck after the Domain opening draw.
  if (first?.deck?.length && first.deck[0] !== "Mystical Elf") first.deck.unshift("Mystical Elf");
  for (const step of scenario.steps) {
    if (step.op !== "expectBoard") continue;
    const board = step.board.p0;
    if (!board) continue;
    if (Array.isArray(board.hand)) board.hand.push("Mystical Elf");
    else if (board.hand?.count != null) board.hand.count++;
    if (board.deckCount != null) board.deckCount--;
  }
}
