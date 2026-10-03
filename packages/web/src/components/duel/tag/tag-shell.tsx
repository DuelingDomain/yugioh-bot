"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { teamOfSeat } from "@yugidraft/shared/duels";
import { AttackConfirm, CardActionMenu, CardHoverInfo, confirmSide, targetName } from "../card-interactions";
import { isBattlePhase } from "../constants";
import { DuelResultScreen } from "../duel-result";
import { SeatField } from "../field";
import { MoveSourceBoundary } from "../fx-boundary";
import { duelFxClock } from "../fx-clock";
import { duelFontClasses } from "../fonts";
import { usePickContinuation } from "../pick-continuation";
import { useDuelPreferences, type DuelPreferences } from "../preferences";
import { centerKind, PromptCenter } from "../prompt-center";
import { PromptTray } from "../prompts";
import { useResultGate } from "../result-reveal";
import roomStyles from "../room.module.css";
import { SeriesBanner } from "../series-banner";
import { useIsNarrow } from "../side-panel";
import { hasNoLegalMoves, resolveBattleStep, StationTrack } from "../station-track";
import { OpponentBar } from "../table/opponent-bar";
import { toneBySeat } from "../table/seat-state";
import { tableLayout } from "../table/geometry";
import { useAimFlow } from "../table/use-aim-flow";
import { useTableUi } from "../table/use-table-ui";
import { tableZoneAnchor } from "../table/zone-find";
import { SEAT_TONE_HEX, type TableController } from "../table/types";
import { lastEventId, lockForEvents } from "./fx-lock";
import { resolveTagExtras, tagCameraYields, tagInputSuspended, type TagShellPreviewProps } from "./live-tag";
import { initialRoofCamera, roofReducer } from "./roof-camera";
import { CameraDock } from "./roof-map";
import { resultBanner, teamLp } from "./tag-logic";
import { TagFx, tagPriority } from "./tag-fx";
import { TagHeader } from "./tag-header";
import { TagPileViewer, TagSide } from "./tag-side";
import { TagStage } from "./tag-stage";
import { TagTrack } from "./tag-track";
import { chainDecidingSeat, useChainPasses } from "./use-chain-passes";
import { useRoofKeys } from "./use-roof-keys";
import styles from "./tag-shell.module.css";

/**
 * What the Rooftop shell takes. The live room passes `TagShellLiveProps` (the seams of `TableShell` plus the team names).
 * A preview may leave the team names out and sets `preview`, which keeps the Rooftop result banner in place of the shared
 * result screen (a preview has no room to leave and no series to continue).
 * `initialOutOrder` is accepted for parity with `TableShell` and unused: a team table ends at the team's LP, there are no placings.
 */
export type TagShellProps = TagShellPreviewProps & {
  preview?: boolean;
};

/** A preview lock has no end: a time this far off never comes before the page reloads (and fits a timer). */
const OPEN_LOCK_MS = 1_000_000_000;

/**
 * The live 2v2 table (the Rooftop): header, side panels, the roof stage, the camera dock, the turn track and station
 * track, menus, the result screen and the FX. It takes the same room seams as `TableShell` and the same shared hooks
 * (table UI, aim flow, reveal gate, pick continuation), and keeps the engine in the room: it only gets a controller.
 */
export function TagShell(props: TagShellProps) {
  return props.preferences ? <TagShellBody {...props} preferences={props.preferences} /> : <TagShellOwnPreferences {...props} />;
}

/** A shell with no room above it (a preview): it keeps its own preferences, created once. */
function TagShellOwnPreferences(props: TagShellProps) {
  const preferences = useDuelPreferences();
  return <TagShellBody {...props} preferences={preferences} />;
}

