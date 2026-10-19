import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { DuelCard, DuelEngineView } from "@yugidraft/shared/duels";
import { CardActionMenu, materialsMenu } from "../src/components/duel/card-interactions";
import { zoneKey } from "../src/components/duel/constants";
import { DuelField, SeatField } from "../src/components/duel/field";
import { CardInspector, type InspectTarget } from "../src/components/duel/inspector";
import { livePileCards, livePileTitle, type PileView } from "../src/components/duel/pile-focus";
import { PileViewer } from "../src/components/duel/pile-viewer";
import { TAG_FIXTURES, TAG_TEAM_NAMES } from "../src/components/duel/tag/fixtures";
import { initialRoofCamera, roofReducer } from "../src/components/duel/tag/roof-camera";
import { TagStage } from "../src/components/duel/tag/tag-stage";
import { tableLayout } from "../src/components/duel/table/geometry";
import { useFixtureController } from "../src/components/duel/table/fixtures/use-fixture-controller";
import type { SeatTone } from "../src/components/duel/table/types";

// Test-only render harness: the real field, badge, Materials view, inspector and card menu, wired like the room wires them.
// Query flags: menu=1 opens the card menu on the Xyz, legal=1 makes both Xyz legal targets, equip=1 equips the Xyz, tag=1 uses the Tag stage.
const data: { engine: DuelEngineView; mySeat: number; multi: boolean } = JSON.parse(document.getElementById("engine-view")!.textContent!);
const params = new URLSearchParams(location.search);
const noop = () => undefined;
const TONES: SeatTone[] = ["violet", "ice", "verdant", "rose"];
const legalFlag = params.has("legal");
const tagFlag = params.has("tag");
const MZONE = 0x04;
const SZONE = 0x08;

/** The engine view with a second Xyz on the rival's side (its badge sits at the bottom of the card) and, with equip=1, an equip card on yours. */
function withExtras(engine: DuelEngineView, mine: DuelCard, rivalSeat: number, mineSlot: number, rivalSlot: number): DuelEngineView {
  const next = structuredClone(engine);
  const own = { ...mine, sequence: mineSlot };
  next.seats[mine.controller].monsters[mine.sequence] = null;
  next.seats[mine.controller].monsters[mineSlot] = own;
  next.seats[rivalSeat].monsters[rivalSlot] = { ...own, controller: rivalSeat, sequence: rivalSlot };
  if (params.has("equip")) {
    next.seats[mine.controller].spells[0] = { ...own, location: SZONE, sequence: 0, materials: undefined, equippedTo: { controller: own.controller, location: MZONE, sequence: mineSlot } };
    next.seats[rivalSeat].spells[0] = { ...own, controller: rivalSeat, location: SZONE, sequence: 0, materials: undefined, equippedTo: { controller: rivalSeat, location: MZONE, sequence: rivalSlot } };
  }
  return next;
}

const baseXyz = (engine: DuelEngineView): DuelCard => engine.seats[0].monsters.find((card) => card?.code != null)!;
const xyzKeys = (engine: DuelEngineView): Set<string> =>
  new Set(engine.seats.flatMap((seat) => seat.monsters.filter((card) => card?.materials?.length).map((card) => zoneKey(card!.controller, card!.location, card!.sequence))));

