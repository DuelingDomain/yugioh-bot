"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DuelAnswer, DuelPromptOption } from "@yugidraft/shared/duels";
import { targetName } from "../card-interactions";
import { isAttackDuelistPrompt, isAttackTargetPrompt, optionsForKeys, optionZoneKeys, type PromptAim } from "../prompts";
import type { AimArrowProps, AimPointerSpot } from "./aim-arrow";
import { isOutOrLeaving } from "../multi-seat";
import { targetChoices } from "./targets";
import type { BattleAim, DuelActivateHandler, SeatPick, SeatTone, TableController, TableLayout } from "./types";

/**
 * The aim of an attack, on top of a controller.
 *
 * Pointer flow: after the attacker is declared, an arrow runs from it to the mouse cursor (`arrow`). A legal target
 * under the cursor (an opposing monster, or the whole board of a seat for a direct attack) lights up and the arrow
 * snaps to it. One click on it sends the answer at once. Esc or a right click cancels (the prompt panel does that).
 * Keyboard flow: hover or focus aims, Enter on a card or LP panel locks the aim, a second Enter, the Attack button
 * or the number keys send it; Esc lets go. While aimed or locked the camera does not move (`aiming`).
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
  /** Props of the pointer aim arrow, or null: no attack target is open, there is no mouse cursor, or an aim is locked. */
  arrow: AimArrowProps | null;
  confirm: () => void;
  cancel: () => void;
}

const sameTo = (a: BattleAim["to"] | null, b: BattleAim["to"] | null): boolean =>
  a === b || (a != null && b != null && (a.zones ?? []).join(" ") === (b.zones ?? []).join(" ") && (a.lpSeat ?? null) === (b.lpSeat ?? null));

