"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Pause, Play, PlayCircle, SkipBack, SkipForward, TriangleAlert } from "lucide-react";
import { isCustomDomain, seatCountFor, type DuelCard, type DuelMasterRule, type ReplayVisibility } from "@yugidraft/shared/duels";
import { Sheet } from "@/components/ui/sheet";
import { CardHoverInfo } from "./card-interactions";
import { phaseLabel } from "./constants";
import { DeckMasterRail, DuelField } from "./field";
import { FieldCracksScope } from "./field-cracks/context";
import { CoinTossFx } from "./coin-toss-fx";
import { useHeldTossLogIds, withoutHeldTossLines } from "./coin-toss-lock";
import { DuelFeedback } from "./feedback";
import { MoveSourceBoundary } from "./fx-boundary";
import { CardInspector, cardScrollerProps, type InspectTarget } from "./inspector";
import { DuelLogLine, useLogCategories } from "./log-line";
import { useDuelPreferences } from "./preferences";
import {
  SPEEDS,
  createReadOnlyTableController,
  NO_FINAL_BOARD_COPY,
  UNCHECKED_PARAM,
  frameCaption,
  replayFailure,
  replayResultHeadline,
  replayRoom,
  resolveFocusSeat,
  stepButtonProps,
  useReplayController,
  useReplayData,
  withUncheckedParam,
  checkNoteOf,
} from "./replay-controller";
import { ReplayOwnerTools, forkTarget, isOwnerModel, useForkStart, type OwnerViewState } from "./replay-fork-button";
import { useOpenForks } from "./replay-open-forks";
import { ReplayTag } from "./replay-tag";
import { ReplayFfa, isFfaFormat } from "./replay-ffa";
import { ReplayStatus } from "./replay-status";
import { ReplayVerificationNote } from "./replay-verification";
import { buildReplayTimeline, type ReplayLogEntry } from "./replay-timeline";
import { formatLabel } from "./table-format";
import type { TableController } from "./table/types";
import styles from "./room.module.css";
import replayStyles from "./replay.module.css";
import { duelFontClasses } from "./fonts";
import { useMatchHistoryHref } from "./history-link";

export { useReplayAutoplay } from "./replay-controller";

const PHASES = [
  { label: "DP", name: "Draw" },
  { label: "SP", name: "Standby" },
  { label: "M1", name: "Main 1" },
  { label: "BP", name: "Battle" },
  { label: "M2", name: "Main 2" },
  { label: "EP", name: "End" },
];
const noActions = () => [];
const noop = () => undefined;

/** The replay's Text log. Lines look like the live match sheet's (DuelLogLine); lines new at this step are lit. */
export function LogList({ entries: allEntries, freshIds, reducedMotion, playerName }: {
  entries: ReplayLogEntry[];
  freshIds: Set<number>;
  reducedMotion: boolean;
  playerName: (seat: number) => string;
}) {
  const endRef = useRef<HTMLLIElement>(null);
  // The replay's coin toss line also waits for the coin to land.
  const entries = withoutHeldTossLines(allEntries, useHeldTossLogIds());
  const categories = useLogCategories(entries);
  const count = entries.length;
  // Follow the newest entry id: the engine caps the log at 400 lines, so the length stops changing.
  const lastId = entries[count - 1]?.id;
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
  }, [lastId, count, reducedMotion]);
  return (
    <ol className={styles.log} aria-label="Duel log">
      {entries.map((entry, i) => (
        <DuelLogLine key={`${entry.id}-${i}`} ref={i === count - 1 ? endRef : undefined} text={entry.text} category={categories[i]}
          playerName={playerName} className={freshIds.has(entry.id) ? replayStyles.logNew : undefined} />
      ))}
    </ol>
  );
}

/**
 * The board of a replay frame. The two-seat field draws the camera seat at the bottom and one opposite seat on
 * top; the table layouts for Tag and free-for-all plug in here and read the same read-only `table` controller.
 */