function TagShellBody(props: TagShellProps & { preferences: DuelPreferences }) {
  const {
    preferences,
    controller: supplied,
    fillViewport = false,
    initialCamera,
    initialLock = null,
    actions,
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
    preview = false,
  } = props;
  const { teamNames, mode } = resolveTagExtras(props, supplied);

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
  const ui = useTableUi(tracked);
  const base = ui.controller;
  const { engine, room, viewerSeat, nameOf, prompt } = base;
  const layout = useMemo(
    () => tableLayout("tag", engine, viewerSeat),
    // The layout depends on who sits where, never on a card: the seat list is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine.seats.length, viewerSeat],
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const ownBoardRef = useRef<HTMLDivElement>(null);
  const boardRef = roomBoardRef ?? ownBoardRef;
  const narrow = useIsNarrow();
  const [sheetOpen, setSheetOpen] = useState(false);
  // One flag for the aim flow and the camera keys. A seat pick or an aim does not suspend input: they need their keys.
  const suspended = tagInputSuspended({ inputSuspended, menu: ui.menu, pile: ui.pile, narrow, sheetOpen });
  const flow = useAimFlow(base, layout, rootRef, { suspended });
  const controller = flow.controller;
  const [hideResult, setHideResult] = useState(false);

  const session = room.session;
  const domain = mode === "domain";
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

  // ---------- roof camera ----------
  const [camera, dispatchCamera] = useReducer(roofReducer, undefined, () =>
    initialRoofCamera({
      anchorSeat: layout.anchorSeat,
      camera: { ...initialCamera, ...(initialLock ? { lock: { reason: initialLock, untilMs: performance.now() + OPEN_LOCK_MS } } : {}) },
    }),
  );

  // The FX lock follows engine events newer than the last one handled. With reduced motion, or while the connection is
  // down (the FX replay nothing), no lock starts but the cursor still moves, so old events never lock the camera later.
  const lastEvent = useRef<number>(lastEventId(engine.events, 0));
  useEffect(() => {
    const lock = fxActive ? lockForEvents(engine.events, lastEvent.current, controller.reducedMotion, duelFxClock.factor()) : null;
    if (!lock) {
      lastEvent.current = lastEventId(engine.events, lastEvent.current);
      return;
    }
    lastEvent.current = lock.lastId;
    dispatchCamera({ type: "lock", reason: lock.reason, nowMs: performance.now(), ms: lock.ms });
  }, [engine.events, fxActive, controller.reducedMotion]);

  // An aim holds the camera where it is (auto follow reads it).
  useEffect(() => {
    dispatchCamera({ type: "aiming", on: flow.aiming });
  }, [flow.aiming]);

  const promptMine = prompt != null && !spectator && !viewerOut && prompt.seat === viewerSeat && !terminal;
  const centered = promptMine && centerKind(prompt) != null;
  const centeredUnrevealed = centered && !controller.revealed;
  useRoofKeys({
    dispatch: dispatchCamera,
    anchorSeat: layout.anchorSeat,
    pinned: camera.pinned,
    // The result screen owns the keys while it is shown.
    suspended: suspended || showResult,
    yields: tagCameraYields({ aiming: flow.aiming, seatKeys: flow.seatKeys, centeredUnrevealed }),
  });

  // ---------- derived ----------
  const tones = useMemo(() => toneBySeat(layout), [layout]);
  const toneOf = useCallback((seat: number) => SEAT_TONE_HEX[tones.get(seat) ?? "ice"], [tones]);
  const seatTones = useMemo(() => new Map([...tones].map(([seat, tone]) => [seat, SEAT_TONE_HEX[tone]])), [tones]);
  // Every viewer reads the deciding seat from the engine view, not only the seat that holds the prompt.
  const passes = useChainPasses(engine, prompt);
  const chainOpen = engine.chain.length > 0 && !terminal;
  const decidingSeat = chainDecidingSeat(engine, prompt);
  const priority = useMemo(
    () => (chainOpen ? tagPriority(engine, passes, decidingSeat) ?? undefined : undefined),
    [chainOpen, engine, passes, decidingSeat],
  );

  const battle = isBattlePhase(engine.phase);
  const battleStep = battle ? resolveBattleStep(engine.phase, engine.battleStep ?? null) : null;
  const myTurn = !spectator && engine.turnSeat === viewerSeat;
  const actionPrompt = prompt?.kind === "choice" && prompt.context?.type === "action";
  const actionOptions = prompt?.context?.type === "action" ? prompt.options : [];
  const trackCaption = terminal ? "Duel finished" : prompt == null ? null : promptMine ? (actionPrompt ? null : prompt.title) : `${nameOf(prompt.seat)} is choosing…`;
  const canAct = base.canAct && !base.busy;
  const outSeats = engine.seats.filter((seat) => seat.eliminated).map((seat) => seat.seat);

  // The locked target of an attack: the confirm sits on the card. A locked seat keeps the opponent bar.
  const lockKey = flow.pointed?.zoneKey ?? null;
  const lockAnchor = lockKey && flow.bar?.kind === "confirm" ? tableZoneAnchor(lockKey, rootRef.current ?? document) : null;
  const barShown = flow.bar != null && !(flow.bar.kind === "confirm" && lockAnchor);
  const lockedOption = flow.pointed && prompt ? prompt.options.find((option) => option.id === flow.pointed?.optionId) : undefined;

  const viewerTeam = viewerSeat == null ? 0 : teamOfSeat("tag", viewerSeat);
  const banner = preview ? resultBanner(engine, viewerSeat, teamNames) : null;

  const tray = (
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
      suspended={suspended || flow.seatKeys || centeredUnrevealed}
      waitingName={prompt ? nameOf(prompt.seat) : null}
    />
  );
  const side = (
    <TagSide
      controller={controller}
      ui={ui}
      preferences={preferences}
      connection={connection}
      settingsTools={settingsTools}
      sheetOpen={sheetOpen}
      onSheetOpenChange={setSheetOpen}
      tray={tray}
      leftClassName={styles.left}
      mastersClassName={styles.masters}
    />
  );

  return (
    <div
      ref={rootRef}
      className={`${duelFontClasses} ${styles.shell}`}
      data-table-shell="tag"
      data-duel-fx-speed-root
      data-can-act={canAct ? "true" : "false"}
      data-viewport={fillViewport ? "true" : undefined}
      data-domain={domain}
      data-phase={battle ? "battle" : undefined}
      data-turn={spectator ? "watch" : myTurn ? "you" : "opp"}
      data-reduced={controller.reducedMotion ? "true" : "false"}
    >
      <TagHeader
        session={session}
        engine={engine}
        viewerSeat={viewerSeat}
        nameOf={nameOf}
        teamNames={teamNames}
        preferences={preferences}
        connection={connection}
        headerTools={headerTools}
        onExit={hasResult && resultReady ? () => actions?.onExit?.() : undefined}
        onShowResult={hasResult && hideResult ? () => setHideResult(false) : undefined}
      />
      {room.series && !showResult ? (
        <SeriesBanner
          room={room}
          slug={session.slug}
          onChanged={() => actions?.onSeriesChanged?.()}
          onNavigate={(next) => actions?.onNavigate?.(next)}
        />
      ) : null}

      <div className={styles.main} data-masters={domain && !narrow ? "true" : "false"}>
        <div className={roomStyles.notices}>
          <div className="pointer-events-auto">{notices}</div>
        </div>
        {narrow ? null : side}
        <section className={styles.board} aria-label="Duel field">
          <div className={styles.boardBox} ref={boardRef}>
            <MoveSourceBoundary events={engine.events} duelKey={session.slug} root={boardRef}>
              <TagStage
                controller={controller}
                layout={layout}
                camera={camera}
                dispatchCamera={dispatchCamera}
                renderSeatField={(fieldProps) => <SeatField {...fieldProps} />}
                teamNames={teamNames}
                fx={<TagFx controller={controller} preferences={preferences} fxActive={fxActive} passedSeats={passes} />}
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
                    <TagPileViewer controller={controller} ui={ui} />
                    {banner && !hideResult ? (
                      <div className={styles.result} data-result={banner.outcome} role="dialog" aria-label="Duel result">
                        <div className={styles.resultCard}>
                          <p className={styles.resultKicker}>Tag duel finished</p>
                          <h2>{banner.headline}</h2>
                          <p className={styles.resultReason}>{engine.result?.reason ?? ""}</p>
                          <ul className={styles.resultTeams}>
                            {[0, 1].map((team) => (
                              <li key={team} data-mine={team === viewerTeam ? "true" : "false"} data-won={engine.result?.winnerTeam === team ? "true" : "false"}>
                                <span>{team === viewerTeam ? "◆" : "●"} {teamNames[team]}</span>
                                <b>{teamLp(engine, team).toLocaleString("en-US")}</b>
                              </li>
                            ))}
                          </ul>
                          <button type="button" onClick={() => setHideResult(true)}>View the board</button>
                        </div>
                      </div>
                    ) : null}
                  </>
                }
              />
            </MoveSourceBoundary>
          </div>
        </section>
        {narrow ? null : (
          <aside className={styles.right} aria-label="Camera">
            <CameraDock camera={camera} layout={layout} dispatch={dispatchCamera} nameOf={nameOf} turnSeat={engine.turnSeat} outSeats={outSeats} />
          </aside>
        )}
      </div>

      <TagTrack
        session={session}
        engine={engine}
        clock={room.clock?.activeSeat != null ? room.clock : null}
        nameOf={nameOf}
        prompt={prompt}
        toneOf={toneOf}
        reducedMotion={controller.reducedMotion}
      >
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
          clock={null}
          caption={trackCaption}
          reducedMotion={controller.reducedMotion}
        />
      </TagTrack>
      {narrow ? side : null}

      {ui.menu ? (
        <CardActionMenu
          anchor={ui.menu.anchor}
          title={ui.menu.title}
          options={ui.menu.options}
          busy={controller.busy}
          onClose={ui.closeMenu}
          tone={ui.menu.tone}
          onOptionHover={ui.onMenuOptionHover}
          onChoose={(option) => {
            if (!ui.menu || ui.menu.promptId !== prompt?.id || ui.menu.revision !== engine.revision) return;
            ui.closeMenu();
            controller.onAnswer({ choice: option.id });
          }}
        />
      ) : null}
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
      {ui.hover && !ui.menu && !ui.pile?.open && !sheetOpen ? <CardHoverInfo card={ui.hover.card} anchor={ui.hover.anchor} /> : null}
      {showResult && !preview ? (
        <DuelResultScreen
          room={room}
          slug={session.slug}
          reducedMotion={controller.reducedMotion}
          soundEnabled={preferences.soundEnabled}
          onClose={() => setHideResult(true)}
          onExit={() => actions?.onExit?.()}
          onSeriesChanged={() => actions?.onSeriesChanged?.()}
          onNavigate={(next) => actions?.onNavigate?.(next)}
        />
      ) : null}
      {modals}
    </div>
  );
}
