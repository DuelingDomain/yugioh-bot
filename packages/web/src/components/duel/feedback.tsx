"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { DuelCardInfo, DuelEvent } from "@yugidraft/shared/duels";
import { CardBack } from "./card-face";
import { cardArtUrl } from "./constants";
import {
  collectFreshEvents,
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

function FeedbackCue({
  event,
  reducedMotion,
  durationMs,
}: {
  event: DuelEvent;
  reducedMotion: boolean;
  durationMs: number;
}) {
  if (event.kind === "phase") {
    const title = event.text.trim() || KIND_LABEL.phase;
    return (
      <div
        className={styles.phaseRibbon}
        data-kind="phase"
        data-reduced={reducedMotion ? "true" : "false"}
        style={reducedMotion ? undefined : ({ "--cue-in": `${Math.min(280, durationMs)}ms` } as CSSProperties)}
      >
        <p className={styles.phaseTitle}>{title}</p>
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
      data-reduced={reducedMotion ? "true" : "false"}
      style={reducedMotion ? undefined : ({ "--cue-in": `${Math.min(280, durationMs)}ms` } as CSSProperties)}
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

    return () => {
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
    queueRef.current.push(...fresh);
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
          event={current.event}
          reducedMotion={reducedMotion}
          durationMs={current.durationMs}
        />
      ) : null}
    </div>
  );
}
