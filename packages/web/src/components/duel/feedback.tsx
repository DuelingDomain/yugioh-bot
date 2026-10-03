"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { DuelCardInfo, DuelEvent } from "@yugidraft/shared/duels";
import { CardBack } from "./card-face";
import { cardArtUrl } from "./constants";
import { BANNER_TIMING } from "./duel-timing";
import {
  collectFreshEvents,
  DUEL_FX_CUE_EVENT,
  type DuelFxCueDetail,
  fxSoundsItself,
  hasCentreBanner,
  isDrawnOnBoard,
  isPositionEvent,
  maxEventId,
  pacedCueDuration,
} from "./event-queue";
import { DEFAULT_SOUND_VOLUME } from "./preferences";
import { battleDestroyAt } from "./battle-hold";
import { chainBeatAt, chainEffectAt } from "./chain-beats";
import { createDuelFeedbackAudio, type DuelFeedbackAudio } from "./feedback-audio";
import { pairedMovePlan } from "./move-plan";
import { getPhaseBeat, planPhaseBeats } from "./phase-beats";
import styles from "./feedback.module.css";

export type DuelFeedbackProps = {
  events: readonly DuelEvent[];
  duelKey: string;
  soundEnabled: boolean;
  /** Master volume 0..1; missing means full level (the audio default). */
  soundVolume?: number;
  reducedMotion: boolean;
  /**
   * Where the first render starts playing: events with a larger id are shown instead of dropped as
   * history. 0 plays the opening of a duel (its phases). Missing or null: no replay.
   */
  replayFrom?: number | null;
  /** Opening history to skip even in a layer that mounted before it arrived. */
  skipThrough?: number | null;
};

const KIND_LABEL: Record<string, string> = {
  summon: "Summon",
  set: "Set",
  activate: "Activate",
  "chain-negated": "Negated",
  attack: "Attack",
  phase: "Phase",
  damage: "Damage",
  destroy: "Destroyed",
  move: "Move",
  position: "Position",
};

function publicCard(event: DuelEvent): DuelCardInfo | null {
  const card = event.card;
  if (card == null || card.code <= 0) return null;
  return card;
}

function cueTitle(event: DuelEvent, card: DuelCardInfo | null): string {
  const text = event.text.trim();
  if (!card) {
    if (event.kind === "set") return text || "Set";
    return text || KIND_LABEL[event.kind] || event.kind;
  }
  return text || card.name || KIND_LABEL[event.kind] || event.kind;
}

function cueBlurb(event: DuelEvent, card: DuelCardInfo | null): string | undefined {
  const fromEvent = event.description?.trim();
  if (fromEvent) return fromEvent;
  if (event.kind === "activate" && card) {
    const fromCard = card.description.trim();
    if (fromCard) return fromCard;
  }
  return undefined;
}

/** Entrance and exit lengths for a cue that lives `durationMs`: in about a fifth, out a little less. */
function cueTiming(durationMs: number, reducedMotion: boolean): CSSProperties {
  const enter = reducedMotion ? Math.min(140, durationMs * 0.3) : clampMs(durationMs * 0.34, BANNER_TIMING.enterMin, BANNER_TIMING.enterMax);
  const leave = reducedMotion ? Math.min(140, durationMs * 0.3) : clampMs(durationMs * 0.24, BANNER_TIMING.leaveMin, BANNER_TIMING.leaveMax);
  return {
    "--cue-total": `${Math.round(durationMs)}ms`,
    "--cue-in": `${Math.round(enter)}ms`,
    "--cue-out": `${Math.round(leave)}ms`,
  } as CSSProperties;
}

