"use client";

import { useCallback, useEffect, useMemo, type ReactNode, type RefObject, type TransitionEvent } from "react";
import type { DuelCard, DuelEngineView, DuelPromptOption, DuelSeatView } from "@yugidraft/shared/duels";
import { cn } from "@/lib/utils";
import type { BattleAim } from "../battle-fx";
import type { BoardTilt, BoardView } from "../board-view";
import { LOCATION_DMZONE, zoneKey } from "../constants";
import { masterCard } from "../field";
import { withExact } from "../field-keys";
import { duelFontClasses } from "../fonts";
import type { DuelFieldProps } from "../field-model";
import type { InspectTarget } from "../inspector";
import type { DuelPreferences } from "../preferences";
import { useQuietViewChange } from "../quiet-view-change";
import { DuelSkinProvider } from "../skin";
import { useIsNarrow, type SidePane } from "../side-panel";
import type { BattleStep } from "../station-track";
import { DmChipActionsContext, type DmChipActions } from "./dm-chip";
import { SolidDmSummonFx } from "./dm-summon-fx";
import { solidFontClasses } from "./fonts";
import { useSolidFx3dSync } from "./fx-sync";
import { PeekBar } from "./peek-bar";
import { SolidField } from "./solid-field";
import { SolidHeader } from "./solid-header";
import { SOLID_SKIN } from "./skins";
import styles from "./solid-room.module.css";

/** What `DuelRoomView` hands to the 3D mode page: the same pieces it builds for the flat page, plus the board view. */
export type SolidRoomProps = {
  slug: string;
  /** The element the FX layers and the board measure. It must stay untransformed (spec 2.2). */
  boardRef: RefObject<HTMLDivElement | null>;
  /** The opening hands wait hidden until the card layers deal them. */
  dealWait: boolean;
  domain: boolean;
  battle: boolean;
  spectator: boolean;
  myTurn: boolean;
  reducedMotion: boolean;
  view: BoardView;
  preferences: DuelPreferences;
  engine: DuelEngineView | null;
  mySeat: number | null;
  playerName: (seat: number) => string;
  /** "MR5 · Normal", "Domain · Normal" ... */
  format: string;
  turnText: string | null;
  headerPhase: string;
  battleStep: BattleStep | null;
  wordmark: ReactNode;
  spectatorTag: ReactNode;
  seriesLabel: ReactNode;
  /** The live dot and its label. */
  connectionStatus: ReactNode;
  headerTools: ReactNode;
  seriesBanner: ReactNode;
  noticesNode: ReactNode;
  inspectorNode: ReactNode;
  promptDockNode: ReactNode;
  masterRail: ReactNode;
  /** The Deck Master actions the rail offers (`DeckMasterRail`); the chip on the phone rails offers the same ones. */
  legalActionsFor: (card: DuelCard | null, keys: string[]) => DuelPromptOption[];
  onChooseAction: (option: DuelPromptOption) => void;
  /** The room's attack aim. The arrow is drawn on the plane; the room passes `aim={null}` to `BattleFx`. */
  battleAim?: BattleAim | null;
  trackNode: ReactNode;
  /** The narrow-screen tab bar that opens the side sheet. */
  mobileTabs: ReactNode;
  overlaysNode: ReactNode;
  /** The props of the 1v1 field; null until the engine view is up. */
  fieldProps: DuelFieldProps | null;
  /** MoveSourceBoundary around the given field, plus the FX layers, the prompt layer and the pile viewer. */
  renderBoard: (field: ReactNode) => ReactNode;
  /** One seat's duel clock, drawn in that player's gap of the centre band. It is the only clock of the 3D room. */
  renderClock: (seat: number) => ReactNode;
  inspect: InspectTarget | null;
  pane: SidePane;
  setPane: (pane: SidePane) => void;
  setMobileInspect: (open: boolean) => void;
  /** True when nothing moves on the board (`boardQuietNow`). A view change waits for it (spec 2.3). */
  boardQuiet: () => boolean;
  /** Runs right before a view change: close the card menu and the hover info. */
  onBeforeViewChange: () => void;
};

/**
 * The room in 3D mode (Solid Vision): a header, the inspector, the tilted table, the phase bar and (domain duels) the
 * Deck Master docks. Every piece is built by `DuelRoomView`; this file only lays them out and owns the quiet-gated
 * change of the table view. It is loaded lazily, so the classic board never pays for it.
 */