function Harness() {
  const [engine, setEngine] = useState<DuelEngineView>(() => withExtras(data.engine, baseXyz(data.engine), 1, 1, 1));
  const [pile, setPile] = useState<PileView | null>(null);
  const xyzCard = (): DuelCard => engine.seats[0].monsters.find((card) => card?.materials?.length)!;
  const [inspect, setInspect] = useState<InspectTarget | null>(() => ({ type: "card", card: xyzCard() }));
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const showInspector = (target: InspectTarget) => {
    if (target.type === "pile") setPile({ title: target.title, owner: "you", cards: target.cards, open: true, host: target.host });
    else setInspect(target);
  };
  // `?menu=1` opens the card menu on the Xyz, as a click on it would while a prompt offers an action.
  useEffect(() => {
    if (params.has("menu")) setMenuAnchor(document.querySelector<HTMLElement>("[data-materials-badge]")?.closest("button") ?? null);
    // Test hooks: detach the first material of every Xyz, turn the Xyz face-down, or take it off the field, while a view is open.
    const change = (edit: (card: DuelCard) => DuelCard | null) =>
      setEngine((current) => ({ ...current, seats: current.seats.map((seat) => ({ ...seat, monsters: seat.monsters.map((card) => (card?.materials?.length ? edit(card) : card)) })) }));
    Object.assign(window, {
      __detachOne: () => change((card) => ({ ...card, materials: card.materials?.slice(1) })),
      __flipDown: () => change((card) => ({ ...card, position: 0x8 })),
      __removeXyz: () => change(() => null),
    });
  }, []);
  const callbacks = { legalKeys: legalFlag ? xyzKeys(engine) : new Set<string>(), selectedKeys: new Set<string>(), reducedMotion: true, onActivate: noop, onInspect: showInspector };
  const card = xyzCard();
  const cards = pile ? livePileCards(pile, engine, data.mySeat) : [];
  return (
    <div style={{ display: "grid", gridTemplateColumns: data.multi && window.innerWidth < 700 ? "minmax(0,1fr)" : "minmax(0,1fr) 260px", gap: 12 }}>
      <div style={{ position: "relative", width: "100%", height: data.multi ? "560px" : "760px", overflow: data.multi ? "auto" : undefined }} data-harness-board>
        {data.multi ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {engine.seats.slice(0, 2).map((seat) => (
              <SeatField key={seat.seat} engine={engine} seat={seat.seat} viewerSeat={data.mySeat} masterRule={5} side={seat.seat === data.mySeat ? "you" : "opp"}
                angleDeg={0} tone={TONES[seat.seat]} density="full" hand="none" emz="own" showTally usable={seat.seat === data.mySeat}
                name={`Player ${seat.seat + 1}`} {...callbacks} />
            ))}
          </div>
        ) : (
          <DuelField engine={engine} mySeat={data.mySeat} masterRule={5} {...callbacks} bottomName="You" topName="Opponent" />
        )}
        {pile ? (
          <PileViewer title={livePileTitle(pile, cards)} cards={cards} owner="you" open onClose={() => setPile(null)}
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

/** The Tag stage (2v2 Rooftop) with an Xyz on your field and one on a rival's field. A tap on a badge opens the Materials view. */
function TagHarness() {
  const state = useMemo(() => {
    const clone = structuredClone(TAG_FIXTURES.states.main);
    const engine = withExtras(clone.room.engine!, baseXyz(data.engine), 1, 3, 4);
    // The fixture seats are 0..3: the Xyz of seat 0 moves in at zone 3, the one of seat 1 (a rival) at zone 4.
    const own = { ...baseXyz(data.engine), controller: 0, sequence: 3 };
    engine.seats[0].monsters[3] = own;
    clone.room.engine = engine;
    return clone;
  }, []);
  const base = useFixtureController(state, { reducedMotion: true });
  const [pile, setPile] = useState<PileView | null>(null);
  const controller = useMemo(() => ({
    ...base,
    legalKeys: legalFlag ? xyzKeys(base.engine) : base.legalKeys,
    onInspect: (target: InspectTarget) => { if (target.type === "pile") setPile({ title: target.title, owner: "you", cards: target.cards, open: true, host: target.host }); },
  }), [base]);
  const layout = tableLayout("tag", controller.engine, controller.viewerSeat);
  const [camera, dispatch] = useReducer(roofReducer, undefined, () => initialRoofCamera({ anchorSeat: layout.anchorSeat }));
  const cards = pile ? livePileCards(pile, controller.engine, controller.viewerSeat) : [];
  const stage = useRef<HTMLDivElement>(null);
  return (
    <div ref={stage} style={{ position: "relative", width: "100%", height: "86vh" }} data-harness-board>
      <TagStage controller={controller} layout={layout} camera={camera} dispatchCamera={dispatch}
        renderSeatField={(props) => <SeatField {...props} />} teamNames={TAG_TEAM_NAMES} />
      {pile ? <PileViewer title={livePileTitle(pile, cards)} cards={cards} owner="you" open onClose={() => setPile(null)} onInspectCard={noop} reducedMotion /> : null}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(tagFlag ? <TagHarness /> : <Harness />);