function clampMs(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function FeedbackCue({
  event,
  reducedMotion,
  durationMs,
}: {
  event: DuelEvent;
  reducedMotion: boolean;
  durationMs: number;
}) {
  const timing = cueTiming(durationMs, reducedMotion);
  if (event.kind === "phase") {
    const title = event.text.trim() || KIND_LABEL.phase;
    return (
      <div
        className={styles.phaseRibbon}
        data-kind="phase"
        data-reduced={reducedMotion ? "true" : "false"}
        style={timing}
      >
        <p className={styles.phaseTitle}>{title}</p>
      </div>
    );
  }

  if (event.kind === "attack") {
    // The attack itself is drawn on the board; the cue is a one-line caption.
    const caption = event.text.trim() || KIND_LABEL.attack;
    return (
      <div
        className={styles.cue}
        data-kind="attack"
        data-compact="true"
        data-reduced={reducedMotion ? "true" : "false"}
        style={timing}
      >
        <span className={styles.kind}>{KIND_LABEL.attack}</span>
        <p className={styles.title}>{caption}</p>
      </div>
    );
  }

  const card = publicCard(event);
  const title = cueTitle(event, card);
  const blurb = cueBlurb(event, card);
  const portrait = card ? (
    <div className={styles.portrait}>
      <img src={cardArtUrl(card.code, "small")} alt="" className={styles.art} draggable={false} />
    </div>
  ) : event.kind === "set" ? (
    <div className={styles.portrait}>
      <CardBack />
    </div>
  ) : null;

  return (
    <div
      className={styles.cue}
      data-kind={event.kind}
      data-chain={event.chainIndex != null ? "true" : "false"}
      data-reduced={reducedMotion ? "true" : "false"}
      style={timing}
    >
      {portrait}
      <div className={styles.meta}>
        <div className={styles.row}>
          <span className={styles.kind}>{KIND_LABEL[event.kind]}</span>
          {event.chainIndex != null ? (
            <span className={styles.chain}>Chain {event.chainIndex}</span>
          ) : null}
        </div>
        <p className={styles.title}>{title}</p>
        {blurb ? <p className={styles.blurb}>{blurb}</p> : null}
      </div>
    </div>
  );
}

export function DuelFeedback({
  events,
  duelKey,
  soundEnabled,
  soundVolume = DEFAULT_SOUND_VOLUME,
  reducedMotion,
  replayFrom = null,
  skipThrough = null,
}: DuelFeedbackProps) {
  const [current, setCurrent] = useState<{ event: DuelEvent; durationMs: number } | null>(null);
  const currentRef = useRef<DuelEvent | null>(null);
  const queueRef = useRef<DuelEvent[]>([]);
  const cursorRef = useRef<number | null>(null);
  const keyRef = useRef(duelKey);
  const timerRef = useRef<number | null>(null);
  /** Sounds and banners held back until the card flight they belong to lands. */
  const holdTimersRef = useRef<Set<number>>(new Set());
  const audioRef = useRef<DuelFeedbackAudio | null>(null);
  const soundRef = useRef(soundEnabled);
  const volumeRef = useRef(soundVolume);
  const reducedRef = useRef(reducedMotion);
  const replayRef = useRef(replayFrom);
  const startNextRef = useRef<() => void>(() => undefined);

  soundRef.current = soundEnabled;
  volumeRef.current = soundVolume;
  reducedRef.current = reducedMotion;
  replayRef.current = replayFrom;
  startNextRef.current = () => {
    if (currentRef.current) return;
    const next = queueRef.current.shift();
    if (!next) {
      setCurrent(null);
      return;
    }
    currentRef.current = next;
    const remaining = 1 + queueRef.current.length;
    const ms = pacedCueDuration(next.kind, reducedRef.current, remaining);
    setCurrent({ event: next, durationMs: ms });
    if (soundRef.current) audioRef.current?.play(next.kind);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      currentRef.current = null;
      setCurrent(null);
      startNextRef.current();
    }, ms);
  };

  useEffect(() => {
    const audio = createDuelFeedbackAudio();
    audioRef.current = audio;
    audio.setMuted(!soundRef.current);
    audio.setVolume(volumeRef.current);

    const onGesture = (event: Event) => {
      if (!event.isTrusted) return;
      void audio.unlock().then((ok) => {
        if (!ok || audioRef.current !== audio) return;
        window.removeEventListener("pointerdown", onGesture, true);
        window.removeEventListener("keydown", onGesture, true);
      });
    };
    window.addEventListener("pointerdown", onGesture, true);
    window.addEventListener("keydown", onGesture, true);
    const onFxCue = (event: Event) => {
      const detail = (event as CustomEvent<DuelFxCueDetail>).detail;
      if (!detail || !soundRef.current) return;
      if (detail.cue === "battle") {
        if (detail.battle) audioRef.current?.playBattle(detail.battle);
        return;
      }
      audioRef.current?.play(detail.cue, detail.strength);
    };
    window.addEventListener(DUEL_FX_CUE_EVENT, onFxCue);

    return () => {
      window.removeEventListener(DUEL_FX_CUE_EVENT, onFxCue);
      window.removeEventListener("pointerdown", onGesture, true);
      window.removeEventListener("keydown", onGesture, true);
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      audio.dispose();
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    audioRef.current?.setMuted(!soundEnabled);
  }, [soundEnabled]);

  useEffect(() => {
    audioRef.current?.setVolume(soundVolume);
  }, [soundVolume]);

  useEffect(() => {
    const timers = holdTimersRef.current;
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      timers.clear();
      // A remount (React strict mode) reads the first events again, so a replayed opening is not lost.
      queueRef.current = [];
      currentRef.current = null;
      cursorRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (keyRef.current !== duelKey) {
      keyRef.current = duelKey;
      queueRef.current = [];
      cursorRef.current = null;
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      currentRef.current = null;
      setCurrent(null);
      for (const timer of holdTimersRef.current) window.clearTimeout(timer);
      holdTimersRef.current.clear();
      audioRef.current?.stopAll();
    }

    if (skipThrough != null) cursorRef.current = Math.max(cursorRef.current ?? skipThrough, skipThrough);
    if (cursorRef.current == null) {
      cursorRef.current = replayRef.current ?? maxEventId(events) ?? 0;
      if (replayRef.current == null) return;
    }

    const before = cursorRef.current;
    const { nextCursor, fresh } = collectFreshEvents(events, before);
    cursorRef.current = nextCursor;
    if (fresh.length === 0) return;
    const toasts: DuelEvent[] = [];
    const now = performance.now();
    // The phases of a turn start come one beat at a time, after the cards that come before them have landed.
    planPhaseBeats(events, before, { now, reduced: reducedRef.current, duelKey });
    // A sound waits for the moment its picture plays on the board.
    const playAfter = (kind: DuelEvent["kind"], waitMs: number) => {
      if (!soundRef.current) return;
      if (waitMs > 30) {
        const timer = window.setTimeout(() => {
          holdTimersRef.current.delete(timer);
          if (soundRef.current) audioRef.current?.play(kind);
        }, waitMs);
        holdTimersRef.current.add(timer);
      } else {
        audioRef.current?.play(kind);
      }
    };
    for (const event of fresh) {
      // The battle layer draws damage on the life points; MoveFx draws card movement and
      // PositionFx the turn or flip of a monster: none of them get a toast.
      if (event.kind === "battle" || event.kind === "battle-end" || event.kind === "damage" || event.kind === "move" || event.kind === "equip" || isPositionEvent(event)) continue;
      // When the board plays it: the chain beat of a chain event (ChainFx), or the moment a link's
      // own effect may start (chain-beats.ts). 0 when nothing holds it, as in the replay.
      const chainAt = Math.max(chainBeatAt(event.id), chainEffectAt(event.id));
      const chainMs = chainAt > 0 ? chainAt - now : 0;
      // A link resolving or resolved and the end of the chain are drawn on the board only (the badge
      // on its card), so they get no banner: just their quiet cue, at the moment of that beat.
      if (!hasCentreBanner(event.kind)) {
        playAfter(event.kind, chainMs);
        continue;
      }
      // A card flying onto the board is heard and announced when it lands, not when it leaves.
      const landAt = pairedMovePlan(event.id)?.landAt;
      // A card a fight destroyed is announced once the fight has landed its last strike.
      const battleAt = event.kind === "destroy" ? battleDestroyAt(event.zone, now) : 0;
      const beat = event.kind === "phase" ? getPhaseBeat(event.id) : null;
      const holdMs = Math.max(landAt != null ? landAt - now : 0, battleAt > 0 ? battleAt - now : 0, chainMs, beat ? beat.startAt - now : 0);
      if (isDrawnOnBoard(event, reducedRef.current)) {
        // SummonFx draws it on the zone; heavy, typed and destroy effects sound their own cues at their moment.
        if (!fxSoundsItself(event)) playAfter(event.kind, holdMs);
        continue;
      }
      if (holdMs > 30) {
        const timer = window.setTimeout(() => {
          holdTimersRef.current.delete(timer);
          queueRef.current.push(event);
          startNextRef.current();
        }, holdMs);
        holdTimersRef.current.add(timer);
        continue;
      }
      toasts.push(event);
    }
    if (toasts.length === 0) return;
    queueRef.current.push(...toasts);
    startNextRef.current();
  }, [duelKey, events, skipThrough]);

  return (
    <div
      className={styles.overlay}
      data-phase={current?.event.kind === "phase" ? "true" : "false"}
      role="status"
    >
      {current ? (
        <FeedbackCue
          key={current.event.id}
          event={current.event}
          reducedMotion={reducedMotion}
          durationMs={current.durationMs}
        />
      ) : null}
    </div>
  );
}
