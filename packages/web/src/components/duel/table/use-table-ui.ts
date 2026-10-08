"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DuelAnswer, DuelCard } from "@yugidraft/shared/duels";
import { zoneKey } from "../constants";
import { activatePromptFromField, isAttackDuelistPrompt, isDirectAttackPrompt, isAttackTargetPrompt, optionsForCard } from "../prompts";
import { livePileCards, shouldClosePileForPrompt, type PileView } from "../pile-focus";
import type { CardMenuState } from "../card-interactions";
import { promptLegalKeys } from "../prompts";
import { DEFAULT_SIDE_PANE, type SidePane } from "../side-panel";
import { aimPromptFor, attackAimOf, isAttackStepPrompt, queuedAnswer, type AttackAim, type AttackAimTarget, type AttackTargets } from "./attack-aim";
import type { BattleAim, DuelActivateHandler, InspectTarget, TableController } from "./types";

/**
 * The interaction state of a table that the room keeps in its own component: the card action menu, the hover
 * card, the pile viewer, the inspector target and the declared attacker. It wraps a controller, so TableStage and the
 * aim flow see menu-aware handlers. Pure helpers (pile contents, attack confirm side) are shared with room.tsx.
 */

export interface TableUi {
  /** The base controller with menu-aware activate, pile-aware inspect, hover and the declared attacker. */
  controller: TableController;
  menu: CardMenuState | null;
  closeMenu: () => void;
  hover: { card: DuelCard; anchor: HTMLElement } | null;
  pile: PileView | null;
  closePile: () => void;
  inspect: InspectTarget | null;
  setInspect: (target: InspectTarget | null) => void;
  pane: SidePane;
  setPane: (pane: SidePane) => void;
  /**
   * The wide table's drawer (rail on the left, panels beside the board). Inspecting a card on purpose (a click that is
   * no move, the menu's Inspect, a history tile, a pile card) opens it; a hover never does. Tables without a drawer ignore it.
   */
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  /** A menu or the pile viewer is open: the table keys wait. */
  suspended: boolean;
  /** Zone key of the declared attacker, while its target is chosen. */
  attackerKey: string | null;
  /** Opens a card in the Card tab (a history row, a pile card, a chain link). */
  inspectCard: (target: InspectTarget) => void;
}

export interface TableUiOptions {
  initialPane?: SidePane;
  /**
   * The floating HUD replaces the side panes. A hover then never sets the inspector (the hover preview shows the card),
   * and a card opens the Card flyout (`onOpenCard`) only on Inspect. A click that no prompt took pins the card in the
   * hover preview (`onPinCard`) instead; any other click on a zone lets the pin go (`onPinCard(null)`).
   */
  hud?: boolean;
  onOpenCard?: () => void;
  onPinCard?: (card: DuelCard | null, anchor?: HTMLElement | null) => void;
}

