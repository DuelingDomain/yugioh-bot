import Anthropic from "@anthropic-ai/sdk";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { importBridgeArtifact, importCardEffectArtifact } from "@yugidraft/shared/cards/effects";
import { judgeStoredStrict } from "../judge-stored-strict.js";

it("judges all selected strict rows once with both framings, reservations and normal fact checking", async () => {
  const db = new Database(":memory:"); migrate(db); importCardEffectArtifact(db); importBridgeArtifact(db);
  db.prepare("DELETE FROM archetype_bridge WHERE NOT (source='Odion' AND target IN ('Argostars','Ashtra') AND format='advanced') AND coalesce(json_extract(bridge_json,'$.tier'),'strict')='strict'").run();
  let calls = 0, checks = 0;
  const client = new Anthropic({ apiKey: "integration-fixture", maxRetries: 0, fetch: async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    expect(request.model).toBe("claude-haiku-5-5");
    const input = JSON.parse(request.messages[0].content);
    const sentence = "Temple of the Kings allows Trap activation on the turn Set.";
    const value = input.sentences
      ? (checks++, { checks: input.sentences.map((item: { id: number }) => ({ id: item.id, supported: "yes" })) })
      : { verdict: "valid", grade: "good", format_ok: true, pros: [], cons: [sentence], lock_note: "", line: ["Temple of the Kings"],
        grounding: [{ field: "cons", sentence, citations: [{ card: "Temple of the Kings", quote: "You can activate 1 Trap Card the turn it was Set." }] }] };
    return new Response(JSON.stringify({ id: `msg_fixture_${++calls}`, model: request.model, stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 10 }, content: [{ type: "text", text: JSON.stringify(value) }] }),
    { headers: { "Content-Type": "application/json" } });
  } });
  try {
    const options = { client, log: () => {} };
    const first = await judgeStoredStrict(db, options);
    expect(first.advanced).toEqual({ total: 2, accepted: 2, rejected: 0, disputed: 0, pending: 0 });
    expect(first.genesys.total).toBe(0);
    expect(first.requests).toBe(8); expect(checks).toBe(4);
    expect(first.costUsd).toBe(0.00012); expect(first.reservedUsd).toBe(0);
    expect(db.prepare("SELECT count(*) AS n FROM bridge_judgement").get()).toEqual({ n: 4 });
    const second = await judgeStoredStrict(db, options);
    expect(second.requests).toBe(0); expect(second.costUsd).toBe(0); expect(calls).toBe(8);
  } finally { db.close(); }
}, 120_000);