export function SolidRoom(props: SolidRoomProps) {
  const { slug, boardRef, dealWait, domain, battle, spectator, myTurn, reducedMotion, view, engine, format, turnText, headerPhase,
    battleStep, wordmark, spectatorTag, seriesLabel, connectionStatus, headerTools, seriesBanner, noticesNode, inspectorNode,
    promptDockNode, masterRail, legalActionsFor, onChooseAction, battleAim, trackNode, mobileTabs, overlaysNode, fieldProps, renderBoard, renderClock, inspect, setPane, setMobileInspect,
    boardQuiet, onBeforeViewChange } = props;
  const narrow = useIsNarrow();
  // The tilted plane, found when asked (it mounts once the engine view is up). The FX canvas follows its tilt.
  const planeRef = useMemo<RefObject<Element | null>>(() => ({
    get current() { return boardRef.current?.querySelector("[data-sv-plane]") ?? null; },
  }), [boardRef]);
  useSolidFx3dSync(planeRef, view);
  const planeUp = fieldProps != null;
  useEffect(() => {
    // The plane appeared after the first sync: read the tilt again.
    if (planeUp) window.dispatchEvent(new Event("resize"));
  }, [planeUp]);
  const chipActions = useMemo<DmChipActions>(() => ({
    actionsFor: (seatView: DuelSeatView) => {
      const card = masterCard(seatView);
      return legalActionsFor(card, withExact(card, [zoneKey(seatView.seat, LOCATION_DMZONE, 0)]));
    },
    onChoose: onChooseAction,
  }), [legalActionsFor, onChooseAction]);
  const changeView = useQuietViewChange(boardQuiet, onBeforeViewChange);
  const onTilt = useCallback((tilt: BoardTilt) => {
    if (tilt === view.tilt) return;
    changeView(() => {
      view.setTilt(tilt);
      // The plane changes shape. With no transition (reduced motion) nothing fires transitionend, so tell the
      // measuring code (hover info, FX anchors) once the new layout is in.
      if (reducedMotion) window.requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    });
  }, [changeView, view, reducedMotion]);
  // Anything that measured the plane before the tilt moved re-measures when the transition ends.
  const onTransitionEnd = useCallback((event: TransitionEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (event.propertyName === "transform" && target.hasAttribute("data-sv-plane")) window.dispatchEvent(new Event("resize"));
  }, []);
  const openPane = (pane: SidePane) => {
    setPane(pane);
    setMobileInspect(true);
  };
  const onGear = () => {
    setPane("settings");
    // Narrow: the settings live in the sheet. Wide: the inspector shows them.
    if (narrow) setMobileInspect(true);
  };
  const turnSeat = engine?.turnSeat ?? null;
  const bottomSeat = props.mySeat ?? 0;
  const light = turnSeat == null || turnSeat === bottomSeat ? "you" : "opp";

  return (
    <DmChipActionsContext.Provider value={chipActions}>
    <div
      className={cn(styles.root, duelFontClasses, solidFontClasses, "-mx-4 -my-4 sm:-mx-6 sm:-my-6 lg:-mx-8 lg:-my-8")}
      data-duel-fx-speed-root
      data-look="solid"
      data-view={view.tilt}
      data-light={light}
      data-domain={domain}
      data-phase={battle ? "battle" : undefined}
      data-turn={spectator ? "watch" : myTurn ? "you" : "opp"}
      data-reduced={reducedMotion ? "true" : "false"}
      onTransitionEnd={onTransitionEnd}
    >
      <DuelSkinProvider value={SOLID_SKIN}>
        <SolidHeader
          identity={<>{wordmark}{spectatorTag}</>}
          format={format}
          turn={engine?.turn ?? "—"}
          phaseName={headerPhase}
          step={battleStep}
          turnText={turnText}
          tone={spectator ? "watch" : myTurn ? "you" : "opp"}
          spectator={spectator}
          live={<>{seriesLabel}{connectionStatus}</>}
          tools={headerTools}
          view={view.tilt}
          onTilt={onTilt}
          onGear={onGear}
        />
        {seriesBanner ? <div className={styles.banner}>{seriesBanner}</div> : null}
        {noticesNode}
        <aside className={styles.insp} aria-label="Inspector">
          {inspectorNode}
        </aside>
        {promptDockNode}
        <main className={styles.stage} aria-label="Duel field">
          <div className={styles.board} ref={boardRef} data-deal-wait={dealWait ? "true" : undefined} data-prompt-scope>
            {renderBoard(fieldProps ? (
              <>
                <SolidField key={slug} {...fieldProps} renderClock={renderClock} onOpenMasters={() => openPane("masters")} battleAim={battleAim ?? null} />
                {engine ? <SolidDmSummonFx events={engine.events} seats={engine.seats} duelKey={slug} reducedMotion={reducedMotion} planeRef={planeRef} /> : null}
              </>
            ) : null)}
          </div>
          <div className={styles.phase} data-sv-phasebar="">{trackNode}</div>
          <div className={styles.peek}>
            <PeekBar target={inspect} onCard={() => openPane("card")} onLog={() => openPane("log")} />
          </div>
        </main>
        {masterRail ? <aside className={styles.docks} aria-label="Deck Masters">{masterRail}</aside> : null}
        {mobileTabs ? <div className={styles.mobileBar}>{mobileTabs}</div> : null}
        {overlaysNode}
      </DuelSkinProvider>
    </div>
    </DmChipActionsContext.Provider>
  );
}