export function useTableUi(base: TableController, options: TableUiOptions = {}): TableUi {
  const { hud = false, onOpenCard, onPinCard } = options;
  const { engine, prompt, viewerSeat, canAct, busy, draft, onAnswer } = base;
  const [menu, setMenu] = useState<CardMenuState | null>(null);
  const [hover, setHover] = useState<{ card: DuelCard; anchor: HTMLElement } | null>(null);
  const [pile, setPile] = useState<PileView | null>(null);
  const [inspect, setInspect] = useState<InspectTarget | null>(null);
  const [pane, setPane] = useState<SidePane>(options.initialPane ?? DEFAULT_SIDE_PANE);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pendingAttack, setPendingAttack] = useState<{ key: string; direct: boolean } | null>(null);
  // The attacker the player clicked, before the attack is sent: the aim comes first, the target click sends (attack-aim.ts).
  const [aimFirst, setAimFirst] = useState<{ promptId: string; revision: number; key: string; optionId: string; direct: boolean; targets: AttackTargets | null } | null>(null);
  // The target the player clicked, until the core's own target step has taken it (or showed that it cannot).
  // `revision` is the revision the next attack step must have: the sent one + 1, and one more after a "No" to "Attack directly?".
  const [queued, setQueued] = useState<{ fromPrompt: string; target: AttackAimTarget; revision: number; directSeats: number[] | null } | null>(null);
  const queuedSent = useRef<string | null>(null);

  const promptId = prompt?.id ?? null;
  const revision = engine.revision;
  const activeMenu = canAct && !busy && menu?.promptId === promptId && menu?.revision === revision ? menu : null;
  const aimingFirst = canAct && !busy && aimFirst?.promptId === promptId && aimFirst.revision === revision ? aimFirst : null;

  // A new prompt or revision drops the menu and the hover card.
  useEffect(() => {
    setMenu(null);
    setHover(null);
    setAimFirst(null);
  }, [promptId, revision]);
  // A new prompt for this seat lets the pinned peek go: it must not cover the cards the prompt asks for.
  const promptSeat = prompt?.seat ?? null;
  useEffect(() => {
    if (hud && promptId != null && viewerSeat != null && promptSeat === viewerSeat) onPinCard?.(null);
    // Only a new prompt decides this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptId]);
  // The declared attacker belongs to the attack steps only: the duelist pick (a direct attack) and the target pick.
  useEffect(() => {
    if (!prompt || !(isAttackTargetPrompt(prompt, true) || isAttackDuelistPrompt(prompt) || isDirectAttackPrompt(prompt))) setPendingAttack(null);
  }, [prompt]);

  // The target the player clicked answers the core's own attack steps (duelist pick, "Attack directly?", target pick) when they
  // offer it. A step that does not offer it, or any other prompt, drops it: the player then aims on the real prompt.
  useEffect(() => {
    if (!queued || !prompt || prompt.id === queued.fromPrompt) return;
    // The step already answered stays as it is until the next prompt comes.
    if (queuedSent.current === prompt.id) return;
    // A prompt from any other revision (a replay, a later turn step) is not the step that follows the sent attack.
    if (revision !== queued.revision) {
      setQueued(null);
      return;
    }
    if (viewerSeat == null || prompt.seat !== viewerSeat || !isAttackStepPrompt(prompt)) {
      setQueued(null);
      return;
    }
    if (!canAct || busy) return;
    const answer = queuedAnswer(prompt, queued.target, queued.directSeats);
    if (!answer) {
      setQueued(null);
      return;
    }
    queuedSent.current = prompt.id;
    // "No" to "Attack directly?" still has the monster pick behind it, one revision later.
    if (isDirectAttackPrompt(prompt) && answer.choice === "no") setQueued({ ...queued, revision: queued.revision + 1 });
    else setQueued(null);
    onAnswer(answer);
  }, [busy, canAct, onAnswer, prompt, queued, revision, viewerSeat]);

  // Set when an answer is sent; the next prompt (or the wait for one) then decides whether an open pile viewer stays.
  const pileAnswered = useRef(false);

  // A new prompt that wants cards outside the open pile must not stay hidden behind the pile's scrim. An answer sent
  // while the viewer was open (an Extra Deck summon) closes it too, unless the next prompt wants a card in the pile.
  useEffect(() => {
    const answered = pileAnswered.current;
    pileAnswered.current = false;
    if (!prompt) {
      // Answered and now waiting (no prompt yet): let the player watch the board, not the pile.
      if (answered) setPile((current) => (current?.open ? { ...current, open: false } : current));
      return;
    }
    // The prompt's seat, not `canAct`: the live controller is busy while the answer is in flight, and the next prompt
    // usually arrives before that flag clears. Judging it by `canAct` would leave the pile over the materials.
    const promptMine = viewerSeat != null && prompt.seat === viewerSeat;
    setPile((current) => {
      if (!current?.open) return current;
      const cards = livePileCards(current, engine, viewerSeat);
      return shouldClosePileForPrompt(cards, promptLegalKeys(prompt), promptMine, answered) ? { ...current, open: false } : current;
    });
    // Only a new prompt decides this; later revisions of the same prompt must not close a pile the player opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptId]);

  const closeMenu = useCallback(() => setMenu(null), []);
  const closePile = useCallback(() => setPile((current) => (current ? { ...current, open: false } : null)), []);

  const showInspector = useCallback(
    (target: InspectTarget, reveal = false, openDrawer = reveal) => {
      if (target.type === "pile") {
        // Piles open in the centred viewer over the board. The owner is the controller of the pile's cards.
        const first = target.cards[0];
        const local = viewerSeat ?? 0;
        const owner: "you" | "opp" = first ? (first.controller === local && viewerSeat != null ? "you" : "opp") : "opp";
        setHover(null);
        if (hud) onPinCard?.(null);
        setPile({ title: target.title, owner, cards: target.cards, open: true, seat: first?.controller });
        return;
      }
      setInspect(target);
      if (hud) onOpenCard?.();
      else {
        // A deliberate inspect (it opens the drawer) shows the Card pane, even when the drawer was last on the Log or Settings.
        if (reveal || openDrawer || pane !== "log") setPane("card");
        if (openDrawer) setDrawerOpen(true);
      }
    },
    [hud, onOpenCard, onPinCard, pane, viewerSeat],
  );

  const onInspect = useCallback<TableController["onInspect"]>((target) => showInspector(target, false, true), [showInspector]);
  const inspectCard = useCallback((target: InspectTarget) => showInspector(target, true), [showInspector]);

  const onHoverCard = useCallback<NonNullable<TableController["onHoverCard"]>>(
    (card, anchor) => {
      base.onHoverCard?.(card, anchor);
      if (!card || !anchor || card.code == null) {
        setHover(null);
        return;
      }
      setHover({ card, anchor });
      if (pane === "card" && !hud) setInspect({ type: "card", card });
    },
    [base, hud, pane],
  );

  const mine = prompt != null && viewerSeat != null && prompt.seat === viewerSeat;
  const submit = useCallback(
    (answer: DuelAnswer) => {
      // A declared attack does not go out yet: the player aims first, and the target click sends it (attack-aim.ts).
      const declared = attackAimOf(prompt, answer);
      if (declared && prompt && canAct && !busy && aimPromptFor(prompt, engine, viewerSeat, declared.direct, declared.targets).options.length > 0) {
        setMenu(null);
        setAimFirst({ promptId: prompt.id, revision, ...declared });
        return;
      }
      // An answer from the pile viewer leaves it open until the next prompt shows whether it is still needed.
      if (canAct && !busy && prompt && pile?.open) pileAnswered.current = true;
      // Remember the declared attacker so the target step can draw the arrow from it.
      const attack =
        prompt?.context?.type === "action" && answer.choice?.startsWith("attack:")
          ? prompt.options.find((option) => option.id === answer.choice)
          : undefined;
      if (attack) {
        setPendingAttack(
          attack.controller != null && attack.location != null && attack.sequence != null
            ? { key: zoneKey(attack.controller, attack.location, attack.sequence), direct: /directly/i.test(attack.label) }
            : null,
        );
      } else if (!isDirectAttackPrompt(prompt)) {
        setPendingAttack(null);
      }
      onAnswer(answer);
    },
    [busy, canAct, engine, onAnswer, pile?.open, prompt, revision, viewerSeat],
  );

  const sendAim = useCallback(
    (target: AttackAimTarget) => {
      if (!aimingFirst) return;
      setAimFirst(null);
      setQueued({ fromPrompt: aimingFirst.promptId, target, revision: aimingFirst.revision + 1, directSeats: aimingFirst.targets?.direct ?? null });
      setPendingAttack({ key: aimingFirst.key, direct: aimingFirst.direct });
      onAnswer({ choice: aimingFirst.optionId });
    },
    [aimingFirst, onAnswer],
  );
  const cancelAim = useCallback(() => setAimFirst(null), []);
  const attackAim = useMemo<AttackAim | null>(
    () => (aimingFirst ? { key: aimingFirst.key, optionId: aimingFirst.optionId, direct: aimingFirst.direct, targets: aimingFirst.targets, send: sendAim, cancel: cancelAim } : null),
    [aimingFirst, cancelAim, sendAim],
  );

  /** A click no prompt took, in the HUD: the card is pinned in the hover preview (the Card flyout stays shut). */
  const pinClicked = useCallback(
    (card: DuelCard, anchor: HTMLElement) => {
      if (!onPinCard) {
        showInspector({ type: "card", card });
        return;
      }
      setInspect({ type: "card", card });
      onPinCard(card, anchor);
    },
    [onPinCard, showInspector],
  );

  const onActivate = useCallback<DuelActivateHandler>(
    (keys, card, anchor, preserveInspector = false) => {
      setHover(null);
      // The pin goes with any click on a zone; the end of this handler pins the card again when no prompt took the click.
      // A click from the Card flyout or the pile viewer (`preserveInspector`) leaves the flyout and the pin as they are.
      if (hud && !preserveInspector) onPinCard?.(null);
      // The HUD keeps the Card flyout shut while a click is a prompt pick or opens a card menu: see the end.
      // A click on a card that offers a move is the start of that move: the drawer stays as it is. Any other click inspects.
      if (card && !hud) showInspector({ type: "card", card }, false, !(canAct && mine && keys.some((key) => base.legalKeys.has(key))));
      base.onActivate(keys, card, anchor);
      if (busy || !canAct || !prompt) {
        if (card && hud) { if (preserveInspector) showInspector({ type: "card", card }, true); else pinClicked(card, anchor); }
        return;
      }
      if (mine && (prompt.kind === "choice" || prompt.kind === "toggle")) {
        const options = optionsForCard(prompt, card, keys);
        if (prompt.kind === "toggle" && options.length === 1) {
          submit({ choice: options[0].id });
          return;
        }
        // A monster whose only move is to attack starts the aim at once: the arrow runs from it and the next click is the
        // target, which sends the attack (submit holds it back until then). Its menu would have one item.
        if (prompt.context?.type === "action" && options.length === 1 && options[0].id.startsWith("attack:")) {
          setMenu(null);
          submit({ choice: options[0].id });
          return;
        }
        if (options.length) {
          setMenu({
            anchor,
            title: card?.name ?? "Card",
            card,
            options,
            promptId: prompt.id,
            revision,
            tone: prompt.context?.type === "chain" ? "chain" : "action",
          });
          return;
        }
      }
      setMenu(null);
      const handled = activatePromptFromField(prompt, mine, keys, card, draft, submit);
      if (card && hud && !handled) { if (preserveInspector) showInspector({ type: "card", card }, true); else pinClicked(card, anchor); }
    },
    [base, busy, canAct, draft, hud, mine, onPinCard, pinClicked, prompt, revision, showInspector, submit],
  );

  const attackerKey = aimingFirst?.key ?? pendingAttack?.key ?? base.aim?.from ?? null;

  // The arrow the player is steering: only the declared attacker waiting for a target. A menu never draws one: the
  // arrow starts after the player clicks Attack, and the player picks the target.
  const aim = useMemo<BattleAim | null>(() => {
    if (base.aim) return base.aim;
    if (aimingFirst) return { mode: "aim", from: aimingFirst.key, to: {} };
    if (pendingAttack) return { mode: "aim", from: pendingAttack.key, to: {} };
    return null;
  }, [aimingFirst, base.aim, pendingAttack]);

  const controller = useMemo<TableController>(
    () => ({ ...base, aim, attackAim, onAnswer: submit, onActivate, onInspect, onHoverCard }),
    [aim, attackAim, base, onActivate, onHoverCard, onInspect, submit],
  );

  return {
    controller,
    menu: activeMenu,
    closeMenu,
    hover,
    pile,
    closePile,
    inspect,
    setInspect,
    pane,
    setPane,
    drawerOpen,
    setDrawerOpen,
    suspended: activeMenu != null || pile?.open === true,
    attackerKey,
    inspectCard,
  };
}

export type { CardMenuState, PileView };
