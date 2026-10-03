"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DuelAnswer, DuelPromptOption } from "@yugidraft/shared/duels";
import { isAttackTargetPrompt, optionsForKeys, optionZoneKeys, type PromptAim } from "../prompts";
import { targetChoices } from "./targets";
import type { BattleAim, DuelActivateHandler, SeatPick, SeatTone, TableController, TableLayout } from "./types";

/**
 * The aim of an attack, on top of a controller.
 *
 * Hover on a legal target (a card, or a holo LP panel) aims; a click locks the aim; a second click, Enter or the
 * Attack button sends the answer; Esc lets go. While aimed or locked the camera does not move (`aiming`).
 * A direct attack (a choice with a seat and no zone) works the same through a seat pick on the LP panels.
 * A room that owns its own aim state leaves this hook out and passes its controller to the stage as is.
 */

export interface AimBarEntry {
  seat: number;
  name: string;
  tone: SeatTone;
  hotkey: number;
  locked: boolean;
}
export interface AimBar {
  kind: "direct" | "confirm";
  title: string;
  entries: AimBarEntry[];
  targetLabel?: string;
}

interface Lock {
  promptId: string;
  optionId: string;
  to: NonNullable<BattleAim["to"]>;
  label: string;
}

export interface AimFlow {
  controller: TableController;
  /** An aim exists, or an attack target is being chosen: the camera stays where it is. */
  aiming: boolean;
  locked: boolean;
  bar: AimBar | null;
  /** The attack-target step of the prompt panel: a pick aims instead of answering. Null off that step. */
  promptAim: PromptAim | null;
  /** A pick of a seat is up: the number keys belong to it, not to the camera. */
  seatKeys: boolean;
  /** The target the player pointed at and has not sent yet: a card (zone key) or a seat's LP panel. Null when none. */
  pointed: { zoneKey: string | null; lpSeat: number | null; label: string; optionId: string } | null;
  confirm: () => void;
  cancel: () => void;
}

const isTyping = (target: EventTarget | null): boolean => {
  const node = target as HTMLElement | null;
  if (!node || typeof node.tagName !== "string") return false;
  return node.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(node.tagName);
};

export interface AimFlowOptions {
  /** A menu or the pile viewer is open: Enter, Esc and the number keys leave the aim alone. */
  suspended?: boolean;
}

