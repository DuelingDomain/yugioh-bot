"use client";

import { eliminationOrder } from "@/lib/duel/elimination-order";
import { connectionLabel as labelForConnection } from "../connection-label";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { Circle, Diamond, Eye, Radio, Volume2, VolumeX } from "lucide-react";
import type { DuelCard } from "@yugidraft/shared/duels";
import { isCustomDomain } from "@yugidraft/shared/duels";
import { BattleFx } from "../battle-fx";
import { AttackConfirm, CardActionMenu, CardHoverInfo, confirmSide, targetName } from "../card-interactions";
import { ChainFx } from "../chain-fx";
import { isBattlePhase, phaseTitle, zoneKey } from "../constants";
import { DestroyFx } from "../destroy-fx";
import { DuelResultScreen } from "../duel-result";
import { resolveEquipLinks } from "../equip-links";
import { DuelFeedback } from "../feedback";
import { DeckMasterRail, SeatField } from "../field";
import { FxBoundary, MoveSourceBoundary } from "../fx-boundary";
import { duelFontClasses } from "../fonts";
import { DuelHistoryRail } from "../history-rail";
import { CardInspector, type InspectTarget } from "../inspector";
import { MasterReturnFx } from "../master-return-fx";
import { MoveFx } from "../move-fx";
import { engineFormat, formatLabel, leavingOnlySeats, outOrLeavingSeats, outSeatOptionIds } from "../multi-seat";
import { PileViewer } from "../pile-viewer";
import { livePileCards } from "../pile-focus";
import { MatchSheetLog } from "../text-log";
import { PositionFx } from "../position-fx";
import { centerKind, PromptCenter } from "../prompt-center";
import { optionsForCard, PromptTray } from "../prompts";
import { priorityOrder } from "../priority-chips";
import { usePickContinuation, type PickContinuation } from "../pick-continuation";
import { useResultGate } from "../result-reveal";
import { firstInspectCard } from "../tag/tag-logic";
import { DuelClockDisplay } from "../room-settings";
import { SeatStrip } from "../seat-strip";
import { SeriesBanner } from "../series-banner";
import { CardTabEmpty, DESKTOP_PANES, desktopPane, SidePanel, SideTabs, useIsNarrow } from "../side-panel";
import { battleStepLabel, hasNoLegalMoves, resolveBattleStep, StationTrack, type BattleStep } from "../station-track";
import { SummonFx } from "../summon-fx";
import { useDuelPreferences, type DuelPreferences } from "../preferences";
import type { ChainModeControl } from "../use-chain-mode";
import roomStyles from "../room.module.css";
import { CameraControls } from "./camera-controls";
import { tableLayout } from "./geometry";
import { GridStage } from "./grid-stage";
import { useGridFocus } from "./grid-focus";
import { GridMasterToken } from "./grid-master";
import { GridHoverPreview } from "./grid-preview";
import { ChainList, ChainTower, DOCK_PANES, GridDock, GridFlyout, useHudDismiss, type HudPane } from "./grid-hud";
import { gridCells, usesGridLayout } from "./grid-layout";
import { HistoryStrip } from "./history-strip";
import { OpponentBar } from "./opponent-bar";
import { attackLockAt, placeLabel, placings, toneBySeat, trackOutOrder } from "./seat-state";
import { TableSettings, type TableConnection } from "./table-settings";
import { TablePhonePanes } from "./table-phone-panes";
import { TableStage } from "./table-stage";
import { tableZoneAnchor } from "./zone-find";
import { AimArrow } from "./aim-arrow";
import { useAimFlow } from "./use-aim-flow";
import { useCamera } from "./use-camera";
import { useTableUi } from "./use-table-ui";
import { SEAT_TONE_HEX, type CameraLockReason, type CameraState, type TableController, type TableFormat } from "./types";
import hudStyles from "./grid-hud.module.css";
import styles from "./table-shell.module.css";

/** Panes that stay mounted while hidden, so they keep the rows they built (the log counts the new ones). */
const HUD_KEEP: readonly HudPane[] = ["log"];

export interface TableShellActions {
  onExit?: () => void;
  onSeriesChanged?: () => void;
  onNavigate?: (slug: string) => void;
}