/** The seat that a node of the table belongs to: its field mat, LP panel or seat slot. */
function seatOfNode(node: Element): number | null {
  const host = node.closest("[data-seat-field],[data-holo],[data-lp-seat],[data-seat-slot]");
  if (!host) return null;
  const raw = host.getAttribute("data-seat-field") ?? host.getAttribute("data-holo") ?? host.getAttribute("data-lp-seat") ?? host.getAttribute("data-seat-slot");
  const seat = raw == null ? NaN : Number(raw);
  return Number.isInteger(seat) ? seat : null;
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
  /** The prompt that a pointer click already answered: a second click on it must not send again. */
  const sentFor = useRef<string | null>(null);
  const pointer = useRef<AimPointerSpot | null>(null);
  const [hasMouse, setHasMouse] = useState(false);
  /** The last pointer was a finger: a tap has no hover, so a board is aimed by the first tap and sent by the second. */
  const touching = useRef(false);
  // A touch-only device (a coarse primary pointer) shows the tap words from the start; a pointer event then corrects it.
  const [touchMode, setTouchMode] = useState(() => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true);

  useEffect(() => {
    setLock(null);
    setHover(null);
    sentFor.current = null;
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
    const choices = targetChoices(prompt, engine, viewerSeat, nameOf).filter((choice) => choice.direct);
    if (choices.length === 0) return null;
    // Same rule as the prompt rows: a Leaving seat is not a direct-attack target while a living seat is offered.
    // (targetChoices keeps Leaving seats because card targets stay legal until the seat is out.)
    const living = choices.filter((choice) => !isOutOrLeaving(engine.seats.find((view) => view.seat === choice.seat)));
    const offered = living.length > 0 ? living : choices;
    return new Map<number, string>(offered.map((choice) => [choice.seat,
      prompt.options.find((option) => option.controller === choice.seat && option.location == null)!.id]));
  }, [base.seatPick, canAct, engine, nameOf, prompt, viewerSeat]);

  // A pointer-driven attack: the attacker is known and a target or a seat is to be chosen.
  const aimActive = attackTarget || (direct != null && (attackerKey != null || isAttackDuelistPrompt(prompt)));

  /** The legal target under a node: an opposing monster, or (direct attack) the board of a seat that can be hit. */
  const resolve = useCallback(
    (target: EventTarget | null): { optionId: string; to: NonNullable<BattleAim["to"]> } | null => {
      if (!(target instanceof Element)) return null;
      if (attackTarget) {
        const keys = target.closest("[data-zones]")?.getAttribute("data-zones")?.split(" ") ?? [];
        const key = keys.find((entry) => targets.has(entry));
        if (key) return { optionId: targets.get(key)!.id, to: { zones: [key] } };
      }
      if (direct) {
        const seat = seatOfNode(target);
        const optionId = seat != null ? direct.get(seat) : undefined;
        if (seat != null && optionId != null) return { optionId, to: { lpSeat: seat } };
      }
      return null;
    },
    [attackTarget, direct, targets],
  );
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;
  const hoverRef = useRef(hover);
  hoverRef.current = hover;

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

  // The mouse cursor drives the arrow: the board under it is the target, and one click on a legal target sends.
  const answerRef = useRef({ answerFor, onAnswer, busy: base.busy });
  answerRef.current = { answerFor, onAnswer, busy: base.busy };
  const suspendedNow = options.suspended === true;
  const suspendedFlag = useRef(suspendedNow);
  suspendedFlag.current = suspendedNow;
  useEffect(() => {
    if (!aimActive) {
      pointer.current = null;
      setHasMouse(false);
      return;
    }
    const onDown = (event: PointerEvent) => {
      touching.current = event.pointerType === "touch";
      setTouchMode(touching.current);
      if (touching.current) {
        pointer.current = null;
        setHasMouse(false);
      }
    };
    const onMove = (event: PointerEvent) => {
      touching.current = event.pointerType === "touch";
      setTouchMode(touching.current);
      if (touching.current) {
        pointer.current = null;
        setHasMouse(false);
        return;
      }
      pointer.current = { x: event.clientX, y: event.clientY };
      setHasMouse(true);
      if (liveRef.current) return;
      const hit = resolveRef.current(event.target);
      setHover((current) => (sameTo(current, hit?.to ?? null) ? current : (hit?.to ?? null)));
    };
    const onClick = (event: MouseEvent) => {
      // Only a pointer click: Enter or Space on a focused card (detail 0) keeps the lock-then-confirm flow.
      if (event.detail === 0 || event.button !== 0 || suspendedFlag.current || sentFor.current === promptId) return;
      const hit = resolveRef.current(event.target);
      if (touching.current) {
        // A finger on a card keeps the lock-then-confirm flow of the card itself. A finger on a board (a direct attack)
        // aims at it with the first tap, which lights it and shows the label, and sends with the second tap.
        if (!hit || hit.to.lpSeat == null) {
          if (!hit) setHover(null);
          return;
        }
        if (!sameTo(hoverRef.current, hit.to)) {
          event.preventDefault();
          event.stopPropagation();
          setHover(hit.to);
          return;
        }
      }
      if (!hit) return;
      event.preventDefault();
      event.stopPropagation();
      if (answerRef.current.busy) return;
      sentFor.current = promptId;
      setLock(null);
      setHover(null);
      answerRef.current.onAnswer(answerRef.current.answerFor(hit.optionId));
    };
    window.addEventListener("pointerdown", onDown, { capture: true, passive: true });
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("click", onClick, true);
    };
  }, [aimActive, promptId]);

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

  const arrow = useMemo<AimArrowProps | null>(() => {
    if (!aimActive || !attackerKey || live) return null;
    const toneOf = (seat: number | null) => (seat == null ? null : (layout.slots.find((slot) => slot.seat === seat)?.tone ?? null));
    const attackerSeat = Number(attackerKey.split(":")[0]);
    let label: string | null = null;
    let targetSeat: number | null = null;
    if (hover?.lpSeat != null && !hover.zones?.length) {
      label = `Direct attack: ${nameOf(hover.lpSeat)}`;
      targetSeat = hover.lpSeat;
    } else if (hover?.zones?.[0]) {
      const option = targets.get(hover.zones[0]);
      label = option ? `Attack: ${targetName(option)}` : null;
      targetSeat = Number(hover.zones[0].split(":")[0]);
    }
    // No mouse (a finger): the arrow shows only once a tap aimed at a target, and then runs to that target.
    if (!hasMouse && !label) return null;
    return {
      fromKey: attackerKey,
      tone: toneOf(attackerSeat) ?? "violet",
      targetTone: toneOf(targetSeat),
      pointer,
      snap: label ? hover : null,
      label,
    };
  }, [aimActive, attackerKey, hasMouse, hover, layout.slots, live, nameOf, targets]);

  const bar = useMemo<AimBar | null>(() => {
    const toneOf = (seat: number) => layout.slots.find((slot) => slot.seat === seat)?.tone ?? "ice";
    if (attackTarget && live?.to.zones?.length) return { kind: "confirm", title: "Attack target", entries: [], targetLabel: `Attack ${live.label}?` };
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
      // Esc only where the engine lets the pick be cancelled: a forced attack has no way back.
      hint: touchMode ? "Tap a target, then tap again to attack." : prompt?.cancelable ? "Click a target to attack. Esc to cancel." : "Click a target to attack.",
      lockedId: live?.optionId ?? null,
      onAim: (option) => {
        const [key] = optionZoneKeys(option);
        const to = key ? { zones: [key] } : option.controller != null && direct?.get(option.controller) === option.id ? { lpSeat: option.controller } : null;
        if (!to) return;
        if (live?.optionId === option.id) confirm();
        else lockTo(option.id, to, option.label);
      },
      onHover: (option) => {
        if (live) return;
        const [key] = option ? optionZoneKeys(option) : [];
        setHover(key ? { zones: [key] } : option?.controller != null && direct?.get(option.controller) === option.id ? { lpSeat: option.controller } : null);
      },
    };
  }, [attackTarget, confirm, direct, live, lockTo, prompt?.cancelable, touchMode]);

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
    arrow,
    pointed: live ? { zoneKey: live.to.zones?.[0] ?? null, lpSeat: live.to.lpSeat ?? null, label: live.label, optionId: live.optionId } : null,
    confirm,
    cancel,
  };
}
