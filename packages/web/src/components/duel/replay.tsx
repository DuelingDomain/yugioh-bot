"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ChevronLeft, ChevronRight, Pause, Play, PlayCircle, SkipBack, SkipForward } from "lucide-react";
import { isCustomDomain, type DuelCard } from "@yugidraft/shared/duels";
import { Sheet } from "@/components/ui/sheet";
import { duelReplayKey, getDuelReplay } from "./api";
import { CardHoverInfo } from "./card-interactions";
import { phaseLabel } from "./constants";
import { DeckMasterRail, DuelField } from "./field";
import { DuelFeedback } from "./feedback";
import { MoveSourceBoundary } from "./fx-boundary";
import { CardInspector, type InspectTarget } from "./inspector";
import { DuelLogLine, useLogCategories } from "./log-line";
import { useDuelPreferences } from "./preferences";
import { buildReplayTimeline, type ReplayLogEntry } from "./replay-timeline";
import styles from "./room.module.css";
import replayStyles from "./replay.module.css";
import { duelFontClasses } from "./fonts";

const BASE_STEP_MS = 1400;
const SPEEDS = [0.5, 1, 2, 4] as const;
const PHASES = [
  { label: "DP", name: "Draw" },
  { label: "SP", name: "Standby" },
  { label: "M1", name: "Main 1" },
  { label: "BP", name: "Battle" },
  { label: "M2", name: "Main 2" },
  { label: "EP", name: "End" },
];
const EMPTY_KEYS: Set<string> = new Set();
const noActions = () => [];
const noop = () => undefined;