function ReplayBoard({ table, masterRule, camera, focusSeat, mySeat, playerName }: {
  table: TableController;
  masterRule: DuelMasterRule;
  camera: number;
  focusSeat: number;
  mySeat: number | null;
  playerName: (seat: number) => string;
}) {
  // The cards a seat shows were fixed by the server; the camera only decides which seat is drawn at the bottom.
  const ownCamera = mySeat != null && camera === mySeat;
  return (
    <DuelField engine={table.engine} mySeat={ownCamera ? mySeat : null} bottomSeat={camera} topSeat={focusSeat}
      masterRule={masterRule} reducedMotion={table.reducedMotion}
      legalKeys={table.legalKeys} selectedKeys={table.selectedKeys} onActivate={table.onActivate}
      onHoverCard={table.onHoverCard} onInspect={table.onInspect}
      bottomName={playerName(camera)} topName={playerName(focusSeat)} />
  );
}

/**
 * While another card view loads, the table stays mounted (the camera, zoom and open panels belong to it) but is
 * hidden and inert: the old card view is never on screen, and nothing on it can be used.
 */
function ReplayBusy({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <>
      <div className={replayStyles.busyScope} data-replay-busy={busy ? "true" : undefined} aria-busy={busy || undefined} inert={busy}>
        {children}
      </div>
      {busy ? <div className={replayStyles.busyNote} role="status">Loading replay…</div> : null}
    </>
  );
}

/**
 * `canInspectSource` comes from the server page (the owner check). It only asks for the private replay and the
 * owner controls; the routes check the owner list again and the answer must carry capabilities before any control shows.
 */
