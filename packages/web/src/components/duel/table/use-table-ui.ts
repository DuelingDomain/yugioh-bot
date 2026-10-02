"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DuelAnswer, DuelCard, DuelPromptOption } from "@yugidraft/shared/duels";
import { zoneKey } from "../constants";
import { activatePromptFromField, isAttackTargetPrompt, optionsForCard } from "../prompts";
import { shouldClosePileForPrompt } from "../pile-focus";
import { promptLegalKeys } from "../prompts";
import { DEFAULT_SIDE_PANE, type SidePane } from "../side-panel";
import type { BattleAim, DuelActivateHandler, InspectTarget, TableController } from "./types";

/**
 * The interaction state of a table that the room keeps in its own component: the card action menu, the hover
 * card, the pile viewer, the inspector target and the declared attacker. It mirrors room.tsx on purpose and wraps
 * a controller, so TableStage and the aim flow see menu-aware handlers. A room that owns this state keeps its own
 * and leaves this hook out.
 */

export type CardMenuState = {
  anchor: HTMLElement;
  title: string;
  options: DuelPromptOption[];
  promptId: string;
  revision: number;
  tone: "action" | "chain";
};

/** A pile (Graveyard, Banished, Extra Deck) opened in the centred viewer. `cards` is the snapshot at open time. */
export type PileView = { title: string; owner: "you" | "opp"; cards: DuelCard[]; open: boolean; seat?: number };

/** The pile's live contents from the engine view, so the viewer follows moves while it is open. */
export function livePileCards(view: PileView, engine: TableController["engine"], viewerSeat: number | null): DuelCard[] {
  const local = viewerSeat ?? 0;
  const seat = engine.seats.find((entry) => (view.seat != null ? entry.seat === view.seat : view.owner === "you" ? entry.seat === local : entry.seat !== local));
  if (!seat) return view.cards;
  const title = view.title.toLowerCase();
  if (/graveyard|\bgy\b/.test(title)) return seat.graveyard;
  if (/banish/.test(title)) return seat.banished;
  if (/extra/.test(title)) return seat.extra;
  return view.cards;
}

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
  const [pendingAttack, setPendingAttack] = useState<{ key: string; direct: boolean } | null>(null);
  const [preview, setPreview] = useState<{ from: string; direct: boolean } | null>(null);

  const promptId = prompt?.id ?? null;
  const revision = engine.revision;
  const activeMenu = !busy && menu?.promptId === promptId && menu?.revision === revision ? menu : null;

  // A new prompt or revision drops the menu and the hover card.
  useEffect(() => {
    setMenu(null);
    setHover(null);
  }, [promptId, revision]);
  useEffect(() => {
    if (!activeMenu) setPreview(null);
  }, [activeMenu]);
  // The declared attacker belongs to the attack target step only.
  useEffect(() => {
    if (!prompt || !isAttackTargetPrompt(prompt, true)) setPendingAttack(null);
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
    (target: InspectTarget, reveal = false) => {
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
    },
    [pane, viewerSeat],
  );

  const onInspect = useCallback<TableController["onInspect"]>((target) => showInspector(target), [showInspector]);
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
      setPendingAttack(
        attack && attack.controller != null && attack.location != null && attack.sequence != null
          ? { key: zoneKey(attack.controller, attack.location, attack.sequence), direct: /directly/i.test(attack.label) }
          : null,
      );
      onAnswer(answer);
    },
    [onAnswer, prompt],
  );

  const onActivate = useCallback<DuelActivateHandler>(
    (keys, card, anchor) => {
      setHover(null);
      if (card) showInspector({ type: "card", card });
      base.onActivate(keys, card, anchor);
      if (busy || !prompt) return;
      if (mine && (prompt.kind === "choice" || prompt.kind === "toggle")) {
        const options = optionsForCard(prompt, card, keys);
        if (prompt.kind === "toggle" && options.length === 1) {
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
    [base, busy, draft, mine, prompt, revision, showInspector, submit],
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
    suspended: activeMenu != null || pile?.open === true,
    attackerKey,
    inspectCard,
  };
}