export function useAimFlow(base: TableController, layout: TableLayout, root: { current: HTMLElement | null }, options: AimFlowOptions = {}): AimFlow {
  const { prompt, engine, viewerSeat, canAct, nameOf, onAnswer } = base;
  const promptId = prompt?.id ?? null;
  const attackerKey = base.aim?.from ?? null;
  const attackTarget = canAct && isAttackTargetPrompt(prompt, attackerKey != null);

  const [lock, setLock] = useState<Lock | null>(null);
  const [hover, setHover] = useState<BattleAim["to"] | null>(null);
  const live = lock && lock.promptId === promptId ? lock : null;

  useEffect(() => {
    setLock(null);
    setHover(null);
  }, [promptId, engine.revision]);

  const targets = useMemo(() => {
    const map = new Map<string, DuelPromptOption>();
    if (!attackTarget || !prompt) return map;
    for (const option of prompt.options) {
      const [key] = optionZoneKeys(option);
      if (key) map.set(key, option);
    }
    return map;
  }, [attackTarget, prompt]);

  const answerFor = useCallback(
    (optionId: string): DuelAnswer => (prompt?.kind === "choice" ? { choice: optionId } : { selected: [optionId] }),
    [prompt?.kind],
  );

  // Direct attack: a choice that names a seat and no zone, with no opponent pick behind it.
  const direct = useMemo(() => {
    if (!canAct || !prompt || prompt.kind !== "choice" || base.seatPick) return null;
    const choices = targetChoices(prompt, engine, viewerSeat, nameOf).filter((choice) => choice.direct && choice.zones.length === 0);
    if (choices.length === 0) return null;
    return new Map<number, string>(choices.map((choice) => [choice.seat, choice.optionIds[0]]));
  }, [base.seatPick, canAct, engine, nameOf, prompt, viewerSeat]);

  const confirm = useCallback(() => {
    if (!live) return;
    setLock(null);
    onAnswer(answerFor(live.optionId));
  }, [answerFor, live, onAnswer]);
  const cancel = useCallback(() => setLock(null), []);

  const lockTo = useCallback(
    (optionId: string, to: NonNullable<BattleAim["to"]>, label: string) => {
      if (!promptId) return;
      setHover(null);
      setLock({ promptId, optionId, to, label });
    },
    [promptId],
  );

  const seatPick = useMemo<SeatPick | null>(() => {
    if (direct) {
      return {
        options: direct,
        onPick: (seat) => {
          const optionId = direct.get(seat);
          if (optionId == null) return;
          if (live?.to.lpSeat === seat) confirm();
          else lockTo(optionId, { lpSeat: seat }, nameOf(seat));
        },
      };
    }
    return base.seatPick;
  }, [base.seatPick, confirm, direct, live?.to.lpSeat, lockTo, nameOf]);

  const onActivate = useCallback<DuelActivateHandler>(
    (keys, card, anchor) => {
      if (attackTarget && prompt) {
        const options = optionsForKeys(prompt, keys);
        if (options.length === 1) {
          const [option] = options;
          const [key] = optionZoneKeys(option);
          if (live?.optionId === option.id) confirm();
          else lockTo(option.id, { zones: [key] }, option.label);
          return;
        }
      }
      base.onActivate(keys, card, anchor);
    },
    [attackTarget, base, confirm, live?.optionId, lockTo, prompt],
  );

  const onAim = useCallback(
    (to: BattleAim["to"] | null) => {
      if (live) return;
      setHover(to);
    },
    [live],
  );

  // Hovering or focusing a legal card aims at it. Panels report their own hover through `onAim`.
  useEffect(() => {
    if (!attackTarget || live) return;
    const scope: Document | HTMLElement = root.current ?? document;
    const keyOf = (target: EventTarget | null): string | null => {
      const zone = target instanceof Element ? target.closest("[data-zones]") : null;
      const keys = zone?.getAttribute("data-zones")?.split(" ") ?? [];
      return keys.find((key) => targets.has(key)) ?? null;
    };
    const enter = (event: Event) => {
      const key = keyOf(event.target);
      if (key) setHover({ zones: [key] });
    };
    const leave = (event: Event) => {
      if (keyOf(event.target) && keyOf((event as PointerEvent | FocusEvent).relatedTarget) == null) setHover(null);
    };
    scope.addEventListener("pointerover", enter);
    scope.addEventListener("pointerout", leave);
    scope.addEventListener("focusin", enter);
    scope.addEventListener("focusout", leave);
    return () => {
      scope.removeEventListener("pointerover", enter);
      scope.removeEventListener("pointerout", leave);
      scope.removeEventListener("focusin", enter);
      scope.removeEventListener("focusout", leave);
    };
  }, [attackTarget, live, root, targets]);

  const pickable = useMemo(() => [...(seatPick?.options.keys() ?? [])], [seatPick]);
  const rivalOrder = useMemo(
    () => layout.slots.map((slot) => slot.seat).filter((seat) => pickable.includes(seat)),
    [layout.slots, pickable],
  );

  // Keys: 1..n pick the nth rival, Enter sends a locked aim, Esc lets go.
  const pickRef = useRef(seatPick);
  const orderRef = useRef(rivalOrder);
  const liveRef = useRef(live);
  const suspendedRef = useRef(options.suspended === true);
  pickRef.current = seatPick;
  orderRef.current = rivalOrder;
  liveRef.current = live;
  suspendedRef.current = options.suspended === true;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target) || suspendedRef.current) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('[role="dialog"][aria-modal="true"]') || document.querySelector('[aria-modal="true"]')) return;
      if (/^[1-9]$/.test(event.key) && pickRef.current) {
        const seat = orderRef.current[Number(event.key) - 1];
        if (seat != null) {
          event.preventDefault();
          pickRef.current.onPick(seat);
        }
        return;
      }
      if (event.key === "Escape" && liveRef.current) {
        event.preventDefault();
        setLock(null);
      } else if (event.key === "Enter" && liveRef.current && !(target?.closest && target.closest("button,a,summary"))) {
        event.preventDefault();
        confirm();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirm]);

  const aim = useMemo<BattleAim | null>(() => {
    if (live) return { mode: "locked", from: attackerKey, to: live.to };
    if (hover) return { mode: "aim", from: attackerKey, to: hover };
    return base.aim;
  }, [attackerKey, base.aim, hover, live]);

  const bar = useMemo<AimBar | null>(() => {
    const toneOf = (seat: number) => layout.slots.find((slot) => slot.seat === seat)?.tone ?? "ice";
    if (direct) {
      return {
        kind: "direct",
        title: prompt?.title ?? "Select a duelist to attack",
        entries: rivalOrder.map((seat, index) => ({
          seat,
          name: nameOf(seat),
          tone: toneOf(seat),
          hotkey: index + 1,
          locked: live?.to.lpSeat === seat,
        })),
      };
    }
    if (attackTarget && live) return { kind: "confirm", title: "Attack target", entries: [], targetLabel: `Attack ${live.label}?` };
    return null;
  }, [attackTarget, direct, layout.slots, live, nameOf, prompt?.title, rivalOrder]);

  const promptAim = useMemo<PromptAim | null>(() => {
    if (!attackTarget) return null;
    return {
      lockedId: live?.optionId ?? null,
      onAim: (option) => {
        const [key] = optionZoneKeys(option);
        if (!key) return;
        if (live?.optionId === option.id) confirm();
        else lockTo(option.id, { zones: [key] }, option.label);
      },
      onHover: (option) => {
        if (live) return;
        const [key] = option ? optionZoneKeys(option) : [];
        setHover(key ? { zones: [key] } : null);
      },
    };
  }, [attackTarget, confirm, live, lockTo]);

  const controller = useMemo<TableController>(
    () => ({ ...base, aim, seatPick, onActivate, onAim }),
    [aim, base, onActivate, onAim, seatPick],
  );

  return {
    controller,
    aiming: aim != null || attackTarget,
    locked: live != null,
    bar,
    promptAim,
    seatKeys: seatPick != null,
    pointed: live ? { zoneKey: live.to.zones?.[0] ?? null, lpSeat: live.to.lpSeat ?? null, label: live.label, optionId: live.optionId } : null,
    confirm,
    cancel,
  };
}
