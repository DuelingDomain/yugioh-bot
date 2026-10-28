import Database from "better-sqlite3";
import { beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../src/db/schema.js";
import { importBridgeArtifact } from "../src/cards/effects/bridge-artifact.js";
import { BridgeEngine } from "../src/cards/effects/bridge-engine.js";
import type { BridgeGraphData } from "../src/cards/effects/bridge-types.js";

let data: BridgeGraphData;
beforeAll(() => {
  const db = new Database(":memory:");
  try {
    migrate(db); importBridgeArtifact(db);
    const graph = JSON.parse((db.prepare("SELECT graph_json FROM bridge_graph WHERE id=1").get() as { graph_json: string }).graph_json);
    const capabilities = (db.prepare("SELECT capabilities_json FROM card_capability ORDER BY passcode").all() as { capabilities_json: string }[])
      .map(row => JSON.parse(row.capabilities_json));
    data = { ...graph, capabilities };
  } finally { db.close(); }
});

describe("round 3 bridge rules on the pinned catalog", () => {
  it("preserves named fan-out into real engine members and rejects label filler", () => {
    const engine = new BridgeEngine(data);
    for (const format of ["advanced", "genesys"] as const) {
      for (const [source, target] of [["Diabell", "Snake-Eye"], ["Azamina", "Diabell"], ["Diabell", "Azamina"], ["Azamina", "Snake-Eye"],
        ["Zefra", "Yang Zing"], ["Zefra", "Nekroz"], ["Zefra", "Ritual Beast"]]) {
        if (format === "genesys" && source === "Zefra") continue; // Its Pendulum entry cards are barred.
        expect(engine.between(source!, target!, format), `${source} -> ${target} (${format})`).not.toBeNull();
      }
      for (const target of ["Chaos", "Void"]) {
        expect(engine.between("Traptrix", target, format), `Traptrix -> ${target}`).toBeNull();
      }
    }
    const groups = Object.fromEntries(["Diabell", "Snake-Eye", "Azamina", "Sinful Spoils", "White Forest"].map(name => [name, data.groups[name]!]));
    const rebuilt = new BridgeEngine({ ...data, groups, target_means: { advanced: {}, genesys: {} }, materials: undefined });
    rebuilt.rebuild();
    for (const format of ["advanced", "genesys"] as const) {
      expect(rebuilt.data.ancillary_outlets?.[format]?.[72270339]).toBeUndefined(); // Diabellstar the Black Witch.
      expect(rebuilt.reasons("Diabell", "Snake-Eye", format).some(reason => reason.key === "reach" && !reason.ancillary)).toBe(true);
    }
  }, 15_000);
});
