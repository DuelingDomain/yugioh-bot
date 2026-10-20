import React, { useMemo, useReducer, useState } from "react";
import { createRoot } from "react-dom/client";
import type { DuelAnswer, DuelEngineView, DuelPrompt } from "@yugidraft/shared/duels";
import { DuelField, SeatField } from "../src/components/duel/field";
import { PromptCenter } from "../src/components/duel/prompt-center";
import { usePromptDraft } from "../src/components/duel/prompts";
import { TAG_FIXTURES, TAG_TEAM_NAMES } from "../src/components/duel/tag/fixtures";
import { initialRoofCamera, roofReducer } from "../src/components/duel/tag/roof-camera";
import { TagStage } from "../src/components/duel/tag/tag-stage";
import { tableLayout } from "../src/components/duel/table/geometry";
import { useFixtureController } from "../src/components/duel/table/fixtures/use-fixture-controller";
import type { SeatTone } from "../src/components/duel/table/types";

// Test-only render harness: the real field and the real PromptCenter over the engine's own detach prompt. A submitted answer is
// kept in window.__answers; the runner sends it to the engine and checks the Graveyard.
const data: { engine: DuelEngineView; prompt: DuelPrompt; mySeat: number; multi: boolean } = JSON.parse(document.getElementById("engine-view")!.textContent!);
const noop = () => undefined;
const TONES: SeatTone[] = ["violet", "ice", "verdant", "rose"];
const sent: DuelAnswer[] = [];
Object.assign(window, { __answers: sent });
const callbacks = { legalKeys: new Set<string>(), selectedKeys: new Set<string>(), reducedMotion: true, onActivate: noop, onInspect: noop };

/** The Tag stage (2v2 Rooftop) with the engine's Xyz on your field, and the real PromptCenter in its prompt slot, as the Tag room mounts it. */
function TagHarness() {
  const state = useMemo(() => {
    const clone = structuredClone(TAG_FIXTURES.states.main);
    const engine = clone.room.engine!;
    const xyz = data.engine.seats[0].monsters.find((card) => card?.materials?.length)!;
    engine.seats[0].monsters[2] = { ...xyz, controller: 0, sequence: 2 };
    engine.prompt = data.prompt;
    return clone;
  }, []);
  const controller = useFixtureController(state, { reducedMotion: true });
  const [prompt, setPrompt] = useState<DuelPrompt | null>(data.prompt);
  const draft = usePromptDraft(prompt);
  const layout = tableLayout("tag", controller.engine, controller.viewerSeat);
  const [camera, dispatch] = useReducer(roofReducer, undefined, () => initialRoofCamera({ anchorSeat: layout.anchorSeat }));
  return (
    <div style={{ position: "relative", width: "100%", height: "86vh" }} data-harness-board>
      <TagStage controller={{ ...controller, prompt }} layout={layout} camera={camera} dispatchCamera={dispatch}
        renderSeatField={(props) => <SeatField {...props} />} teamNames={TAG_TEAM_NAMES}
        promptCenter={
          <PromptCenter prompt={prompt} mySeat={controller.viewerSeat} active slug="proof" busy={false} draft={draft}
            onSubmit={(answer) => { sent.push(answer); setPrompt(null); }} menuOpen={false} chain={[]} aimLocked={false} reducedMotion revision={0} />
        } />
    </div>
  );
}

function Harness() {
  const [prompt, setPrompt] = useState<DuelPrompt | null>(data.prompt);
  const draft = usePromptDraft(prompt);
  return (
    <div style={{ position: "relative", width: "100%", height: data.multi ? "560px" : "760px", overflow: "hidden" }} data-harness-board>
      {data.multi ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {data.engine.seats.slice(0, 2).map((seat) => (
            <SeatField key={seat.seat} engine={data.engine} seat={seat.seat} viewerSeat={data.mySeat} masterRule={5} side={seat.seat === data.mySeat ? "you" : "opp"}
              angleDeg={0} tone={TONES[seat.seat]} density="full" hand="none" emz="own" showTally usable={seat.seat === data.mySeat}
              name={`Player ${seat.seat + 1}`} {...callbacks} />
          ))}
        </div>
      ) : (
        <DuelField engine={data.engine} mySeat={data.mySeat} masterRule={5} {...callbacks} bottomName="You" topName="Opponent" />
      )}
      <PromptCenter prompt={prompt} mySeat={data.mySeat} active slug="proof" busy={false} draft={draft}
        onSubmit={(answer) => { sent.push(answer); setPrompt(null); }} menuOpen={false} chain={[]} aimLocked={false} reducedMotion revision={0} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(new URLSearchParams(location.search).has("tag") ? <TagHarness /> : <Harness />);
