"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { DuelCardInfo, DuelEvent } from "@yugidraft/shared/duels";
import { CardBack } from "./card-face";
import { cardArtUrl } from "./constants";
import {
  collectFreshEvents,
  DUEL_FX_CUE_EVENT,
  type DuelFxCueDetail,
  isDrawnOnBoard,
  isHeavySummon,
  maxEventId,
  pacedCueDuration,
} from "./event-queue";
import { createDuelFeedbackAudio, type DuelFeedbackAudio } from "./feedback-audio";
import styles from "./feedback.module.css";

export type DuelFeedbackProps = {
  events: readonly DuelEvent[];
  duelKey: string;
  soundEnabled: boolean;
  reducedMotion: boolean;
};

const KIND_LABEL: Record<DuelEvent["kind"], string> = {
  summon: "Summon",
  set: "Set",
  activate: "Activate",
  "chain-resolving": "Resolving",
  "chain-resolved": "Resolved",
  "chain-negated": "Negated",
  "chain-end": "Chain end",
  attack: "Attack",
  phase: "Phase",
  damage: "Damage",
  destroy: "Destroyed",
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
    return text || KIND_LABEL[event.kind];
  }
  return text || card.name || KIND_LABEL[event.kind];
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
  const enter = reducedMotion ? Math.min(140, durationMs * 0.3) : clampMs(durationMs * 0.34, 80, 260);
  const leave = reducedMotion ? Math.min(140, durationMs * 0.3) : clampMs(durationMs * 0.24, 70, 180);
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
  reducedMotion,
}: DuelFeedbackProps) {
  const [current, setCurrent] = useState<{ event: DuelEvent; durationMs: number } | null>(null);
  const currentRef = useRef<DuelEvent | null>(null);
  const queueRef = useRef<DuelEvent[]>([]);
  const cursorRef = useRef<number | null>(null);
  const keyRef = useRef(duelKey);
  const timerRef = useRef<number | null>(null);
  const audioRef = useRef<DuelFeedbackAudio | null>(null);
  const soundRef = useRef(soundEnabled);
  const reducedRef = useRef(reducedMotion);
  const startNextRef = useRef<() => void>(() => undefined);

  soundRef.current = soundEnabled;
  reducedRef.current = reducedMotion;
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
      audioRef.current?.stopAll();
    }

    if (cursorRef.current == null) {
      cursorRef.current = maxEventId(events) ?? 0;
      return;
    }

    const { nextCursor, fresh } = collectFreshEvents(events, cursorRef.current);
    cursorRef.current = nextCursor;
    if (fresh.length === 0) return;
    const toasts: DuelEvent[] = [];
    for (const event of fresh) {
      // The battle layer draws damage on the life points.
      if (event.kind === "damage") continue;
      if (isDrawnOnBoard(event, reducedRef.current)) {
        // SummonFx draws it on the zone; it also sounds the heavy and destroy cues at their moment.
        const fxSounds = event.kind === "destroy" || isHeavySummon(event);
        if (!fxSounds && soundRef.current) audioRef.current?.play(event.kind);
        continue;
      }
      toasts.push(event);
    }
    if (toasts.length === 0) return;
    queueRef.current.push(...toasts);
    startNextRef.current();
  }, [duelKey, events]);

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