export interface TableShellProps {
  controller: TableController;
  /** Live duel pages have no height-bound parent; previews keep their container's height. */
  fillViewport?: boolean;
  /** Starting camera; the preview passes what its URL asks for. */
  initialCamera?: Partial<CameraState>;
  /** Start with the FX lock on (the preview shows the chip with it). It stays on until the page reloads. */
  initialLock?: CameraLockReason | null;
  /** What the room does with the result screen and the series. A preview leaves them out. */
  actions?: TableShellActions;
  /**
   * Losses before mount, earliest first. Engine groups and retained elimination logs update this history live.
   * Seats whose older losses cannot be recovered share a place.
   */
  initialOutOrder?: readonly (readonly number[])[];
  /**
   * Seams for the room that mounts this shell on a live duel (plan section 1). Each one is optional and a preview leaves
   * them out.
   * `fxActive`: false while the connection is down or recovering, so no FX replays old events (room: `!error && !recovering`).
   * `busy`: the room is working or catching up; it blocks answers like the controller's own `busy` does.
   * `headerTools`: extra header controls, such as the Surrender button.
   * `modals`: dialogs the room owns, such as the surrender confirm.
   */
  fxActive?: boolean;
  busy?: boolean;
  headerTools?: ReactNode;
  modals?: ReactNode;
  notices?: ReactNode;
  settingsTools?: ReactNode;
  connection?: TableConnection;
  /** Live rooms own continuation timing alongside their reveal gate. Previews track it locally. */
  pickContinuation?: PickContinuation;
  /** A room modal owns keyboard input while open. */
  inputSuspended?: boolean;
  /** The room's prompt reveal gate must wait on this shell's board effects. */
  boardRef?: RefObject<HTMLDivElement | null>;
  /**
   * The room's one preferences instance. The room already feeds its Motion setting to the controller and the FX speed
   * clock, so the shell's Settings tab must change that same state. A preview leaves it out and gets its own.
   */
  preferences?: DuelPreferences;
  /** The viewer's chain response switch, owned by the room (it sends the change and holds the R key). Null or absent: no switch. */
  chainMode?: ChainModeControl | null;
}

/**
 * The whole table of a 3 or 4 seat duel: header, history and card tabs, the stage, the Deck Master column, the station
 * track, menus, the result screen and the FX. It uses the exported duel components of the 1v1 room and keeps the room's
 * look (room.module.css). The room itself stays the owner of the live engine: it passes a controller.
 */
export function TableShell(props: TableShellProps) {
  return props.preferences ? <TableShellBody {...props} preferences={props.preferences} /> : <TableShellOwnPreferences {...props} />;
}

/** A shell with no room above it (a preview): it keeps its own preferences, created once. */
function TableShellOwnPreferences(props: TableShellProps) {
  const preferences = useDuelPreferences();
  return <TableShellBody {...props} preferences={preferences} />;
}

