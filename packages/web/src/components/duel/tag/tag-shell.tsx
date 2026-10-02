"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties } from "react";
import { Settings, Volume2, VolumeX } from "lucide-react";
import { teamOfSeat, type DuelCard, type DuelCardInfo } from "@yugidraft/shared/duels";
import { BattleFx } from "../battle-fx";
import { centerKind, PromptCenter } from "../prompt-center";
import { SeatField } from "../field";
import { FxBoundary } from "../fx-boundary";
import { CardInspector } from "../inspector";
import { DuelHistoryRail } from "../history-rail";
import { PileViewer } from "../pile-viewer";
import { isAttackTargetPrompt, PromptTray } from "../prompts";
import { StationTrack } from "../station-track";
import { DuelSettingsSummary, DuelSoundControls } from "../room-settings";
import { CardTabEmpty, DESKTOP_PANES, SidePanel, SideTabs, type SidePane } from "../side-panel";
import { resolveEquipLinks } from "../equip-links";
import { isBattlePhase, phaseLabel, zoneKey } from "../constants";
import { formatClock } from "../table/holo-lp";
import { hexToRgbTriplet } from "../table/seat-angle";
import { tableLayout } from "../table/geometry";
import { SEAT_TONE_HEX, type CameraState, type InspectTarget, type TableController } from "../table/types";
import { duelFontClasses } from "../fonts";
import { lockForEvents } from "./fx-lock";
import { CameraDock } from "./roof-map";
import { initialRoofCamera, roofKeyAction, roofReducer } from "./roof-camera";
import { firstInspectCard, resultBanner, teamLp } from "./tag-logic";
import { TagStage } from "./tag-stage";
import styles from "./tag-shell.module.css";

export interface TagShellProps {
  controller: TableController;
  teamNames?: readonly [string, string];
  /** Starting camera (the preview passes what its URL asks for). */
  initialCamera?: Partial<CameraState>;
}

const PANES: readonly SidePane[] = DESKTOP_PANES;
const PHASE_TITLE: Record<string, string> = {
  Draw: "Draw Phase",
  Standby: "Standby Phase",
  "Main 1": "Main Phase 1",
  Battle: "Battle Phase",
  Damage: "Battle Phase",
  "Damage calculation": "Battle Phase",
  "Main 2": "Main Phase 2",
  End: "End Phase",
};

interface PileView {
  title: string;
  cards: DuelCard[];
  owner: "you" | "opp";
  open: boolean;
}

function typing(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null;
  if (!node || typeof node.tagName !== "string") return false;
  return node.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(node.tagName);
}

const PASSIVE_ACTION_IDS: ReadonlySet<string> = new Set(["to_bp", "to_m2", "to_ep", "shuffle"]);

/**
 * The preview shell of the Rooftop: the header, the left sheet (card inspector, history, prompt tray), the roof stage,
 * the camera dock and the station track. A live room keeps its own shell and mounts `TagStage` in its board box.
 * It wires the roof camera: keys, the FX lock from engine events, and the inspector from hover and click.
 */
