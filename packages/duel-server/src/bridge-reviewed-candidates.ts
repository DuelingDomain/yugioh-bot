import type Database from "better-sqlite3";
import { bridgeGate, type ArchetypeBridge } from "@yugidraft/shared/cards/effects";

/** More alternatives do not require buying a second verdict on a still-valid accepted pair. */
export function reuseAcceptedBridge(db: Database.Database, candidate: ArchetypeBridge): ArchetypeBridge {
  const stored = db.prepare(`SELECT bridge_json FROM archetype_bridge b WHERE source=? AND target=? AND format=?
    AND (SELECT count(*) FROM bridge_judgement j WHERE j.evidence_hash=b.evidence_hash)>=2`)
    .get(candidate.source, candidate.target, candidate.format) as { bridge_json: string } | undefined;
  if (!stored) return candidate;
  const previous = JSON.parse(stored.bridge_json) as ArchetypeBridge;
  // Rechecks printed evidence, current access, both judge identities and feedback.
  return previous.kind === candidate.kind && bridgeGate(db, previous).state === "shown" ? previous : candidate;
}
