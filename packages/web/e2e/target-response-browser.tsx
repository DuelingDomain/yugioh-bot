import React from "react";
import { createRoot } from "react-dom/client";
import type { DuelChainLink, DuelEngineView, DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";
import { DuelField } from "../src/components/duel/field";
import { ChainFx } from "../src/components/duel/chain-fx";
import { PromptCenter } from "../src/components/duel/prompt-center";
import { promptLegalKeys, promptSelectedKeys, type PromptDraft } from "../src/components/duel/prompts";

// Test-only render harness: no login, API mocks, DB writes, or production route changes.
const engine: DuelEngineView = JSON.parse(document.getElementById("engine-view")!.textContent!);
const provided = new URLSearchParams(location.search).has("provided-target");
if (provided) {
  const targets = [{ controller: 1, location: 8, sequence: 0 }];
  (engine.chain[0] as DuelChainLink & { targets: DuelZoneRef[] }).targets = targets;
  const activation = engine.events.findLast((event) => event.kind === "activate" && event.chainIndex === 1);
  if (activation) (activation as DuelEvent & { targets: DuelZoneRef[] }).targets = targets;
}
const noop = () => undefined;
const draft: PromptDraft = {
  selected: [], setSelected: noop, counts: {}, setCounts: noop, value: 0, setValue: noop,
  cardCode: null, setCardCode: noop, highlight: 0, setHighlight: noop,
};

createRoot(document.getElementById("root")!).render(<>
  <h1>MST target at the opponent's response window</h1>
  <p>Real stock-core snapshot · turn {engine.turn} · responding seat 1 · {provided ? "proposed target data supplied" : "current server data"}</p>
  <div style={{ position: "relative", width: "100%", height: "760px" }}>
    <DuelField engine={engine} mySeat={1} masterRule={5} reducedMotion
      legalKeys={promptLegalKeys(engine.prompt)} selectedKeys={promptSelectedKeys(engine.prompt, [])}
      onActivate={noop} onInspect={noop} bottomName="Responder" topName="MST activator" />
    <ChainFx events={engine.events} chain={engine.chain} duelKey={provided ? "supplied-target" : "real-target"}
      reducedMotion mySeat={1} seats={engine.seats} playerName={(seat) => seat === 1 ? "Responder" : "MST activator"} />
    <PromptCenter prompt={engine.prompt} mySeat={1} active slug="target-response" busy={false}
      draft={draft} onSubmit={noop} menuOpen={false} chain={engine.chain} aimLocked={false}
      reducedMotion revision={engine.revision} />
  </div>
</>);