export function TagShell({ controller, teamNames, initialCamera }: TagShellProps) {
  const { engine, room, viewerSeat, nameOf, prompt, reducedMotion } = controller;
  const layout = useMemo(
    () => tableLayout("tag", engine, viewerSeat),
    // The layout depends on who sits where, never on a card: the seat list is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine.seats.length, viewerSeat],
  );
  const [camera, dispatchCamera] = useReducer(roofReducer, undefined, () =>
    initialRoofCamera({ anchorSeat: layout.anchorSeat, camera: initialCamera }),
  );

  // ---------- FX camera lock: engine events newer than the last one handled ----------
  const lastEvent = useRef<number>(Math.max(0, ...engine.events.map((event) => event.id)));
  useEffect(() => {
    const lock = lockForEvents(engine.events, lastEvent.current);
    if (!lock) {
      lastEvent.current = Math.max(lastEvent.current, ...engine.events.map((event) => event.id));
      return;
    }
    lastEvent.current = lock.lastId;
    dispatchCamera({ type: "lock", reason: lock.reason, nowMs: performance.now(), ms: lock.ms });
  }, [engine.events]);

  // ---------- keys ----------
  const answering = controller.canAct && prompt != null;
  const [pile, setPile] = useState<PileView | null>(null);
  const pileOpen = pile?.open === true;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || typing(event.target) || pileOpen) return;
      if (event.key === "Tab") return; // Tab keeps its job: it moves the focus
      // Digits belong to the prompt (options, seat picks) while you answer one.
      if (answering && /^[0-9]$/.test(event.key)) return;
      const action = roofKeyAction(event.key, { anchorSeat: layout.anchorSeat, pinned: camera.pinned }, { shift: event.shiftKey });
      if (!action) return;
      event.preventDefault();
      dispatchCamera(action);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answering, camera.pinned, layout.anchorSeat, pileOpen]);

  // ---------- inspector, piles ----------
  const [pane, setPane] = useState<SidePane>("card");
  const [inspect, setInspect] = useState<InspectTarget | null>(() => {
    const card = firstInspectCard(engine, viewerSeat);
    return card ? { type: "card", card } : null;
  });
  const [logUnread, setLogUnread] = useState(0);
  const [hideResult, setHideResult] = useState(false);
  // The preview has no account preferences: the sound switch is local. A live room keeps its own.
  const [soundOn, setSoundOn] = useState(true);
  const [volume, setVolume] = useState(0.7);

  const showCard = useCallback((card: DuelCard | DuelCardInfo) => {
    setInspect("location" in card ? { type: "card", card } : { type: "info", card } as InspectTarget);
    setPane("card");
  }, []);
  const onInspect = useCallback(
    (target: InspectTarget) => {
      if (target.type === "pile") {
        const first = target.cards[0];
        const owner = first && viewerSeat != null && teamOfSeat("tag", first.controller) === teamOfSeat("tag", viewerSeat) ? "you" : "opp";
        setPile({ title: target.title, cards: target.cards, owner, open: true });
        return;
      }
      setInspect(target);
      setPane("card");
      controller.onInspect(target);
    },
    [controller, viewerSeat],
  );
  const onHoverCard = useCallback(
    (card: DuelCard | null) => {
      if (!card) return;
      setInspect((current) => (current?.type === "card" && current.card === card ? current : { type: "card", card }));
    },
    [],
  );
  const shellController = useMemo<TableController>(
    () => ({ ...controller, onInspect, onHoverCard }),
    [controller, onInspect, onHoverCard],
  );

  // ---------- header, track ----------
  const turnSeat = engine.turnSeat;
  const spectator = viewerSeat == null;
  const myTurn = !spectator && turnSeat === viewerSeat;
  const label = phaseLabel(engine.phase);
  const battle = isBattlePhase(engine.phase);
  const viewerTeam = viewerSeat == null ? 0 : teamOfSeat("tag", viewerSeat);
  const names = teamNames ?? (["Team 1", "Team 2"] as const);
  const turnTone = SEAT_TONE_HEX[layout.slots.find((slot) => slot.seat === turnSeat)?.tone ?? "violet"];
  const actionOptions = prompt?.context?.type === "action" ? prompt.options : [];
  const mine = controller.canAct;
  const noLegalMoves = mine && actionOptions.length > 0 && actionOptions.every((option) => PASSIVE_ACTION_IDS.has(option.id));
  // A chain response goes to the left tray (the board stays in view); other prompts keep the centre panel.
  const chainPrompt = prompt?.context?.type === "chain" || isAttackTargetPrompt(prompt);
  const centered = mine && !chainPrompt && centerKind(prompt) != null;
  const trackCaption =
    room.session.status !== "active"
      ? "Duel finished"
      : prompt == null
        ? null
        : mine
          ? prompt.context?.type === "action"
            ? null
            : chainPrompt
              ? (prompt.context?.type === "chain" ? "Respond to the chain" : prompt.title)
              : prompt.title
          : `${nameOf(prompt.seat)} is choosing…`;
  const clockMs = room.clock?.remainingMs[turnSeat] ?? null;
  const clockText = formatClock(clockMs);
  const outSeats = engine.seats.filter((seat) => seat.eliminated).map((seat) => seat.seat);
  const banner = resultBanner(engine, viewerSeat, names);

  const shellStyle = { "--turn": hexToRgbTriplet(turnTone.main) } as CSSProperties;

  return (
    <div
      className={`${duelFontClasses} ${styles.shell}`}
      style={shellStyle}
      data-tag-shell
      data-phase={battle ? "battle" : undefined}
      data-turn={spectator ? "watch" : myTurn ? "you" : "opp"}
    >
      <header className={styles.header}>
        <div className={styles.identity}>
          <b>Yugidraft</b>
          <i aria-hidden>/</i>
          <span>Domain</span>
          <em className={styles.format}>Tag duel (2v2)</em>
        </div>
        <div className={styles.turn}>
          <strong>Turn {engine.turn} &middot; {PHASE_TITLE[label] ?? label}</strong>
          <span className={styles.turnPill} data-mine={myTurn ? "true" : "false"}>
            {spectator ? `${nameOf(turnSeat)} to play` : myTurn ? "Your turn" : `${nameOf(turnSeat)}'s turn`}
            <small>&middot; {names[teamOfSeat("tag", turnSeat)]}</small>
          </span>
        </div>
        <div className={styles.live}>
          {spectator ? <span className={styles.spectatorTag}>Spectating</span> : null}
          <span className={styles.liveDot}>Live</span>
          <button
            type="button"
            className={styles.tool}
            data-sound-toggle
            aria-label={`Sound effects ${soundOn ? "on" : "off"}`}
            aria-pressed={soundOn}
            onClick={() => setSoundOn((on) => !on)}
          >
            {soundOn ? <Volume2 size={15} strokeWidth={1.75} aria-hidden /> : <VolumeX size={15} strokeWidth={1.75} aria-hidden />}
          </button>
          <button type="button" className={styles.tool} data-settings-toggle aria-label="Duel settings" onClick={() => setPane("settings")}>
            <Settings size={15} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      </header>

      <div className={styles.main}>
        <aside className={styles.left} aria-label="Duel panels">
          <SideTabs panes={PANES} selected={pane} unread={logUnread} onSelect={setPane} />
          <div className={styles.sideContent}>
            <SidePanel pane="card" selected={pane}>
              {inspect ? (
                <CardInspector
                  target={inspect}
                  onInspectCard={(card) => setInspect({ type: "card", card })}
                  equipLinks={resolveEquipLinks(engine.seats)}
                />
              ) : (
                <CardTabEmpty />
              )}
            </SidePanel>
            <SidePanel pane="settings" selected={pane}>
              <div className={styles.options}>
                <DuelSettingsSummary session={room.session} />
                <h2>Presentation</h2>
                <DuelSoundControls enabled={soundOn} volume={volume} onEnabledChange={setSoundOn} onVolumeChange={setVolume} />
              </div>
            </SidePanel>
            <SidePanel pane="log" selected={pane} keepMounted>
              <DuelHistoryRail
                events={engine.events}
                engine={engine}
                mySeat={viewerSeat}
                playerName={nameOf}
                onInspectCard={showCard}
                reducedMotion={reducedMotion}
                active={pane === "log"}
                onUnread={setLogUnread}
              />
            </SidePanel>
          </div>
          <div className={styles.tray} data-tone={prompt?.context?.type === "chain" ? "chain" : "action"} data-idle={centered || !mine ? "true" : "false"}>
            <PromptTray
              prompt={prompt}
              mySeat={viewerSeat}
              slug={room.session.slug}
              busy={controller.busy}
              draft={controller.draft}
              onSubmit={controller.onAnswer}
              active={room.session.status === "active"}
              headless={centered}
              waitingName={prompt ? nameOf(prompt.seat) : null}
            />
          </div>
        </aside>

        <section className={styles.board} aria-label="Duel roof">
          <TagStage
            controller={shellController}
            layout={layout}
            camera={camera}
            dispatchCamera={dispatchCamera}
            renderSeatField={(props) => <SeatField {...props} />}
            teamNames={names}
            fx={
              <FxBoundary>
                <BattleFx events={engine.events} seats={engine.seats} reducedMotion={reducedMotion} aim={controller.aim} />
              </FxBoundary>
            }
            promptCenter={
              <PromptCenter
                prompt={chainPrompt ? null : prompt}
                mySeat={viewerSeat}
                active={room.session.status === "active"}
                slug={room.session.slug}
                busy={controller.busy}
                draft={controller.draft}
                onSubmit={controller.onAnswer}
                menuOpen={false}
                chain={engine.chain}
                aimLocked={false}
                reducedMotion={reducedMotion}
                revision={engine.revision}
                battleStep={engine.battleStep}
                revealed={controller.revealed}
                onInspectCard={showCard}
                nameOf={nameOf}
              />
            }
            overlay={
              <>
                {pile ? (
                  <PileViewer
                    title={pile.title}
                    cards={pile.cards}
                    owner={pile.owner}
                    open={pile.open}
                    onClose={() => setPile((current) => (current ? { ...current, open: false } : null))}
                    onInspectCard={(card) => setInspect({ type: "card", card })}
                    onHoverCard={onHoverCard}
                    onActivateCard={(card, anchor) => controller.onActivate([zoneKey(card.controller, card.location, card.sequence)], card, anchor)}
                    legalKeys={controller.legalKeys}
                    selectedKeys={controller.selectedKeys}
                    reducedMotion={reducedMotion}
                  />
                ) : null}
                {banner && !hideResult ? (
                  <div className={styles.result} data-result={banner.outcome} role="dialog" aria-label="Duel result">
                    <div className={styles.resultCard}>
                      <p className={styles.resultKicker}>Tag duel finished</p>
                      <h2>{banner.headline}</h2>
                      <p className={styles.resultReason}>{engine.result?.reason ?? ""}</p>
                      <ul className={styles.resultTeams}>
                        {[0, 1].map((team) => (
                          <li key={team} data-mine={team === viewerTeam ? "true" : "false"} data-won={engine.result?.winnerTeam === team ? "true" : "false"}>
                            <span>{team === viewerTeam ? "◆" : "●"} {names[team]}</span>
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
        </section>

        <aside className={styles.right} aria-label="Camera">
          <CameraDock camera={camera} layout={layout} dispatch={dispatchCamera} nameOf={nameOf} turnSeat={turnSeat} outSeats={outSeats} />
        </aside>
      </div>

      <div className={styles.track}>
        <StationTrack
          phase={engine.phase}
          battleStep={engine.battleStep}
          turn={engine.turn}
          turnSeat={turnSeat}
          mySeat={viewerSeat}
          playerName={nameOf}
          actionOptions={mine ? actionOptions : []}
          canAct={mine}
          noLegalMoves={noLegalMoves}
          onChoose={(id) => controller.onAnswer({ choice: id })}
          clock={clockText ? <span className={styles.clock}>{clockText}</span> : null}
          caption={trackCaption}
          reducedMotion={reducedMotion}
        />
      </div>
    </div>
  );
}
