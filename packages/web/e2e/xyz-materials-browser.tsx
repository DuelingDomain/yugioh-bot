import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { DuelCard, DuelEngineView } from "@yugidraft/shared/duels";
import { CardActionMenu, materialsMenu } from "../src/components/duel/card-interactions";
import { DuelField, SeatField } from "../src/components/duel/field";
import { CardInspector, type InspectTarget } from "../src/components/duel/inspector";
import { PileViewer } from "../src/components/duel/pile-viewer";
import { SEAT_TONE_HEX, type SeatTone } from "../src/components/duel/table/types";

// Test-only render harness: the real field, badge, Materials view, inspector and card menu, wired like the room wires them.
const data: { engine: DuelEngineView; mySeat: number; multi: boolean } = JSON.parse(document.getElementById("engine-view")!.textContent!);
const { engine, mySeat, multi } = data;
const noop = () => undefined;
const TONES: SeatTone[] = ["violet", "ice", "verdant", "rose"];
const xyzCard = (): DuelCard => engine.seats[0].monsters.find((card) => card?.code != null)!;

function Harness() {
  const [pile, setPile] = useState<{ title: string; cards: DuelCard[] } | null>(null);
  const [inspect, setInspect] = useState<InspectTarget | null>({ type: "card", card: xyzCard() });
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const showInspector = (target: InspectTarget) => {
    if (target.type === "pile") setPile({ title: target.title, cards: target.cards });
    else setInspect(target);
  };
  // `?menu=1` opens the card menu on the Xyz, as a click on it would while a prompt offers an action.
  useEffect(() => {
    if (new URLSearchParams(location.search).has("menu")) {
      setMenuAnchor(document.querySelector<HTMLElement>('[data-card-frame] [data-materials-badge]')?.closest("button") ?? null);
    }
  }, []);
  const callbacks = { legalKeys: new Set<string>(), selectedKeys: new Set<string>(), reducedMotion: true, onActivate: noop, onInspect: showInspector };
  const card = xyzCard();
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 260px", gap: 12 }}>
      <div ref={boxRef} style={{ position: "relative", width: "100%", height: multi ? "560px" : "760px" }} data-harness-board>
        {multi ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {engine.seats.slice(0, 2).map((seat) => (
              <SeatField key={seat.seat} engine={engine} seat={seat.seat} viewerSeat={mySeat} masterRule={5} side={seat.seat === mySeat ? "you" : "opp"}
                angleDeg={0} tone={TONES[seat.seat]} density="full" hand="none" emz="own" showTally usable={seat.seat === mySeat}
                name={`Player ${seat.seat + 1}`} {...callbacks} />
            ))}
          </div>
        ) : (
          <DuelField engine={engine} mySeat={mySeat} masterRule={5} {...callbacks} bottomName="You" topName="Opponent" />
        )}
        {pile ? (
          <PileViewer title={pile.title} cards={pile.cards} owner="you" open onClose={() => setPile(null)}
            onInspectCard={(material) => setInspect({ type: "card", card: material })}
            onHoverCard={(material) => setInspect({ type: "card", card: material })} reducedMotion />
        ) : null}
      </div>
      <aside style={{ background: "#171a24", borderRadius: 8, minHeight: 200, overflow: "auto", maxHeight: 760 }} data-harness-inspector>
        <CardInspector target={inspect} onViewMaterials={showInspector} />
      </aside>
      {menuAnchor ? (
        <CardActionMenu anchor={menuAnchor} title={card.name ?? "Card"} options={[{ id: "activate:0", label: "Activate effect" } as never]} busy={false} tone="action"
          onChoose={noop} onClose={() => setMenuAnchor(null)}
          materials={materialsMenu(card, (target) => { setMenuAnchor(null); showInspector(target); })} />
      ) : null}
    </div>
  );
}

void SEAT_TONE_HEX;
createRoot(document.getElementById("root")!).render(<Harness />);
