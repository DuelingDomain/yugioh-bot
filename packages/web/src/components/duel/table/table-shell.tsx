"use client";

import { useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { Circle, Diamond, Eye, Radio, Volume2, VolumeX } from "lucide-react";
import type { DuelCard, DuelPromptOption } from "@yugidraft/shared/duels";
import { isCustomDomain } from "@yugidraft/shared/duels";
import { BattleFx } from "../battle-fx";
import { AttackConfirm, CardActionMenu, CardHoverInfo } from "../card-interactions";
import { ChainFx } from "../chain-fx";
import { isBattlePhase, zoneKey } from "../constants";
import { DestroyFx } from "../destroy-fx";
import { DuelResultScreen } from "../duel-result";
import { resolveEquipLinks } from "../equip-links";
import { DuelFeedback } from "../feedback";
import { DeckMasterRail, SeatField } from "../field";
import { FxBoundary } from "../fx-boundary";
import { duelFontClasses } from "../fonts";
import { DuelHistoryRail } from "../history-rail";
import { CardInspector, type InspectTarget } from "../inspector";
import { MasterReturnFx } from "../master-return-fx";
import { MoveFx } from "../move-fx";
import { engineFormat, formatLabel } from "../multi-seat";
import { PileViewer } from "../pile-viewer";
import { PositionFx } from "../position-fx";
import { centerKind, PromptCenter } from "../prompt-center";
import { optionsForCard, PromptTray } from "../prompts";
import { useResultGate } from "../result-reveal";
import { DuelClockDisplay } from "../room-settings";
import { SeriesBanner } from "../series-banner";
import { CardTabEmpty, DESKTOP_PANES, desktopPane, SidePanel, SideTabs } from "../side-panel";
import { battleStepLabel, resolveBattleStep, StationTrack, type BattleStep } from "../station-track";
import { SummonFx } from "../summon-fx";
import { useDuelPreferences } from "../preferences";
import roomStyles from "../room.module.css";
import { CameraControls } from "./camera-controls";
import { tableLayout } from "./geometry";
import { OpponentBar } from "./opponent-bar";
import { attackLockAt, placeLabel, placings, seatStrip, toneBySeat, trackOutOrder } from "./seat-state";
import { TableSettings, TableTextLog } from "./table-side";
import { confirmSide, phaseTitle, targetName, zoneAnchor } from "./table-labels";
import { TableStage } from "./table-stage";
import { useAimFlow } from "./use-aim-flow";
import { useCamera } from "./use-camera";
import { livePileCards, useTableUi } from "./use-table-ui";
import { SEAT_TONE_HEX, type CameraLockReason, type CameraState, type TableController, type TableFormat } from "./types";
import styles from "./table-shell.module.css";

export interface TableShellActions {
  onExit?: () => void;
  onSeriesChanged?: () => void;
  onNavigate?: (slug: string) => void;
  onOpenSide?: () => void;
}

export interface TableShellProps {
  controller: TableController;
  /** Starting camera; the preview passes what its URL asks for. */
  initialCamera?: Partial<CameraState>;
  /** Start with the FX lock on (the preview shows the chip with it). It stays on until the page reloads. */
  initialLock?: CameraLockReason | null;
  /** What the room does with the result screen and the series. A preview leaves them out. */
  actions?: TableShellActions;
}

const PASSIVE_ACTION_IDS: ReadonlySet<string> = new Set(["to_bp", "to_m2", "to_ep", "shuffle"]);
const hasNoLegalMoves = (options: readonly DuelPromptOption[]) => options.length > 0 && options.every((option) => PASSIVE_ACTION_IDS.has(option.id));

/**
 * The whole table of a 3 or 4 seat duel: header, history and card tabs, the stage, the Deck Master column, the station
 * track, menus, the result screen and the FX. It uses the exported duel components of the 1v1 room and keeps the room's
 * look (room.module.css). The room itself stays the owner of the live engine: it passes a controller.
 */
export function TableShell({ controller: given, initialCamera, initialLock = null, actions }: TableShellProps) {
  const ui = useTableUi(given);
  const base = ui.controller;
  const { engine, room, viewerSeat, nameOf, prompt } = base;
  const format = engineFormat(engine);
  const layout = useMemo(
    () => tableLayout(format as TableFormat, engine, viewerSeat),
    // The layout depends on who sits where, never on a card: the seat list is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [format, engine.seats.length, viewerSeat],
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const flow = useAimFlow(base, layout, rootRef, { suspended: ui.suspended });
  const controller = flow.controller;
  const camera = useCamera({ controller, layout, initial: initialCamera, initialLock, aiming: flow.aiming, seatKeys: flow.seatKeys, suspended: ui.suspended });
  const preferences = useDuelPreferences();
  const [hideResult, setHideResult] = useState(false);
  const [logUnread, setLogUnread] = useState(0);

  const session = room.session;
  const domain = session.mode === "domain";
  const spectator = viewerSeat == null;
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

  // Who left, in order: the placings of a table of 3 or 4 read it.
  const [outOrder, setOutOrder] = useState<number[]>(() => trackOutOrder([], engine));
  const nextOut = trackOutOrder(outOrder, engine);
  if (nextOut !== outOrder) setOutOrder(nextOut);
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

  const promptMine = prompt != null && !spectator && prompt.seat === viewerSeat && !terminal;
  const centered = promptMine && centerKind(prompt) != null;
  const actionPrompt = prompt?.kind === "choice" && prompt.context?.type === "action";
  const actionOptions = prompt?.context?.type === "action" ? prompt.options : [];
  const dockMode = !promptMine || prompt == null || centered ? "idle" : actionPrompt ? (prompt.cancelable || prompt.finishable ? "float" : "idle") : "flow";
  const trackCaption = terminal ? "Duel finished" : prompt == null ? null : promptMine ? (actionPrompt ? null : prompt.title) : `${nameOf(prompt.seat)} is choosing…`;
  const canAct = base.canAct && !base.busy;

  // The locked target of an attack: the confirm sits on the card. A locked seat keeps the opponent bar.
  const lockKey = flow.pointed?.zoneKey ?? null;
  const lockAnchor = lockKey && flow.bar?.kind === "confirm" ? zoneAnchor(lockKey, rootRef.current ?? document) : null;
  const barShown = flow.bar != null && !(flow.bar.kind === "confirm" && lockAnchor);
  const lockedOption = flow.pointed && prompt ? prompt.options.find((option) => option.id === flow.pointed?.optionId) : undefined;

  const onInspectorActivate = (card: DuelCard, anchor: HTMLElement) =>
    controller.onActivate([zoneKey(card.controller, card.location, card.sequence)], card, anchor);

  const rivals = layout.slots
    .filter((slot) => slot.seat !== layout.anchorSeat)
    .map((slot) => ({ seat: slot.seat, title: `${nameOf(slot.seat)}'s Master` }));
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
      rivals={rivals}
    />
  ) : null;

  const playersText = session.seats.map((seat) => seat.displayName).join(" v ");
  const logVisible = ui.pane === "log";
  const inspectorTarget: InspectTarget | null = ui.inspect;
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
        onInspectCard={(card) => ui.inspectCard("location" in card ? { type: "card", card } : { type: "info", card })}
        reducedMotion={controller.reducedMotion}
        active={logVisible}
        onUnread={setLogUnread}
        seatTones={seatTones}
      />
      <details className={roomStyles.textLog}>
        <summary>Text log</summary>
        <TableTextLog entries={engine.log} nameOf={nameOf} players={playersText} />
      </details>
    </div>
  );

  const pileSeat = ui.pile?.seat;
  const out = standings.filter((entry) => engine.seats.find((view) => view.seat === entry.seat)?.eliminated === true);

  return (
    <div
      ref={rootRef}
      className={`${roomStyles.shell} ${styles.shell} ${duelFontClasses}`}
      data-table-shell
      data-domain={domain}
      data-fit="true"
      data-phase={battle ? "battle" : undefined}
      data-turn={spectator ? "watch" : myTurn ? "you" : "opp"}
      data-reduced={controller.reducedMotion ? "true" : "false"}
    >
      <header className={roomStyles.header}>
        <div className={roomStyles.identity}>
          <Link href="/duels">Yugidraft</Link>
          {spectator ? (
            <strong className={roomStyles.viewerRole} title="You are watching. Hidden cards stay private.">
              <Eye size={15} strokeWidth={1.5} aria-hidden /> You are spectating
            </strong>
          ) : null}
          <span className={roomStyles.format}>
            {domain ? (isCustomDomain(session.masterRule, session.settings) ? "Custom Domain" : "Domain") : `MR${session.masterRule}`} · {formatLabel(format)}
          </span>
        </div>
        <div className={roomStyles.turn}>
          <strong>Turn {engine.turn}</strong>
          <span className={roomStyles.phaseName} data-step={battleStep ?? undefined}>{headerPhase}</span>
          <span className={roomStyles.whoPill} data-turn={spectator ? "watch" : myTurn ? "you" : "opp"}>
            {spectator ? <Eye size={13} strokeWidth={1.75} aria-hidden /> : myTurn
              ? <Diamond size={13} strokeWidth={1.75} fill="currentColor" aria-hidden />
              : <Circle size={13} strokeWidth={1.75} aria-hidden />}
            {turnText}
          </span>
        </div>
        <div className={roomStyles.status}>
          <span className={roomStyles.connectionStatus} role="status" aria-live="polite" data-live={!terminal}>
            {terminal ? <Radio size={15} strokeWidth={1.75} aria-hidden /> : <i className={roomStyles.liveDot} aria-hidden />}
            {terminal ? "Finished" : spectator ? "Live duel · watching" : "Live duel"}
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
      </header>
      {room.series && !showResult ? (
        <SeriesBanner
          room={room}
          slug={session.slug}
          onChanged={() => actions?.onSeriesChanged?.()}
          onNavigate={(next) => actions?.onNavigate?.(next)}
          onOpenSide={() => actions?.onOpenSide?.()}
        />
      ) : null}
      <div className={roomStyles.layout}>
        <aside className={roomStyles.inspector}>
          <SideTabs panes={DESKTOP_PANES} selected={desktopPane(ui.pane)} unread={logUnread} onSelect={ui.setPane} />
          <div className={roomStyles.sideContent}>
            <SidePanel pane="card" selected={desktopPane(ui.pane)}>{cardPanel}</SidePanel>
            <SidePanel pane="log" selected={desktopPane(ui.pane)} keepMounted>{logPanel}</SidePanel>
            <SidePanel pane="settings" selected={desktopPane(ui.pane)}><TableSettings controller={controller} preferences={preferences} /></SidePanel>
          </div>
        </aside>
        <div
          className={roomStyles.promptDock}
          data-mode={dockMode}
          data-tone={prompt?.context?.type === "chain" ? "chain" : "action"}
          data-idle={dockMode === "idle" ? "true" : "false"}
        >
          <PromptTray
            prompt={prompt}
            mySeat={viewerSeat}
            slug={session.slug}
            busy={controller.busy}
            draft={controller.draft}
            onSubmit={controller.onAnswer}
            menuOpen={ui.menu != null}
            active={!terminal}
            aim={flow.promptAim ?? undefined}
            headless={centered}
            suspended={centered && !controller.revealed}
            waitingName={prompt ? nameOf(prompt.seat) : null}
          />
        </div>
        <section className={roomStyles.boardColumn} aria-label="Duel field">
          <div className={roomStyles.board} ref={boardRef}>
            <TableStage
              controller={controller}
              layout={layout}
              camera={camera.shown}
              wantMode={camera.state.mode}
              locked={camera.locked}
              out={camera.out}
              dispatchCamera={camera.dispatch}
              renderSeatField={(props) => <SeatField {...props} />}
              fx={
                <FxBoundary>
                  <DuelFeedback events={engine.events} duelKey={session.slug} soundEnabled={preferences.soundEnabled} soundVolume={preferences.soundVolume} reducedMotion={controller.reducedMotion} />
                  <SummonFx events={engine.events} duelKey={session.slug} reducedMotion={controller.reducedMotion} shake={preferences.shake} />
                  <MoveFx events={engine.events} duelKey={session.slug} reducedMotion={controller.reducedMotion} />
                  <PositionFx events={engine.events} duelKey={session.slug} reducedMotion={controller.reducedMotion} />
                  <ChainFx events={engine.events} chain={engine.chain} duelKey={session.slug} reducedMotion={controller.reducedMotion} mySeat={viewerSeat} playerName={nameOf} />
                  <MasterReturnFx events={engine.events} seats={engine.seats} duelKey={session.slug} reducedMotion={controller.reducedMotion} mySeat={viewerSeat} />
                  <BattleFx events={engine.events} seats={engine.seats} reducedMotion={controller.reducedMotion} aim={null} />
                  <DestroyFx events={engine.events} reducedMotion={controller.reducedMotion} mySeat={viewerSeat ?? 0} />
                </FxBoundary>
              }
              promptCenter={
                <PromptCenter
                  prompt={prompt}
                  mySeat={viewerSeat}
                  active={!terminal}
                  slug={session.slug}
                  busy={controller.busy}
                  draft={controller.draft}
                  onSubmit={controller.onAnswer}
                  menuOpen={ui.menu != null}
                  chain={engine.chain}
                  aim={flow.promptAim ?? undefined}
                  aimLocked={flow.locked}
                  reducedMotion={controller.reducedMotion}
                  revision={engine.revision}
                  battleStep={battleStep}
                  revealed={controller.revealed}
                  onInspectCard={(card) => ui.setInspect({ type: "info", card })}
                  nameOf={nameOf}
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
                          {entry.seat === viewerSeat ? <em>You can keep watching.</em> : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <CameraControls
                    layout={layout}
                    camera={camera.state}
                    locked={camera.locked}
                    cue={camera.cue}
                    nameOf={nameOf}
                    dispatch={camera.dispatch}
                    out={camera.out}
                  />
                  {ui.pile ? (
                    <PileViewer
                      title={ui.pile.title}
                      owner={ui.pile.owner}
                      ownerTag={pileSeat != null ? { name: nameOf(pileSeat), tone: toneOf(pileSeat) } : null}
                      open={ui.pile.open}
                      cards={livePileCards(ui.pile, engine, viewerSeat)}
                      onClose={ui.closePile}
                      onInspectCard={(card) => ui.inspectCard({ type: "card", card })}
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
          </div>
        </section>
        {masterRail ? <aside className={roomStyles.masters} aria-label="Deck Masters">{masterRail}</aside> : null}
      </div>
      <div className={roomStyles.track}>
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
          clock={room.clock ? <DuelClockDisplay key={room.clock.serverNow} clock={room.clock} session={session} /> : null}
          caption={trackCaption}
          reducedMotion={controller.reducedMotion}
          seatStrip={seatStrip(layout, engine, controller.promptSeat, nameOf).map((entry) => ({ ...entry, tone: SEAT_TONE_HEX[entry.tone] }))}
          attackLock={attackLockAt(format, engine.seats.length, engine.turn)}
        />
      </div>
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
      {ui.hover && !ui.menu && !ui.pile?.open ? <CardHoverInfo card={ui.hover.card} anchor={ui.hover.anchor} /> : null}
      {showResult ? (
        <DuelResultScreen
          room={room}
          slug={session.slug}
          reducedMotion={controller.reducedMotion}
          soundEnabled={preferences.soundEnabled}
          onClose={() => setHideResult(true)}
          onExit={() => actions?.onExit?.()}
          onOpenSide={() => { setHideResult(true); actions?.onOpenSide?.(); }}
          onSeriesChanged={() => actions?.onSeriesChanged?.()}
          onNavigate={(next) => actions?.onNavigate?.(next)}
          placings={standings.map((entry) => ({ seat: entry.seat, place: entry.place, label: nameOf(entry.seat) }))}
        />
      ) : null}
    </div>
  );
}
