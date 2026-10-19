import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import type { DuelAnswer, DuelEngineView, DuelPrompt } from "@yugidraft/shared/duels";
import { DuelField, SeatField } from "../src/components/duel/field";
import { PromptCenter } from "../src/components/duel/prompt-center";
import { usePromptDraft } from "../src/components/duel/prompts";
import type { SeatTone } from "../src/components/duel/table/types";

// Test-only render harness: the real field and the real PromptCenter over the engine's own detach prompt. A submitted answer is
// kept in window.__answers; the runner sends it to the engine and checks the Graveyard.
const data: { engine: DuelEngineView; prompt: DuelPrompt; mySeat: number; multi: boolean } = JSON.parse(document.getElementById("engine-view")!.textContent!);
const noop = () => undefined;
const TONES: SeatTone[] = ["violet", "ice", "verdant", "rose"];
const sent: DuelAnswer[] = [];
Object.assign(window, { __answers: sent });
const callbacks = { legalKeys: new Set<string>(), selectedKeys: new Set<string>(), reducedMotion: true, onActivate: noop, onInspect: noop };

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

createRoot(document.getElementById("root")!).render(<Harness />);