/** The replay's Text log. Lines look like the live match sheet's (DuelLogLine); lines new at this step are lit. */
export function LogList({ entries, freshIds, reducedMotion, playerName }: {
  entries: ReplayLogEntry[];
  freshIds: Set<number>;
  reducedMotion: boolean;
  playerName: (seat: number) => string;
}) {
  const endRef = useRef<HTMLLIElement>(null);
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

export function DuelReplayView({ slug }: { slug: string }) {
  const { data, error, isLoading } = useSWR(slug ? duelReplayKey(slug) : null, () => getDuelReplay(slug), {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    refreshInterval: 0,
    shouldRetryOnError: false,
  });
  const preferences = useDuelPreferences();
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [epoch, setEpoch] = useState(0);
  const [inspect, setInspect] = useState<InspectTarget | null>(null);
  const [pane, setPane] = useState<"card" | "log">("card");
  const [mobileInspect, setMobileInspect] = useState(false);
  const [hover, setHover] = useState<{ card: DuelCard; anchor: HTMLElement } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const timeline = useMemo(() => (data ? buildReplayTimeline(data.frames) : null), [data]);
  const last = Math.max((timeline?.length ?? 1) - 1, 0);
  const indexRef = useRef(index);
  indexRef.current = index;

  useEffect(() => {
    setIndex(0);
    setPlaying(false);
    setEpoch((value) => value + 1);
    setInspect(null);
    setHover(null);
  }, [slug]);

  const seek = useCallback((target: number) => {
    setIndex(Math.min(Math.max(target, 0), last));
    setEpoch((value) => value + 1);
  }, [last]);
  const stepForward = useCallback(() => setIndex((value) => Math.min(value + 1, last)), [last]);
  const togglePlay = useCallback(() => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (indexRef.current >= last) seek(0);
    setPlaying(true);
  }, [playing, last, seek]);

  useEffect(() => {
    if (!playing) return;
    if (index >= last) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => setIndex((value) => Math.min(value + 1, last)), BASE_STEP_MS / speed);
    return () => window.clearTimeout(timer);
  }, [playing, index, speed, last]);

  useEffect(() => {
    if (!timeline) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      if (event.key === " " || event.key === "Spacebar") {
        if (tag === "BUTTON" || tag === "A") return;
        event.preventDefault();
        togglePlay();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        stepForward();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        seek(indexRef.current - 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        seek(0);
      } else if (event.key === "End") {
        event.preventDefault();
        seek(last);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [timeline, togglePlay, stepForward, seek, last]);

  const engine = useMemo(() => timeline?.viewAt(index) ?? null, [timeline, index]);
  const freshIds = useMemo(
    () => new Set(timeline?.newLogAt(index).map((entry) => entry.id) ?? []),
    [timeline, index],
  );

  if (isLoading && !data) return <div className="p-6 text-sm text-text-secondary">Loading replay…</div>;
  if (error || !data || !timeline || !engine || timeline.length === 0) {
    const message = error instanceof Error ? error.message
      : data && data.frames.length === 0 ? "This replay has no recorded moves." : "Could not load this replay.";
    return (
      <div className={replayStyles.state}>
        <p role="alert" className="text-accent-cta">{message}</p>
        <div className={replayStyles.stateLinks}>
          <Link href={`/duels/${slug}`} className="text-sm text-text-secondary underline">Final board</Link>
          <Link href="/duels?view=history" className="text-sm text-text-secondary underline">Match history</Link>
        </div>
      </div>
    );
  }

  const session = data.session;
  const frame = timeline.frame(index);
  const domain = session.mode === "domain";
  const localSeat = data.mySeat ?? 0;
  const top = engine.seats.find((seat) => seat.seat !== localSeat);
  const playerName = (seat: number) =>
    session.seats.find((player) => player.seat === seat)?.displayName ?? `Player ${seat + 1}`;
  const modeText = domain
    ? isCustomDomain(session.masterRule, session.settings) ? "Custom Domain" : "Domain"
    : `MR${session.masterRule}`;
  const atEnd = index >= last;
  const result = atEnd ? (engine.result ?? (session.resultReason ? { winnerSeat: session.winnerSeat, reason: session.resultReason } : null)) : null;
  const newLines = timeline.newLogAt(index);
  const actor = index === 0 ? "Opening board"
    : frame.actorSeat == null ? (atEnd ? "Final result" : "Update")
      : `${playerName(frame.actorSeat)} acted`;
  const resultHeadline = session.status === "interrupted" ? "Interrupted"
    : result?.winnerSeat != null ? `${playerName(result.winnerSeat)} wins` : "Draw";

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

  return (
    <div className={`${styles.shell} ${duelFontClasses} -mx-4 -my-4 sm:-mx-6 sm:-my-6 lg:-mx-8 lg:-my-8`} data-domain={domain}>
      <header className={styles.header}>
        <div className={styles.identity}>
          <Link href="/duels?view=history">Match history</Link>
          <strong className={replayStyles.badge}><PlayCircle size={14} aria-hidden /> Replay</strong>
          <span>{modeText} · 1v1</span>
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
          <div className={styles.sideContent} role="region" aria-label={pane === "card" ? "Card" : "Duel log"}>{sideContent}</div>
        </aside>
        <section className={styles.boardColumn} aria-label="Replay field">
          <div className={styles.board} ref={boardRef}>
            <MoveSourceBoundary events={engine.events} duelKey={`${slug}:replay:${epoch}`} root={boardRef}>
            <DuelField key={slug} engine={engine} mySeat={data.mySeat} masterRule={session.masterRule}
              reducedMotion={preferences.reducedMotion}
              legalKeys={EMPTY_KEYS} selectedKeys={EMPTY_KEYS} onActivate={onActivate}
              onHoverCard={onHoverCard} onInspect={(target) => showInspector(target, true)}
              bottomName={playerName(localSeat)}
              topName={playerName(top?.seat ?? 1 - localSeat)} />
            <DuelFeedback events={engine.events} duelKey={`${slug}:replay:${epoch}`}
              soundEnabled={preferences.soundEnabled} soundVolume={preferences.soundVolume} reducedMotion={preferences.reducedMotion} />
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
              <div className={replayStyles.transport}>
                <div className={replayStyles.buttons} role="group" aria-label="Replay controls">
                  <button type="button" className={replayStyles.iconButton} aria-label="First move"
                    disabled={index === 0} onClick={() => seek(0)}><SkipBack size={18} aria-hidden /></button>
                  <button type="button" className={replayStyles.iconButton} aria-label="Previous move"
                    disabled={index === 0} onClick={() => seek(index - 1)}><ChevronLeft size={20} aria-hidden /></button>
                  <button type="button" className={`${replayStyles.iconButton} ${replayStyles.play}`}
                    aria-label={playing ? "Pause" : "Play"} onClick={togglePlay}>
                    {playing ? <Pause size={20} aria-hidden /> : <Play size={20} aria-hidden />}
                  </button>
                  <button type="button" className={replayStyles.iconButton} aria-label="Next move"
                    disabled={atEnd} onClick={stepForward}><ChevronRight size={20} aria-hidden /></button>
                  <button type="button" className={replayStyles.iconButton} aria-label="Last move"
                    disabled={atEnd} onClick={() => seek(last)}><SkipForward size={18} aria-hidden /></button>
                </div>
                <input type="range" className={replayStyles.slider} aria-label="Replay position"
                  min={0} max={last} step={1} value={index}
                  aria-valuetext={`Move ${index} of ${last}`}
                  onChange={(event) => seek(Number(event.target.value))} />
                <div className={replayStyles.meta}>
                  <span>Move {index} / {last}</span>
                  <label className="flex items-center gap-2">
                    <span className="sr-only">Playback speed</span>
                    <select className={replayStyles.select} value={speed} aria-label="Playback speed"
                      onChange={(event) => setSpeed(Number(event.target.value))}>
                      {SPEEDS.map((value) => <option key={value} value={value}>{value}×</option>)}
                    </select>
                  </label>
                </div>
              </div>
              {data.mySeat == null ? <p className={replayStyles.note}>Public view — hidden cards stay hidden</p> : null}
              <p className={replayStyles.note}>
                <Link href={`/duels/${slug}`} className={replayStyles.link}>Final board</Link>
              </p>
            </div>
          </div>
        </section>
        {domain ? <aside className={styles.masters} aria-label="Deck Masters">
          <DeckMasterRail engine={engine} mySeat={data.mySeat} legalKeys={EMPTY_KEYS}
            selectedKeys={EMPTY_KEYS} canAct={false} legalActionsFor={noActions}
            onActivate={onActivate} onChooseAction={noop}
            onHoverCard={onHoverCard} onInspect={(target) => showInspector(target, true)} />
        </aside> : null}
      </div>
      <div className={styles.mobileBar}>{tabs(true)}</div>
      {hover && !mobileInspect ? <CardHoverInfo card={hover.card} anchor={hover.anchor} /> : null}
      <Sheet open={mobileInspect} onClose={() => setMobileInspect(false)} title={pane === "card" ? "Card" : "Duel log"}>
        {sideContent}
      </Sheet>
    </div>
  );
}