function TableShellBody({
  controller: supplied,
  fillViewport = false,
  initialCamera,
  initialLock = null,
  actions,
  initialOutOrder,
  fxActive = true,
  busy: roomBusy = false,
  headerTools,
  modals,
  notices,
  settingsTools,
  connection,
  pickContinuation,
  inputSuspended = false,
  boardRef: roomBoardRef,
  preferences,
  chainMode = null,
}: TableShellProps & { preferences: DuelPreferences }) {
  // Field clicks use the same reveal gate as the centered prompt; hidden decisions must not answer early.
  const given = useMemo(() => {
    const blocked = roomBusy || supplied.busy || (centerKind(supplied.prompt) != null && !supplied.revealed);
    return blocked ? { ...supplied, busy: true, canAct: false, seatPick: null } : supplied;
  }, [roomBusy, supplied]);
  const localPick = usePickContinuation(pickContinuation ? null : given.prompt, given.engine.revision);
  const pick = pickContinuation ?? localPick;
  const onAnswer = useCallback<TableController["onAnswer"]>((answer) => {
    if (given.busy || !given.canAct || !given.prompt) return;
    if (!pickContinuation) pick.noteAnswer(given.prompt, answer);
    given.onAnswer(answer);
  }, [given, pick.noteAnswer, pickContinuation]);
  const tracked = useMemo(() => ({ ...given, onAnswer }), [given, onAnswer]);
  const narrow = useIsNarrow();
  // The 4-way grid on a wide screen swaps the bars and side columns for the floating HUD (grid-hud.tsx).
  const hud = !narrow && usesGridLayout(engineFormat(tracked.engine) as TableFormat, tracked.engine.seats);
  // The Card pane is a flyout in the HUD: a hover must not fill it, only a click or Inspect does.
  const ui = useTableUi(tracked, { initialPane: hud ? "log" : undefined });
  const base = ui.controller;
  const { engine, room, viewerSeat, nameOf, prompt } = base;
  const format = engineFormat(engine);
  const layout = useMemo(
    () => tableLayout(format as TableFormat, engine, viewerSeat),
    // The layout depends on who sits where, never on a card: the seat list is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [format, engine.seats.length, viewerSeat],
  );
  // A 4-way free-for-all draws the 2 by 2 grid (grid-layout.ts decides); every other table keeps the plaza stage.
  const grid = usesGridLayout(format as TableFormat, engine.seats);
  const Stage = grid ? GridStage : TableStage;
  const rootRef = useRef<HTMLDivElement>(null);
  const ownBoardRef = useRef<HTMLDivElement>(null);
  const boardRef = roomBoardRef ?? ownBoardRef;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [hudPane, setHudPane] = useState<HudPane | null>(null);
  const suspended = inputSuspended || ui.suspended || (narrow && sheetOpen);
  const flow = useAimFlow(base, layout, rootRef, { suspended });
  const controller = flow.controller;
  const camera = useCamera({ controller, layout, initial: initialCamera, initialLock, aiming: flow.aiming, seatKeys: flow.seatKeys, suspended, uprightOnly: grid });
  // The 4-way grid starts with your own field in focus. The turn strip and the keys (1 to 4, O, Esc) move the focus.
  const gridSeats = useMemo(() => gridCells(layout), [layout]);
  const gridShown = useMemo(() => engine.seats.filter((view) => !view.eliminated).map((view) => view.seat), [engine.seats]);
  const gridFocus = useGridFocus({
    enabled: grid,
    home: gridSeats.find((cell) => cell.home)?.seat ?? 0,
    shown: gridShown,
    suspended,
    digitsFree: !flow.seatKeys,
    escapeFree: !flow.aiming && hudPane == null && !(controller.prompt && (controller.prompt.cancelable || controller.prompt.finishable)),
  });
  const [hideResult, setHideResult] = useState(false);
  const [logUnread, setLogUnread] = useState(0);
  // Phone and small tablet: the left column is a sheet opened from a bar under the station track.
  const session = room.session;
  const domain = session.mode === "domain";
  const spectator = viewerSeat == null;
  const viewerOut = engine.seats.some((seat) => seat.seat === viewerSeat && (seat.eliminated || seat.pendingElimination));
  const terminal = session.status !== "active";
  const hasResult = engine.result != null || terminal;
  const resultReady = useResultGate({
    slug: session.slug,
    status: session.status,
    hasResult: engine.result != null,
    reason: engine.result?.reason ?? session.resultReason,
    reducedMotion: controller.reducedMotion,
    board: boardRef,
  });
  const showResult = !hideResult && resultReady && hasResult;

  // Who left, in order (groups: seats that left in one update share a place): the placings of a table of 3 or 4 read it.
  const [outOrder, setOutOrder] = useState<number[][]>(() => eliminationOrder(engine, initialOutOrder));
  const nextOut = trackOutOrder(outOrder, engine);
  if (nextOut.length !== outOrder.length || nextOut.some((group, at) => group.length !== outOrder[at].length || group.some((seat, index) => seat !== outOrder[at][index]))) setOutOrder(nextOut);
  const standings = useMemo(() => placings(engine, outOrder), [engine, outOrder]);

  const tones = useMemo(() => toneBySeat(layout), [layout]);
  const toneOf = (seat: number) => SEAT_TONE_HEX[tones.get(seat) ?? "ice"];
  const seatTones = useMemo(() => new Map([...tones].map(([seat, tone]) => [seat, SEAT_TONE_HEX[tone]])), [tones]);

  const battle = isBattlePhase(engine.phase);
  const engineStep = engine.battleStep ?? null;
  const battleStep: BattleStep | null = battle ? resolveBattleStep(engine.phase, engineStep) : null;
  const stepName = battleStepLabel(battleStep);
  const headerPhase = battle ? `Battle Phase${stepName ? ` · ${stepName}` : ""}` : phaseTitle(engine.phase);
  const turnSeat = engine.turnSeat;
  const myTurn = !spectator && turnSeat === viewerSeat;
  const turnText = myTurn ? "Your turn" : `${nameOf(turnSeat)}'s turn`;
  const soundLabel = preferences.soundEnabled ? "On" : "Off";
  const connectionLabel = labelForConnection(terminal, connection);

  const promptMine = prompt != null && !spectator && !viewerOut && prompt.seat === viewerSeat && !terminal;
  const centered = promptMine && centerKind(prompt) != null;
  const actionPrompt = prompt?.kind === "choice" && prompt.context?.type === "action";
  const actionOptions = prompt?.context?.type === "action" ? prompt.options : [];
  const dockMode = !promptMine || prompt == null || centered ? "idle" : actionPrompt ? (prompt.cancelable || prompt.finishable ? "float" : "idle") : "flow";
  const trackCaption = terminal ? "Duel finished" : prompt == null ? null : promptMine ? (actionPrompt ? null : prompt.title) : `${nameOf(prompt.seat)} is choosing…`;
  const canAct = base.canAct && !base.busy;
  // Who may answer the open chain, in order (the panel of the chain and the response prompt list it).
  const chainOpen = engine.chain.length > 0 && !terminal;
  const priority = useMemo(
    () => (chainOpen ? priorityOrder(engine.seats, engine.turnSeat, engine.chain, prompt?.context?.type === "chain" ? prompt.seat : null) : undefined),
    [chainOpen, engine.seats, engine.turnSeat, engine.chain, prompt],
  );

  // The locked target of an attack: the confirm sits on the card. A locked seat keeps the opponent bar.
  const lockKey = flow.pointed?.zoneKey ?? null;
  const lockAnchor = lockKey && flow.bar?.kind === "confirm" ? tableZoneAnchor(lockKey, rootRef.current ?? document) : null;
  const barShown = flow.bar != null && !(flow.bar.kind === "confirm" && lockAnchor);
  const lockedOption = flow.pointed && prompt ? prompt.options.find((option) => option.id === flow.pointed?.optionId) : undefined;

  const onInspectorActivate = (card: DuelCard, anchor: HTMLElement) =>
    controller.onActivate([zoneKey(card.controller, card.location, card.sequence)], card, anchor);

  const masterRail = domain ? (
    <DeckMasterRail
      engine={engine}
      mySeat={viewerSeat}
      legalKeys={controller.legalKeys}
      selectedKeys={controller.selectedKeys}
      canAct={canAct}
      legalActionsFor={(card, keys) => (canAct && prompt?.kind === "choice" && prompt.context?.type === "action" ? optionsForCard(prompt, card, keys) : [])}
      onChooseAction={(option) => controller.onAnswer({ choice: option.id })}
      onActivate={controller.onActivate}
      onHoverCard={controller.onHoverCard}
      onInspect={controller.onInspect}
      rivals={[]}
      selfTitle={spectator ? `${nameOf(layout.anchorSeat)}'s Master` : undefined}
    />
  ) : null;

  const cameraProps = {
    layout,
    camera: camera.state,
    locked: camera.locked,
    cue: camera.cue,
    nameOf,
    dispatch: camera.dispatch,
    out: camera.out,
  };
  const playersText = session.seats.map((seat) => seat.displayName).join(" v ");
  const logVisible = hud ? hudPane === "log" : ui.pane === "log" && (!narrow || sheetOpen);
  const inspectCard = (target: InspectTarget) => { ui.inspectCard(target); if (narrow) setSheetOpen(true); };
  // Before anything is hovered the Card tab shows the viewer's first face-up monster (else a hand card), as the tag table does.
  const startCard = ui.inspect ? null : firstInspectCard(engine, viewerSeat);
  const inspectorTarget: InspectTarget | null = ui.inspect ?? (startCard ? { type: "card", card: startCard } : null);
  const cardPanel = inspectorTarget ? (
    <CardInspector
      target={inspectorTarget}
      onInspectCard={(card) => ui.setInspect({ type: "card", card })}
      onActivateCard={onInspectorActivate}
      equipLinks={resolveEquipLinks(engine.seats)}
      ownerOf={(card) => ({ name: nameOf(card.controller), tone: toneOf(card.controller) })}
    />
  ) : (
    <CardTabEmpty />
  );
  const logPanel = (
    <div className={roomStyles.logPane}>
      <DuelHistoryRail
        key={session.slug}
        events={engine.events}
        engine={engine}
        mySeat={viewerSeat}
        playerName={nameOf}
        onInspectCard={(card) => inspectCard("location" in card ? { type: "card", card } : { type: "info", card })}
        reducedMotion={controller.reducedMotion}
        active={logVisible}
        onUnread={setLogUnread}
        seatTones={seatTones}
      />
      <details className={roomStyles.textLog}>
        <summary>Text log</summary>
        <MatchSheetLog entries={engine.log} playerName={nameOf} players={playersText} />
      </details>
    </div>
  );

  const toggleHud = useCallback((pane: HudPane) => setHudPane((current) => (current === pane ? null : pane)), []);
  useHudDismiss(hud && hudPane != null, ui.suspended, () => setHudPane(null));
  // A click or Inspect on a card opens the Card pane, unless that click opened an action menu (it keeps the board clear).
  const menuOpen = ui.menu != null;
  useEffect(() => {
    if (hud && ui.inspect && !menuOpen) setHudPane("card");
    // Only a new inspect target opens it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hud, ui.inspect]);
  const hudTabs: readonly HudPane[] = hudPane === "card" ? ["card", ...DOCK_PANES] : DOCK_PANES;
  const hudPanels: Partial<Record<HudPane, ReactNode>> = {
    card: cardPanel,
    log: logPanel,
    settings: <TableSettings controller={controller} preferences={preferences} connection={connection} tools={settingsTools} />,
    chain: <ChainList chain={engine.chain} nameOf={nameOf} tones={seatTones} />,
  };

  const pileSeat = ui.pile?.seat;
  const out = standings.filter((entry) => engine.seats.find((view) => view.seat === entry.seat)?.eliminated === true);

  const identityNode = (
    <div className={roomStyles.identity}>
      <Link href="/duels">Duelists Kingdom</Link>
      {spectator ? (
        <strong className={roomStyles.viewerRole} title="You are watching. Hidden cards stay private.">
          <Eye size={15} strokeWidth={1.5} aria-hidden /> You are spectating
        </strong>
      ) : null}
      <span className={roomStyles.format}>
        {domain ? (isCustomDomain(session.masterRule, session.settings) ? "Custom Domain" : "Domain") : `MR${session.masterRule}`} · {formatLabel(format)}
      </span>
    </div>
  );
  const turnNode = (
    <div className={roomStyles.turn}>
      <strong>Turn {engine.turn}</strong>
      <span className={roomStyles.phaseName} data-step={battleStep ?? undefined}>{headerPhase}</span>
      <span
        className={`${roomStyles.whoPill} ${styles.whoTone}`}
        data-turn={spectator ? "watch" : myTurn ? "you" : "opp"}
        data-testid="who-pill"
        style={{ "--seat-main": toneOf(turnSeat).main, "--seat-ink": toneOf(turnSeat).ink } as CSSProperties}
      >
        {spectator ? <Eye size={13} strokeWidth={1.75} aria-hidden /> : myTurn
          ? <Diamond size={13} strokeWidth={1.75} fill="currentColor" aria-hidden />
          : <Circle size={13} strokeWidth={1.75} aria-hidden />}
        {turnText}
      </span>
    </div>
  );
  const statusNode = (
    <div className={roomStyles.status}>
      {headerTools}
      <span className={roomStyles.connectionStatus} role="status" aria-live="polite" data-live={connectionLabel === "Live"}>
        {connectionLabel === "Live" ? <i className={roomStyles.liveDot} aria-hidden /> : <Radio size={15} strokeWidth={1.75} aria-hidden />}
        <span className={roomStyles.connectionText}>
          {connectionLabel === "Live" ? spectator ? "Live duel · watching" : "Live duel" : connectionLabel}
        </span>
      </span>
      {hasResult && hideResult ? (
        <button type="button" className={roomStyles.tool} onClick={() => setHideResult(false)}><span>Show result</span></button>
      ) : null}
      {hasResult && resultReady ? (
        <button type="button" className={roomStyles.tool} onClick={actions?.onExit}><span>Exit duel</span></button>
      ) : null}
      <button
        type="button"
        className={`${roomStyles.tool} ${roomStyles.pref}`}
        aria-label={`Sound effects ${soundLabel.toLowerCase()}`}
        onClick={() => preferences.setSoundEnabled(!preferences.soundEnabled)}
      >
        {preferences.soundEnabled ? <Volume2 size={16} strokeWidth={1.75} aria-hidden /> : <VolumeX size={16} strokeWidth={1.75} aria-hidden />}
        <span>Sound <b>{soundLabel}</b></span>
      </button>
    </div>
  );

  const seatStripNode = (
    <SeatStrip engine={engine} mySeat={viewerSeat} nameOf={nameOf} promptSeat={controller.promptSeat}
      focusSeat={grid ? gridFocus.focus.seat : camera.state.focusSeat} focusAny={grid}
      onFocusSeat={grid ? gridFocus.focusSeat : (seat) => camera.dispatch({ type: "focus", seat })}
      pick={canAct && controller.revealed ? controller.seatPick : null} />
  );

  return (
    <div
      ref={rootRef}
      className={`${roomStyles.shell} ${styles.shell} ${duelFontClasses}`}
      data-table-shell
      data-duel-fx-speed-root
      data-can-act={canAct ? "true" : "false"}
      data-viewport={fillViewport ? "true" : undefined}
      data-domain={domain}
      data-fit="true"
      data-grid={grid ? "true" : undefined}
      data-hud={hud ? "true" : undefined}
      data-phase={battle ? "battle" : undefined}
      data-turn={spectator ? "watch" : myTurn ? "you" : "opp"}
      data-reduced={controller.reducedMotion ? "true" : "false"}
    >
      {hud ? (
        <div className={hudStyles.top} data-testid="hud-top">
          <div className={hudStyles.topLeft}>{identityNode}</div>
          <div className={hudStyles.topMid}>{seatStripNode}</div>
          <div className={hudStyles.topRight}>{turnNode}{statusNode}</div>
        </div>
      ) : (
        <header className={roomStyles.header}>
          {identityNode}
          {turnNode}
          {statusNode}
        </header>
      )}
      {room.series && !showResult ? (
        <SeriesBanner
          room={room}
          slug={session.slug}
          onChanged={() => actions?.onSeriesChanged?.()}
          onNavigate={(next) => actions?.onNavigate?.(next)}
        />
      ) : null}
      <div className={`${roomStyles.layout} ${hud ? styles.hudLayout : ""}`}>
        <div className={`${roomStyles.notices} ${hud ? styles.hudNotices : ""}`} data-prompt-surface="">
          <div className="pointer-events-auto">{notices}</div>
        </div>
        {narrow || hud ? null : (
          <aside className={roomStyles.inspector}>
            <HistoryStrip
              engine={engine}
              mySeat={viewerSeat}
              playerName={nameOf}
              seatTones={seatTones}
              onInspectCard={(card) => inspectCard("location" in card ? { type: "card", card } : { type: "info", card })}
              onOpenLog={() => ui.setPane("log")}
            />
            <SideTabs panes={DESKTOP_PANES} selected={desktopPane(ui.pane)} unread={logUnread} onSelect={ui.setPane} />
            <div className={roomStyles.sideContent}>
              <SidePanel pane="card" selected={desktopPane(ui.pane)}>{cardPanel}</SidePanel>
              <SidePanel pane="log" selected={desktopPane(ui.pane)} keepMounted>{logPanel}</SidePanel>
              <SidePanel pane="settings" selected={desktopPane(ui.pane)}><TableSettings controller={controller} preferences={preferences} connection={connection} tools={settingsTools} /></SidePanel>
            </div>
          </aside>
        )}
        <div
          className={`${roomStyles.promptDock} ${hud ? styles.hudPrompt : ""}`}
          data-mode={dockMode}
          data-tone={prompt?.context?.type === "chain" ? "chain" : "action"}
          data-idle={dockMode === "idle" ? "true" : "false"}
          data-prompt-surface={dockMode === "idle" ? undefined : ""}
        >
          <PromptTray
            prompt={prompt}
            mySeat={viewerSeat}
            slug={session.slug}
            busy={controller.busy}
            draft={controller.draft}
            onSubmit={controller.onAnswer}
            menuOpen={suspended}
            active={!terminal && !viewerOut}
            aim={flow.promptAim ?? undefined}
            headless={centered}
            suspended={suspended || flow.seatKeys || (centered && !controller.revealed)}
            waitingName={prompt ? nameOf(prompt.seat) : null}
            disabledIds={outSeatOptionIds(prompt, outOrLeavingSeats(engine.seats))}
          />
        </div>
        <section className={`${roomStyles.boardColumn} ${hud ? styles.hudBoard : ""}`} aria-label="Duel field">
          <div className={roomStyles.board} ref={boardRef}>
            <MoveSourceBoundary events={engine.events} duelKey={session.slug} root={boardRef}>
              <Stage
                controller={controller}
                layout={layout}
                camera={camera.shown}
                wantMode={camera.state.mode}
                locked={camera.locked}
                out={camera.out}
                dispatchCamera={camera.dispatch}
                grid={grid ? gridFocus : undefined}
                renderSeatField={(props) => <SeatField {...props} />}
                fx={
                  <FxBoundary>
                    {fxActive ? <DuelFeedback events={engine.events} duelKey={session.slug} soundEnabled={preferences.soundEnabled} soundVolume={preferences.soundVolume} reducedMotion={controller.reducedMotion} /> : null}
                    {fxActive ? <SummonFx events={engine.events} duelKey={session.slug} reducedMotion={controller.reducedMotion} shake={preferences.shake} /> : null}
                    {fxActive ? <MoveFx events={engine.events} duelKey={session.slug} reducedMotion={controller.reducedMotion} /> : null}
                    {fxActive ? <PositionFx events={engine.events} duelKey={session.slug} reducedMotion={controller.reducedMotion} /> : null}
                    {fxActive ? <ChainFx events={engine.events} chain={engine.chain} duelKey={session.slug} reducedMotion={controller.reducedMotion} mySeat={viewerSeat} playerName={nameOf} seatTones={seatTones} priority={priority} ended={hasResult} table={format} seats={engine.seats} /> : null}
                    {fxActive ? <MasterReturnFx events={engine.events} seats={engine.seats} duelKey={session.slug} reducedMotion={controller.reducedMotion} mySeat={viewerSeat} /> : null}
                    <BattleFx events={engine.events} seats={engine.seats} reducedMotion={controller.reducedMotion} active={fxActive} aim={null} />
                    <DestroyFx events={engine.events} reducedMotion={controller.reducedMotion} active={fxActive} mySeat={viewerSeat ?? 0} />
                  </FxBoundary>
                }
                promptCenter={
                  <PromptCenter
                    prompt={prompt ?? (!hasResult ? pick.waiting : null)}
                    mySeat={viewerSeat}
                    active={!terminal && !viewerOut}
                    slug={session.slug}
                    busy={controller.busy || (prompt == null && pick.waiting != null)}
                    draft={controller.draft}
                    onSubmit={controller.onAnswer}
                    menuOpen={suspended}
                    chain={engine.chain}
                    aim={flow.promptAim ?? undefined}
                    aimLocked={flow.locked}
                    reducedMotion={controller.reducedMotion}
                    revision={engine.revision}
                    battleStep={battleStep}
                    outSeats={outOrLeavingSeats(engine.seats)}
                    leavingSeats={leavingOnlySeats(engine.seats)}
                    revealed={controller.revealed}
                    onInspectCard={(card) => ui.setInspect({ type: "info", card })}
                    nameOf={nameOf}
                    seatTones={seatTones}
                    priority={priority}
                  />
                }
                overlay={
                  <>
                    {barShown && flow.bar ? (
                      <OpponentBar
                        kind={flow.bar.kind}
                        title={flow.bar.title}
                        targetLabel={flow.bar.targetLabel}
                        entries={flow.bar.entries}
                        onPick={(seat) => controller.seatPick?.onPick(seat)}
                        onConfirm={flow.confirm}
                        onCancel={flow.cancel}
                      />
                    ) : null}
                    {out.length > 0 ? (
                      <ul className={styles.outNote} aria-label="Duelists who left">
                        {out.map((entry) => (
                          <li key={entry.seat} data-testid="seat-out" data-you={entry.seat === viewerSeat} style={{ "--seat-main": toneOf(entry.seat).main, "--seat-ink": toneOf(entry.seat).ink } as CSSProperties}>
                            <i aria-hidden="true" />
                            {entry.seat === viewerSeat ? "You are out" : `${nameOf(entry.seat)} is out`}
                            <b>{placeLabel(entry.place)}</b>
                            {entry.seat === viewerSeat ? <em data-testid="self-eliminated" role="status">You are eliminated.</em> : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {grid ? null : <CameraControls {...cameraProps} variant={masterRail ? "stage" : "float"} />}
                    {ui.pile ? (
                      <PileViewer
                        title={ui.pile.title}
                        owner={ui.pile.owner}
                        ownerTag={pileSeat != null ? { name: nameOf(pileSeat), tone: toneOf(pileSeat) } : null}
                        open={ui.pile.open}
                        cards={livePileCards(ui.pile, engine, viewerSeat)}
                        onClose={ui.closePile}
                        onInspectCard={(card) => inspectCard({ type: "card", card })}
                        onHoverCard={(card) => { if (ui.pane === "card") ui.setInspect({ type: "card", card }); }}
                        onActivateCard={onInspectorActivate}
                        legalKeys={controller.legalKeys}
                        selectedKeys={controller.selectedKeys}
                        reducedMotion={controller.reducedMotion}
                      />
                    ) : null}
                  </>
                }
              />
            </MoveSourceBoundary>
          </div>
        </section>
        {masterRail && !narrow && !hud ? (
          <aside className={roomStyles.masters} aria-label="Deck Masters">
            {masterRail}
            {grid ? null : <CameraControls {...cameraProps} variant="panel" />}
          </aside>
        ) : null}
      </div>
      {hud ? (
        <div className={hudStyles.bottom} data-testid="hud-bottom">
          <StationTrack
            phase={engine.phase}
            battleStep={battleStep}
            turn={engine.turn}
            turnSeat={engine.turnSeat}
            mySeat={viewerSeat}
            playerName={nameOf}
            actionOptions={promptMine ? actionOptions : []}
            canAct={canAct}
            noLegalMoves={canAct && hasNoLegalMoves(actionOptions)}
            onChoose={(id) => controller.onAnswer({ choice: id })}
            clock={room.clock?.activeSeat != null ? <DuelClockDisplay key={room.clock.serverNow} clock={room.clock} session={session} compact /> : null}
            caption={trackCaption}
            reducedMotion={controller.reducedMotion}
            attackLock={attackLockAt(format, engine.seats.length, engine.turn, engine.prompt)}
            chainMode={chainMode}
          />
        </div>
      ) : (
        <div className={roomStyles.track}>
          {seatStripNode}
          <StationTrack
            phase={engine.phase}
            battleStep={battleStep}
            turn={engine.turn}
            turnSeat={engine.turnSeat}
            mySeat={viewerSeat}
            playerName={nameOf}
            actionOptions={promptMine ? actionOptions : []}
            canAct={canAct}
            noLegalMoves={canAct && hasNoLegalMoves(actionOptions)}
            onChoose={(id) => controller.onAnswer({ choice: id })}
            clock={room.clock?.activeSeat != null ? <DuelClockDisplay key={room.clock.serverNow} clock={room.clock} session={session} compact /> : null}
            caption={trackCaption}
            reducedMotion={controller.reducedMotion}
            attackLock={attackLockAt(format, engine.seats.length, engine.turn, engine.prompt)}
            chainMode={chainMode}
          />
        </div>
      )}
      {hud ? (
        <>
          <GridDock pane={hudPane} onToggle={toggleHud} unread={logUnread} chainCount={chainOpen ? engine.chain.length : 0} />
          {chainOpen ? <ChainTower chain={engine.chain} nameOf={nameOf} tones={seatTones} onOpen={() => setHudPane("chain")} /> : null}
          {domain ? (
            <GridMasterToken
              view={engine.seats.find((seat) => seat.seat === (viewerSeat ?? layout.anchorSeat))}
              local={!spectator}
              legalKeys={controller.legalKeys}
              selectedKeys={controller.selectedKeys}
              canAct={canAct}
              legalActionsFor={(card, keys) => (canAct && prompt?.kind === "choice" && prompt.context?.type === "action" ? optionsForCard(prompt, card, keys) : [])}
              open={hudPane === "master"}
              title={spectator ? `${nameOf(layout.anchorSeat)}'s Master` : "Your Master"}
              onToggle={() => toggleHud("master")}
              onClose={() => setHudPane(null)}
              onChooseAction={(option) => controller.onAnswer({ choice: option.id })}
              onInspect={(target) => { ui.setInspect(target); setHudPane("card"); }}
              onHoverCard={controller.onHoverCard}
            />
          ) : null}
          <GridFlyout pane={hudPane} tabs={hudTabs} panels={hudPanels} keepMounted={HUD_KEEP} onSelect={setHudPane} onClose={() => setHudPane(null)}
            chainCount={chainOpen ? engine.chain.length : 0} chainLive={chainOpen} />
        </>
      ) : null}
      {narrow ? <TablePhonePanes domain={domain} pane={ui.pane} open={sheetOpen} unread={logUnread}
        onClose={() => setSheetOpen(false)} onSelect={(pane) => { ui.setPane(pane); setSheetOpen(true); }}
        card={cardPanel} log={logPanel}
        settings={<TableSettings controller={controller} preferences={preferences} connection={connection} tools={settingsTools} />}
        masters={masterRail} /> : null}
      {ui.menu ? (
        <CardActionMenu
          anchor={ui.menu.anchor}
          title={ui.menu.title}
          options={ui.menu.options}
          busy={controller.busy}
          onClose={ui.closeMenu}
          tone={ui.menu.tone}
          onChoose={(option) => {
            if (!ui.menu || ui.menu.promptId !== prompt?.id || ui.menu.revision !== engine.revision) return;
            ui.closeMenu();
            controller.onAnswer({ choice: option.id });
          }}
        />
      ) : null}
      {flow.arrow ? <AimArrow {...flow.arrow} /> : null}
      {lockAnchor && flow.pointed && !controller.busy ? (
        <AttackConfirm
          anchor={lockAnchor}
          targetName={lockedOption ? targetName(lockedOption) : flow.pointed.label}
          busy={controller.busy}
          prefer={confirmSide(ui.attackerKey, lockAnchor, rootRef.current ?? document)}
          onConfirm={flow.confirm}
          onBack={flow.cancel}
        />
      ) : null}
      {hud ? (
        <GridHoverPreview
          card={ui.hover && !ui.menu && !ui.pile?.open && hudPane == null ? ui.hover.card : null}
          owner={ui.hover ? { name: nameOf(ui.hover.card.controller), ...toneOf(ui.hover.card.controller) } : null}
          reducedMotion={controller.reducedMotion}
        />
      ) : null}
      {!hud && ui.hover && !ui.menu && !ui.pile?.open && !sheetOpen ? <CardHoverInfo card={ui.hover.card} anchor={ui.hover.anchor} /> : null}
      {showResult ? (
        <DuelResultScreen
          room={room}
          slug={session.slug}
          reducedMotion={controller.reducedMotion}
          soundEnabled={preferences.soundEnabled}
          onClose={() => setHideResult(true)}
          onExit={() => actions?.onExit?.()}
          onSeriesChanged={() => actions?.onSeriesChanged?.()}
          onNavigate={(next) => actions?.onNavigate?.(next)}
          placings={standings.map((entry) => ({ seat: entry.seat, place: entry.place, label: placeLabel(entry.place) }))}
        />
      ) : null}
      {modals}
    </div>
  );
}
