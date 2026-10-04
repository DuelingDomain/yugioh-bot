"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DuelAnswer, DuelCard, DuelPromptOption } from "@yugidraft/shared/duels";
import { zoneKey } from "../constants";
import { activatePromptFromField, isAttackDuelistPrompt, isDirectAttackPrompt, isAttackTargetPrompt, optionsForCard } from "../prompts";
import { livePileCards, shouldClosePileForPrompt, type PileView } from "../pile-focus";
import type { CardMenuState } from "../card-interactions";
import { promptLegalKeys } from "../prompts";
import { DEFAULT_SIDE_PANE, type SidePane } from "../side-panel";
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
  onMenuOptionHover: (option: DuelPromptOption | null) => void;
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

export function useTableUi(base: TableController): TableUi {
  const { engine, prompt, viewerSeat, canAct, busy, draft, onAnswer } = base;
  const [menu, setMenu] = useState<CardMenuState | null>(null);
  const [hover, setHover] = useState<{ card: DuelCard; anchor: HTMLElement } | null>(null);
  const [pile, setPile] = useState<PileView | null>(null);
  const [inspect, setInspect] = useState<InspectTarget | null>(null);
  const [pane, setPane] = useState<SidePane>(DEFAULT_SIDE_PANE);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pendingAttack, setPendingAttack] = useState<{ key: string; direct: boolean } | null>(null);
  const [preview, setPreview] = useState<{ from: string; direct: boolean } | null>(null);

  const promptId = prompt?.id ?? null;
  const revision = engine.revision;
  const activeMenu = canAct && !busy && menu?.promptId === promptId && menu?.revision === revision ? menu : null;

  // A new prompt or revision drops the menu and the hover card.
  useEffect(() => {
    setMenu(null);
    setHover(null);
  }, [promptId, revision]);
  useEffect(() => {
    if (!activeMenu) setPreview(null);
  }, [activeMenu]);
  // The declared attacker belongs to the attack steps only: the duelist pick (a direct attack) and the target pick.
  useEffect(() => {
    if (!prompt || !(isAttackTargetPrompt(prompt, true) || isAttackDuelistPrompt(prompt) || isDirectAttackPrompt(prompt))) setPendingAttack(null);
  }, [prompt]);

  // A new prompt that wants cards outside the open pile must not stay hidden behind the pile's scrim.
  useEffect(() => {
    if (!prompt) return;
    setPile((current) => {
      if (!current?.open) return current;
      const cards = livePileCards(current, engine, viewerSeat);
      return shouldClosePileForPrompt(cards, promptLegalKeys(prompt), canAct, false) ? { ...current, open: false } : current;
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
        setPile({ title: target.title, owner, cards: target.cards, open: true, seat: first?.controller });
        return;
      }
      setInspect(target);
      if (reveal || pane !== "log") setPane("card");
      if (openDrawer) setDrawerOpen(true);
    },
    [pane, viewerSeat],
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
      if (pane === "card") setInspect({ type: "card", card });
    },
    [base, pane],
  );

  const mine = prompt != null && viewerSeat != null && prompt.seat === viewerSeat;
  const submit = useCallback(
    (answer: DuelAnswer) => {
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
    [onAnswer, prompt],
  );

  const onActivate = useCallback<DuelActivateHandler>(
    (keys, card, anchor) => {
      setHover(null);
      // A click on a card that offers a move is the start of that move: the drawer stays as it is. Any other click inspects.
      if (card) showInspector({ type: "card", card }, false, !(canAct && mine && keys.some((key) => base.legalKeys.has(key))));
      base.onActivate(keys, card, anchor);
      if (busy || !canAct || !prompt) return;
      if (mine && (prompt.kind === "choice" || prompt.kind === "toggle")) {
        const options = optionsForCard(prompt, card, keys);
        if (prompt.kind === "toggle" && options.length === 1) {
          submit({ choice: options[0].id });
          return;
        }
        // A monster whose only move is to attack with a card pick to follow declares the attack at once: the arrow starts
        // from it and the next click is the target. A direct attack never does: the engine may then start the hit with
        // no further prompt, or ask a duelist pick that cannot be cancelled. Its menu stays, so the click is a choice.
        if (
          prompt.context?.type === "action" &&
          options.length === 1 &&
          options[0].id.startsWith("attack:") &&
          !/directly/i.test(options[0].label)
        ) {
          setMenu(null);
          submit({ choice: options[0].id });
          return;
        }
        if (options.length) {
          setMenu({
            anchor,
            title: card?.name ?? "Card",
            options,
            promptId: prompt.id,
            revision,
            tone: prompt.context?.type === "chain" ? "chain" : "action",
          });
          return;
        }
      }
      setMenu(null);
      activatePromptFromField(prompt, mine, keys, card, draft, submit);
    },
    [base, busy, canAct, draft, mine, prompt, revision, showInspector, submit],
  );

  const onMenuOptionHover = useCallback((option: DuelPromptOption | null) => {
    if (!option || !option.id.startsWith("attack:") || option.controller == null || option.location == null || option.sequence == null) {
      setPreview(null);
      return;
    }
    setPreview({ from: zoneKey(option.controller, option.location, option.sequence), direct: /directly/i.test(option.label) });
  }, []);

  const attackerKey = pendingAttack?.key ?? base.aim?.from ?? null;

  // The arrow the player is steering: a faint preview from the menu, or the declared attacker waiting for a target.
  const aim = useMemo<BattleAim | null>(() => {
    if (base.aim) return base.aim;
    if (pendingAttack) return { mode: "aim", from: pendingAttack.key, to: {} };
    if (preview && activeMenu && viewerSeat != null) {
      const rivals = engine.seats.filter((seat) => seat.seat !== viewerSeat && !seat.eliminated);
      if (preview.direct) {
        const open = rivals.find((seat) => seat.monsters.every((card) => card == null)) ?? rivals[0];
        return open ? { mode: "preview", from: preview.from, to: { lpSeat: open.seat } } : null;
      }
      const zones = rivals.flatMap((seat) => seat.monsters).filter((card): card is DuelCard => card != null).map((card) => zoneKey(card.controller, card.location, card.sequence));
      return { mode: "preview", from: preview.from, to: { zones } };
    }
    return null;
  }, [activeMenu, base.aim, engine.seats, pendingAttack, preview, viewerSeat]);

  const controller = useMemo<TableController>(
    () => ({ ...base, aim, onAnswer: submit, onActivate, onInspect, onHoverCard }),
    [aim, base, onActivate, onHoverCard, onInspect, submit],
  );

  return {
    controller,
    menu: activeMenu,
    closeMenu,
    onMenuOptionHover,
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