export function DuelReplayView({ slug, canInspectSource = false, viewerId }: { slug: string; canInspectSource?: boolean; viewerId?: number | string }) {
  const historyHref = useMatchHistoryHref(viewerId);
  const [visibility, setVisibility] = useState<ReplayVisibility>("mine");
  const [ownerView, setOwnerView] = useState<OwnerViewState>({ seat: null, reveal: false });
  const [forkStepId, setForkStepId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The owner opened a replay that could not be checked. It rides in the address too (?unchecked=1), so a reload keeps it.
  // Only the owner page may ask; the routes refuse anyone else.
  const routed = useSearchParams();
  const uncheckedInUrl = canInspectSource && routed?.get(UNCHECKED_PARAM) === "1";
  const [unchecked, setUnchecked] = useState(uncheckedInUrl);
  const { model, settled, error, reload } = useReplayData(
    slug, visibility, canInspectSource ? { enabled: true, ...ownerView } : null, unchecked,
  );
  const preferences = useDuelPreferences();
  const [inspect, setInspect] = useState<InspectTarget | null>(null);
  const [pane, setPane] = useState<"card" | "log">("card");
  const [mobileInspect, setMobileInspect] = useState(false);
  const [hover, setHover] = useState<{ card: DuelCard; anchor: HTMLElement } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const frames = model?.frames ?? null;
  const seatCount = model ? seatCountFor(model.session.format) : 2;
  // While another card view loads, the table is hidden: no key may move it (see ReplayBusy).
  const awaiting = model != null && !settled && (model.visibility !== visibility || canInspectSource);
  const controller = useReplayController({ slug, frames, seatCount, mySeat: model?.mySeat ?? null, enabled: !awaiting });
  const { index, last, playing, speed, epoch, camera } = controller;
  const timeline = useMemo(() => (frames ? buildReplayTimeline(frames) : null), [frames]);

  // The owner's open forks and the Jump in request live here, not in the header: the table shells remount their header on
  // every seek, and a remount must not ask the list again or lose a Jump in that is on its way.
  // Fail closed: both the page's owner hint and the capabilities the server put in this answer are needed.
  const ownerAnswer = canInspectSource && isOwnerModel(model);
  const openForks = useOpenForks(ownerAnswer);
  const fork = useForkStart({ slug, model, frame: forkTarget(model, model?.frames[index], forkStepId), onReload: reload, onPause: controller.pause, openForks });

  // The button that opened the unchecked replay is gone by the time the answer comes: put focus on the new page (the
  // replay controls, or the failure) instead of leaving it on the body.
  const refocus = useRef(false);
  useEffect(() => {
    if (!refocus.current) return;
    const answered = model != null && settled;
    const failed = !answered && error != null && model == null;
    if (!answered && !failed) return;
    // The first answer or error ends the hand-over, also when the answer has no moves (then the empty page takes focus).
    refocus.current = false;
    const target = answered
      ? document.querySelector<HTMLElement>('[role="group"][aria-label="Replay controls"]') ?? document.querySelector<HTMLElement>("[data-replay-empty]")
      : document.querySelector<HTMLElement>("[data-replay-failure]");
    if (!target) return;
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
  }, [model, settled, error]);

  useEffect(() => {
    setUnchecked(uncheckedInUrl);
    setVisibility("mine");
    setOwnerView({ seat: null, reveal: false });
    setNotice(null);
    setForkStepId(null);
    setInspect(null);
    setHover(null);
  }, [slug]);

  useEffect(() => {
    if (canInspectSource && model?.capabilities) return;
    setInspect(null);
    setHover(null);
    setMobileInspect(false);
  }, [canInspectSource, model?.capabilities]);

  // A failed switch of card visibility keeps what is on screen and says why.
  useEffect(() => {
    if (!error || !model) return;
    setNotice(replayFailure(error, "Could not switch the card view.").message);
    setVisibility(model.visibility);
    setOwnerView({ seat: model.requestedView.seat, reveal: model.requestedView.reveal });
  }, [error, model]);

  const engine = useMemo(() => (timeline && timeline.length > 0 ? timeline.viewAt(index) : null), [timeline, index]);
  const freshIds = useMemo(
    () => new Set(timeline?.newLogAt(index).map((entry) => entry.id) ?? []),
    [timeline, index],
  );

  function changeVisibility(next: ReplayVisibility) {
    if (next === visibility) return;
    // The inspector, hover card and running effects belong to the old card view.
    setInspect(null);
    setHover(null);
    setMobileInspect(false);
    setNotice(null);
    controller.pause();
    controller.resetEffects();
    setVisibility(next);
    // The public view and "my cards" have no seat choice.
    setOwnerView((value) => (value.seat == null ? value : { ...value, seat: null }));
  }

  function changeOwnerView(next: OwnerViewState) {
    if (next.seat === ownerView.seat && next.reveal === ownerView.reveal) return;
    setInspect(null);
    setHover(null);
    setMobileInspect(false);
    setNotice(null);
    controller.pause();
    controller.resetEffects();
    if (next.seat != null) setVisibility("mine");
    setOwnerView(next);
  }

  // Reload with ?unchecked=1: the address changes (so a browser reload keeps it) and the replay is asked for again.
  function openUnchecked() {
    window.history.replaceState(window.history.state, "", withUncheckedParam(
      `${window.location.pathname}${window.location.search}${window.location.hash}`, true,
    ));
    refocus.current = true;
    setUnchecked(true);
  }

  if (!model && !error) return <div className="p-6 text-sm text-text-secondary" aria-busy="true">Loading replay…</div>;
  if (error && !model) {
    const failure = replayFailure(error, undefined, unchecked);
    return (
      <div className={replayStyles.state} data-replay-failure tabIndex={-1}>
        <p role="alert" className="text-accent-cta">{failure.message}</p>
        {failure.noFinalBoard ? <p className="text-text-secondary" data-replay-no-final-board>{NO_FINAL_BOARD_COPY}</p> : null}
        {failure.canOpenUnchecked && !unchecked ? (
          <button type="button" className={replayStyles.stateButton} data-replay-open-unchecked onClick={openUnchecked}>
            <TriangleAlert size={14} aria-hidden /> Open unchecked replay
          </button>
        ) : null}
        <div className={replayStyles.stateLinks}>
          {failure.finalBoard ? <Link href={`/duels/${slug}`} className="text-sm text-text-secondary underline">Final board</Link> : null}
          <Link href={historyHref} className="text-sm text-text-secondary underline">Match history</Link>
        </div>
      </div>
    );
  }
  // Keep the checkpoint selection in this page across private projection loading/remounts.
  // Fail closed: the controls need both the page's owner hint and the capabilities the server put in this answer.
  const renderOwnerTools = (low: boolean) => ownerAnswer ? (
    <ReplayOwnerTools slug={slug} model={model} frame={model.frames[index]} busy={!settled}
      view={ownerView} onViewChange={changeOwnerView} onReload={reload} openForks={openForks} fork={fork}
      selectedStep={forkStepId} onSelectStep={setForkStepId} low={low} />
  ) : null;
  const ownerTools = renderOwnerTools(false);
  if (!model || !timeline || !engine || timeline.length === 0) {
    return (
      <div className={replayStyles.state} data-replay-empty tabIndex={-1}>
        <p role="alert" className="text-accent-cta">{ownerTools && model?.forkSteps
          ? "Move views exceed the size limit. Choose a move to Jump in."
          : model ? "This replay has no recorded moves." : "Could not load this replay."}</p>
        {ownerTools ? <div data-replay-tools-wrap>{ownerTools}</div> : null}
        <div className={replayStyles.stateLinks}>
          <Link href={`/duels/${slug}`} className="text-sm text-text-secondary underline">Final board</Link>
          <Link href={historyHref} className="text-sm text-text-secondary underline">Match history</Link>
        </div>
      </div>
    );
  }

  const session = model.session;
  // Tag draws the Rooftop table (four seats, team LP, shared Extra Monster zones) in its own page.
  if (session.format === "tag") {
    return (
      <ReplayBusy busy={awaiting}>
        <ReplayTag slug={slug} viewerId={viewerId} model={model} timeline={timeline} engine={engine} controller={controller}
          visibility={visibility} onVisibilityChange={changeVisibility} notice={notice} tools={ownerTools} inputSuspended={awaiting} />
      </ReplayBusy>
    );
  }
  const frame = timeline.frame(index);
  const domain = session.mode === "domain";
  // This page draws the two-seat board; Tag and the free-for-all formats returned above.
  const focusSeat = resolveFocusSeat(session, camera, null);
  const playerName = (seat: number) =>
    session.seats.find((player) => player.seat === seat)?.displayName ?? `Player ${seat + 1}`;
  const modeText = domain
    ? isCustomDomain(session.masterRule, session.settings) ? "Custom Domain" : "Domain"
    : `MR${session.masterRule}`;
  const atEnd = index >= last;
  const result = atEnd ? (engine.result ?? (session.resultReason ? { winnerSeat: session.winnerSeat, reason: session.resultReason } : null)) : null;
  const newLines = timeline.newLogAt(index);
  const actor = frameCaption(frame, index, atEnd, playerName);
  const resultHeadline = replayResultHeadline(session, result, playerName);
  const canSwitchCards = model.version === 2 && model.mySeat != null;

  // 3-way and 4-way free-for-all tables draw every field in the shared table shell (replay mode).
  if (isFfaFormat(session.format)) {
    return (
      <ReplayBusy busy={awaiting}>
        <ReplayFfa slug={slug} model={model} frames={model.frames} engine={engine} controller={controller} preferences={preferences}
          visibility={visibility} canSwitchCards={canSwitchCards} onVisibility={changeVisibility} notice={notice}
          newLines={newLines} onCamera={() => { setInspect(null); setHover(null); }} tools={ownerTools} inputSuspended={awaiting} />
      </ReplayBusy>
    );
  }

  function showInspector(target: InspectTarget, mobile = false) {
    setInspect(target);
    setPane("card");
    if (mobile && window.matchMedia("(max-width: 900px)").matches) setMobileInspect(true);
  }
  function onHoverCard(card: DuelCard | null, anchor: HTMLElement | null) {
    if (!card || !anchor || card.code == null) {
      setHover(null);
      return;
    }
    setHover({ card, anchor });
    if (pane === "card") setInspect({ type: "card", card });
  }
  function onActivate(_keys: string[], card: DuelCard | null) {
    setHover(null);
    if (card) showInspector({ type: "card", card }, true);
  }

  // The shells and the field only ever see this controller: it has no prompt and its answer callback does nothing.
  const table = createReadOnlyTableController({
    room: replayRoom(model, engine),
    engine,
    camera,
    nameOf: playerName,
    reducedMotion: preferences.reducedMotion,
    onActivate,
    onInspect: (target) => showInspector(target, true),
    onHoverCard,
  });

  const inspector = (
    <CardInspector target={inspect} onInspectCard={(card) => setInspect({ type: "card", card })} />
  );
  const sideContent = pane === "card" ? inspector : (
    <LogList entries={engine.log} freshIds={freshIds} reducedMotion={preferences.reducedMotion} playerName={playerName} />
  );
  const tabs = (mobile: boolean) => (
    <div className={`${styles.tabs} ${replayStyles.tabs}`} role="group" aria-label={mobile ? "Mobile replay panels" : "Replay panels"}>
      {(["card", "log"] as const).map((tab) => (
        <button key={tab} type="button" aria-pressed={pane === tab} aria-haspopup={mobile ? "dialog" : undefined}
          onClick={() => { setPane(tab); if (mobile) setMobileInspect(true); }}>
          {tab[0].toUpperCase() + tab.slice(1)}
        </button>
      ))}
    </div>
  );
  const seats = Array.from({ length: seatCount }, (_, seat) => seat);

  return (
    <ReplayBusy busy={awaiting}>
    <div className={`${styles.shell} ${duelFontClasses} -mx-4 -my-4 sm:-mx-6 sm:-my-6 lg:-mx-8 lg:-my-8`} data-domain={domain}
      data-replay-frame={controller.frameId ?? undefined} data-replay-visibility={model.visibility}>
      <header className={styles.header}>
        <div className={styles.identity}>
          <Link href={historyHref}>Match history</Link>
          <strong className={replayStyles.badge}><PlayCircle size={14} aria-hidden /> Replay</strong>
          <span>{modeText} · {formatLabel(session.format)}</span>
        </div>
        <div className={styles.turn}>
          <strong>Turn {engine.turn}</strong><span>{phaseLabel(engine.phase)}</span>
        </div>
        <div className={styles.status}>
          <span className={styles.pref}>{session.name}</span>
        </div>
      </header>
      <div className={styles.layout}>
        <aside className={styles.inspector}>
          <span className={styles.chamfer} aria-hidden="true" />
          {tabs(false)}
          <div className={styles.sideContent} role="region" aria-label={pane === "card" ? "Card" : "Duel log"} {...cardScrollerProps(pane === "card")}>{sideContent}</div>
        </aside>
        <section className={styles.boardColumn} aria-label="Replay field">
          <div className={styles.board} ref={boardRef}>
            <MoveSourceBoundary events={engine.events} duelKey={`${slug}:replay:${epoch}`} root={boardRef}>
            {/* A replay shows the cracks of the seek position and never animates them. */}
            <FieldCracksScope duelKey={slug} format={session.format} settings={session.settings} replay>
            <ReplayBoard key={`${slug}:${camera}:${focusSeat}`} table={table} masterRule={session.masterRule}
              camera={camera} focusSeat={focusSeat} mySeat={model.mySeat} playerName={playerName} />
            </FieldCracksScope>
            <DuelFeedback events={engine.events} duelKey={`${slug}:replay:${epoch}`} attackToast
              soundEnabled={preferences.soundEnabled} soundVolume={preferences.soundVolume} reducedMotion={preferences.reducedMotion} />
            {/* The replay plays the coin too, passive: nothing is locked and the cover takes no pointer. */}
            <CoinTossFx events={engine.events} duelKey={`${slug}:replay:${epoch}`} reducedMotion={preferences.reducedMotion} passive />
            </MoveSourceBoundary>
          </div>
          <nav className={styles.phases} aria-label="Duel phases">
            {PHASES.map((phase) => (
              <button key={phase.label} type="button" disabled aria-label={phase.name}
                aria-current={phaseLabel(engine.phase) === phase.name ? "step" : undefined}>
                {phase.label}
              </button>
            ))}
          </nav>
          {engine.chain.length ? (
            <section className={styles.chain} aria-label="Current chain">
              <strong>Chain · resolves highest link first</strong>
              <ol>{engine.chain.map((link) => (
                <li key={link.index}><b>{link.index}</b><span>{link.name ?? "Effect"}<small>{playerName(link.seat)}{link.description ? ` · ${link.description}` : ""}</small></span></li>
              ))}</ol>
            </section>
          ) : null}
          <div className={styles.promptDock} data-idle="true">
            <div className={replayStyles.controls}>
              {result ? (
                <div className={replayStyles.result} role="status">
                  <strong>{resultHeadline}</strong>
                  <span>{result.reason}</span>
                </div>
              ) : null}
              <div className={replayStyles.caption} aria-live="off">
                <span className={replayStyles.actor}>{actor}</span>
                <ul className={replayStyles.captionLines}>
                  {newLines.slice(-4).map((entry, i) => <li key={`${entry.id}-${i}`}>{entry.text}</li>)}
                </ul>
              </div>
              <ReplayStatus playing={playing} index={index} last={last} caption={actor} />
              <div className={replayStyles.transport}>
                <div className={replayStyles.buttons} role="group" aria-label="Replay controls">
                  <button type="button" className={replayStyles.iconButton} aria-label="First move"
                    {...stepButtonProps(index === 0, () => controller.seek(0))}><SkipBack size={18} aria-hidden /></button>
                  <button type="button" className={replayStyles.iconButton} aria-label="Previous move"
                    {...stepButtonProps(index === 0, controller.stepBack)}><ChevronLeft size={20} aria-hidden /></button>
                  <button type="button" className={`${replayStyles.iconButton} ${replayStyles.play}`}
                    aria-label={playing ? "Pause" : "Play"} onClick={controller.togglePlay}>
                    {playing ? <Pause size={20} aria-hidden /> : <Play size={20} aria-hidden />}
                  </button>
                  <button type="button" className={replayStyles.iconButton} aria-label="Next move"
                    {...stepButtonProps(atEnd, controller.stepForward)}><ChevronRight size={20} aria-hidden /></button>
                  <button type="button" className={replayStyles.iconButton} aria-label="Last move"
                    {...stepButtonProps(atEnd, () => controller.seek(last))}><SkipForward size={18} aria-hidden /></button>
                </div>
                <input type="range" className={replayStyles.slider} aria-label="Replay position"
                  min={0} max={last} step={1} value={index}
                  aria-valuetext={`Move ${index} of ${last}`}
                  onChange={(event) => controller.seek(Number(event.target.value))} />
                <div className={replayStyles.meta}>
                  <span>Move {index} / {last}</span>
                  <label className="flex items-center gap-2">
                    <span className="sr-only">Playback speed</span>
                    <select className={replayStyles.select} value={speed} aria-label="Playback speed"
                      onChange={(event) => controller.setSpeed(Number(event.target.value))}>
                      {SPEEDS.map((value) => <option key={value} value={value}>{value}×</option>)}
                    </select>
                  </label>
                </div>
              </div>
              <div className={replayStyles.viewBar} role="group" aria-label="Replay view">
                <label className={replayStyles.viewField}>
                  <span>View from</span>
                  <select className={replayStyles.select} value={camera} aria-label="View from seat"
                    onChange={(event) => {
                      setInspect(null);
                      setHover(null);
                      controller.setCamera(Number(event.target.value));
                    }}>
                    {seats.map((seat) => <option key={seat} value={seat}>{playerName(seat)}</option>)}
                  </select>
                </label>
                {canSwitchCards ? (
                  <div className={replayStyles.segmented} role="group" aria-label="Card visibility">
                    {(["mine", "public"] as const).map((value) => (
                      <button key={value} type="button" aria-pressed={visibility === value}
                        onClick={() => changeVisibility(value)}>
                        {value === "mine" ? "My cards" : "Public"}
                      </button>
                    ))}
                  </div>
                ) : null}
                {renderOwnerTools(true)}
              </div>
              <ReplayVerificationNote verification={checkNoteOf(model)} />
              {notice ? <p role="alert" className={replayStyles.note}>{notice}</p> : null}
              {model.mySeat == null || model.visibility === "public"
                ? <p className={replayStyles.note}>Public view — hidden cards stay hidden</p> : null}
              <p className={replayStyles.note}>
                <Link href={`/duels/${slug}`} className={replayStyles.link}>Final board</Link>
              </p>
            </div>
          </div>
        </section>
        {domain ? <aside className={styles.masters} aria-label="Deck Masters">
          <DeckMasterRail engine={engine} mySeat={model.mySeat} bottomSeat={camera} topSeat={focusSeat} legalKeys={table.legalKeys}
            selectedKeys={table.selectedKeys} canAct={false} legalActionsFor={noActions}
            onActivate={onActivate} onChooseAction={noop}
            onHoverCard={onHoverCard} onInspect={(target) => showInspector(target, true)} showInUse />
        </aside> : null}
      </div>
      <div className={styles.mobileBar}>{tabs(true)}</div>
      {hover && !mobileInspect ? <CardHoverInfo card={hover.card} anchor={hover.anchor} /> : null}
      <Sheet open={mobileInspect} onClose={() => setMobileInspect(false)} title={pane === "card" ? "Card" : "Duel log"}>
        {sideContent}
      </Sheet>
    </div>
    </ReplayBusy>
  );
}
