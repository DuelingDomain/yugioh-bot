"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Circle, Diamond, ExternalLink, Eye, Radio, Settings, Volume2, VolumeX } from "lucide-react";
import { isCustomDomain, type DuelAnswer, type DuelCard, type DuelCardInfo, type DuelDeck, type DuelPromptOption, type DuelRoom } from "@yugidraft/shared/duels";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Sheet } from "@/components/ui/sheet";
import { useDuelWebsocket } from "@/lib/hooks/use-duel-websocket";
import { useDuelLeaveGuard } from "@/lib/hooks/use-duel-leave-guard";
import {
  acceptDuelInvite,
  addPracticeBot,
  removePracticeBot,
  archiveDuel,
  cancelDuel,
  duelRoomKey,
  getDuelRoom,
  joinDuel,
  leaveDuel,
  markDuelReady,
  sendDuelAction,
  setDuelDeck,
  startDuel,
  surrenderDuel,
} from "./api";
import { RoomLobby } from "./room-lobby";
import { DeckMasterRail, DuelField } from "./field";
import styles from "./room.module.css";
import { AttackConfirm, CardActionMenu, CardHoverInfo } from "./card-interactions";
import { DestroyFx } from "./destroy-fx";
import { FxBoundary } from "./fx-boundary";
import { BattleFx, type BattleAim } from "./battle-fx";
import fxStyles from "./battle-fx.module.css";
import { DuelFeedback } from "./feedback";
import { duelFontClasses } from "./fonts";
import { DUEL_SHAKE_LEVELS, useDuelPreferences } from "./preferences";
import { CardInspector, type InspectTarget } from "./inspector";
import {
  activatePromptFromField,
  isAttackTargetPrompt,
  isDirectAttackPrompt,
  optionsForCard,
  optionZoneKeys,
  PromptTray,
  promptLegalKeys,
  promptSelectedKeys,
  usePromptDraft,
  type PromptAim,
} from "./prompts";
import { isBattlePhase, phaseLabel, zoneKey } from "./constants";
import { DuelResultScreen } from "./duel-result";
import { duelWindowPath, exitDuelWindow, isDuelWindow, openDuelWindow } from "./duel-window";
import { ownWindowGateVisible } from "./start-flow";
import { SeriesBanner } from "./series-banner";
import { SideDeckPanel } from "./side-deck-panel";
import { isBetweenGames, isSeriesOpen, nextGameTarget, seriesPlayerIndex } from "./series-model";
import { SheetButton } from "./sheet-ui";
import { DuelClockDisplay, DuelSettingsSummary, DuelSoundControls, RoomInvite } from "./room-settings";
import { battleStepLabel, resolveBattleStep, StationTrack, type BattleStep } from "./station-track";
import { MasterReturnFx } from "./master-return-fx";
import { MoveFx } from "./move-fx";
import { PositionFx } from "./position-fx";
import { ChainFx } from "./chain-fx";
import { SummonFx } from "./summon-fx";
import { DuelHistoryRail } from "./history-rail";
import { centerKind, PromptCenter } from "./prompt-center";
import { usePickContinuation } from "./pick-continuation";
import { usePromptAnswerable, usePromptReveal } from "./prompt-reveal";
import { useResultGate } from "./result-reveal";
import { PileViewer } from "./pile-viewer";
import { shouldClosePileForPrompt } from "./pile-focus";


type CardMenuState = {
  anchor: HTMLElement;
  title: string;
  options: DuelPromptOption[];
  promptId: string;
  revision: number;
  tone: "action" | "chain";
};

type Pane = "card" | "log" | "options" | "masters";

/** A pile (Graveyard, Banished, Extra Deck…) opened in the centred viewer. `cards` is the snapshot at open time. */
type PileView = { title: string; owner: "you" | "opp"; cards: DuelCard[]; open: boolean };

/** The pile's live contents from the engine view, so the viewer follows moves while it is open. */
function livePileCards(view: PileView, engine: DuelRoom["engine"], localSeat: number): DuelCard[] {
  const seat = engine?.seats.find((entry) => (view.owner === "you" ? entry.seat === localSeat : entry.seat !== localSeat));
  if (!seat) return view.cards;
  const title = view.title.toLowerCase();
  if (/graveyard|\bgy\b/.test(title)) return seat.graveyard;
  if (/banish/.test(title)) return seat.banished;
  if (/extra/.test(title)) return seat.extra;
  return view.cards;
}

/** The attack target the player pointed at; only the confirm submits it. */
type AimLock = { promptId: string; optionId: string; key: string; anchor: HTMLElement; name: string };

const SHAKE_LABEL = { off: "Off", low: "Low", medium: "Medium", high: "High" } as const;

/** A face-down or unnamed target reads as "face-down monster" in the confirm. */
function targetName(option: DuelPromptOption): string {
  const name = option.card?.name?.trim();
  if (name) return name;
  return !option.label || /^Card \d+$/.test(option.label) ? "face-down monster" : option.label;
}

function zoneAnchor(key: string): HTMLElement | null {
  const zone = document.querySelector<HTMLElement>(`[data-zones~="${key}"]`);
  return zone?.querySelector<HTMLElement>("button") ?? zone;
}

/** Put the confirm on the side of the target away from the attacker, so it never covers the arrow. */
function confirmSide(attackerKey: string | null, anchor: HTMLElement): "above" | "below" {
  const from = attackerKey ? document.querySelector(`[data-zones~="${attackerKey}"]`) : null;
  if (!from) return "above";
  return from.getBoundingClientRect().top > anchor.getBoundingClientRect().top ? "above" : "below";
}

// Action ids the engine sends that never change the board: phase moves and a
// hand shuffle. When the local action prompt offers nothing else, the player has
// no legal play left and the station track lets "End Turn" glow.
const PASSIVE_ACTION_IDS: ReadonlySet<string> = new Set(["to_bp", "to_m2", "to_ep", "shuffle"]);

function hasNoLegalMoves(options: readonly DuelPromptOption[]): boolean {
  return options.length > 0 && options.every((option) => PASSIVE_ACTION_IDS.has(option.id));
}

function phaseTitle(phase: string | null | undefined): string {
  const label = phaseLabel(phase);
  switch (label) {
    case "Draw":
    case "Standby":
    case "Battle":
    case "End":
      return `${label} Phase`;
    case "Main 1":
      return "Main Phase 1";
    case "Main 2":
      return "Main Phase 2";
    case "Damage":
      return "Damage Step";
    case "Damage calculation":
      return "Damage Calculation";
    default:
      return label;
  }
}


const LOG_PHASE_KEYS: ReadonlySet<string> = new Set([
  "draw", "standby", "main1", "battle_start", "battle_step", "damage", "damage_cal", "battle", "main2", "end",
]);

type LogKind = "turn" | "phase" | "loss" | "gain" | "chain" | "result" | "line";

function logKind(text: string): LogKind {
  if (/^Turn \d+/.test(text)) return "turn";
  if (LOG_PHASE_KEYS.has(text)) return "phase";
  if (/ wins \(|^Draw \(/.test(text)) return "result";
  if (/ takes \d+ damage| pays \d+ LP/.test(text)) return "loss";
  if (/ gains \d+ LP/.test(text)) return "gain";
  if (/ is activating$|^A chain link was negated$|^Chain ended$/.test(text)) return "chain";
  return "line";
}

/** The engine log names seats "Player N"; show the table's display names instead. */
function logText(text: string, kind: LogKind, playerName: (seat: number) => string): string {
  if (kind === "phase") return phaseTitle(text);
  return text.replace(/\bPlayer ([12])\b/g, (_match, seat: string) => playerName(Number(seat) - 1));
}

function MatchSheetLog({
  entries,
  playerName,
  players,
}: {
  entries: ReadonlyArray<{ id: number; text: string }>;
  playerName: (seat: number) => string;
  players: string;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const count = entries.length;
  // Follow the newest entry id: the engine caps the log at 400 lines, so the length stops changing.
  const lastId = entries[count - 1]?.id;
  useEffect(() => {
    // Scroll only the sheet's own list; scrollIntoView would also scroll the side pane
    // and push the history rail above it out of view.
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [lastId, count]);
  return (
    <div className={styles.sheet}>
      <div className={styles.sheetHead}>
        <h2>Match sheet</h2>
        <span>{players}</span>
      </div>
      <ol ref={listRef} className={styles.log} aria-label="Duel log">
        {entries.map((entry) => {
          const kind = logKind(entry.text);
          return (
            <li key={entry.id} data-kind={kind}>
              {logText(entry.text, kind, playerName)}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function DuelRoomView({ slug, inviteCode, windowed = false }: { slug: string; inviteCode?: string; windowed?: boolean }) {
  const router = useRouter();
  const admitted = useRef<{ slug: string; inviteCode: string } | null>(null);
  const { data, error, isLoading, mutate } = useSWR(
    slug ? duelRoomKey(slug) : null,
    async () => {
      let admitError: unknown = null;
      if (inviteCode && (admitted.current?.slug !== slug || admitted.current.inviteCode !== inviteCode)) {
        // Try each invite once. A public table, a stale code or an existing grant must not block
        // the room: the normal GET below enforces access on its own.
        admitted.current = { slug, inviteCode };
        const url = new URL(window.location.href);
        url.searchParams.delete("invite");
        window.history.replaceState(window.history.state, "", url);
        try {
          await acceptDuelInvite(slug, inviteCode);
        } catch (err) {
          admitError = err;
        }
      }
      try {
        return await getDuelRoom(slug);
      } catch (err) {
        throw admitError ?? err;
      }
    },
    { revalidateOnFocus: false, revalidateOnReconnect: false },
  );
  const refreshRoom = useCallback(
    () => mutate(() => getDuelRoom(slug), { revalidate: false }),
    [mutate, slug],
  );
  const realtime = useDuelWebsocket(slug, data?.mySeat, refreshRoom);
  const catchingUp = realtime.syncing || realtime.recovering;
  useDuelLeaveGuard({
    slug,
    active: data?.session.status === "active" && !data.engine?.result,
    role: data?.mySeat == null ? "spectator" : "player",
  });
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  // Set when an answer is sent; the next prompt then decides whether an open pile viewer stays.
  const pileAnswered = useRef(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [inspect, setInspect] = useState<InspectTarget | null>(null);
  const [pane, setPane] = useState<Pane>("card");
  const [mobileInspect, setMobileInspect] = useState(false);
  const [confirmSurrender, setConfirmSurrender] = useState(false);
  const [hideResult, setHideResult] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);
  // Read after mount: the server render cannot know whether this is the duel window.
  const [inDuelWindow, setInDuelWindow] = useState(windowed);
  const [playHere, setPlayHere] = useState(false);
  const [windowBlocked, setWindowBlocked] = useState(false);
  const [windowOpened, setWindowOpened] = useState(false);
  // Start duel was clicked and the server has not answered yet.
  const [starting, setStarting] = useState(false);
  const openWindow = () => {
    const opened = openDuelWindow(slug);
    setWindowOpened(opened != null);
    setWindowBlocked(opened == null);
    return opened;
  };
  useEffect(() => { if (isDuelWindow(slug)) setInDuelWindow(true); }, [slug]);
  const [menu, setMenu] = useState<CardMenuState | null>(null);
  const [hover, setHover] = useState<{ card: DuelCard; anchor: HTMLElement } | null>(null);
  const [pile, setPile] = useState<PileView | null>(null);
  const preferences = useDuelPreferences();
  // The engine drops its prompt when the duel ends; guard here too, so no answer path can open between the end and the result screen.
  const prompt = data?.engine?.result ? null : (data?.engine?.prompt ?? null);
  const draft = usePromptDraft(prompt);
  const legalKeys = useMemo(() => promptLegalKeys(prompt), [prompt]);
  const selectedKeys = useMemo(() => promptSelectedKeys(prompt, draft.selected), [draft.selected, prompt]);
  const closeMenu = useCallback(() => setMenu(null), []);
  const boardRef = useRef<HTMLDivElement>(null);
  // The result screen waits for the last attack, LP roll and card flights to finish, then a short human pause.
  const resultReady = useResultGate({
    slug,
    status: data?.session.status,
    hasResult: data?.engine?.result != null,
    reason: data?.engine?.result?.reason ?? data?.session.resultReason,
    reducedMotion: preferences.reducedMotion,
    board: boardRef,
  });
  const promptMine = prompt != null && data?.mySeat != null && prompt.seat === data.mySeat && data.session.status === "active";
  // Every prompt except your own action menu is answered in the middle of the board (PromptCenter):
  // a floating panel for responses, an instruction bar for picks on the field. The left dock keeps
  // only the action prompt's Cancel / Finish and the live region; unknown kinds fall back to the old tray.
  const centered = promptMine && centerKind(prompt) != null;
  // The centred panel waits a human beat and the board FX before it shows; until then nothing answers it.
  // It also waits until the room can take an answer (the last answer finished, no re-sync): until then every button
  // is disabled, so a panel shown early looks ready and is dead.
  // A follow-up of the player's own material pick skips both waits and shows at once (its buttons stay off while busy).
  // Between the click and that prompt the last bar stays up (pick.waiting), buttons off.
  const pick = usePickContinuation(prompt);
  const revealBeat = usePromptReveal({ promptId: centered ? prompt.id : null, board: boardRef, reducedMotion: preferences.reducedMotion, skip: pick.continuing });
  const answerable = usePromptAnswerable(centered ? prompt.id : null, !busy && !error && !catchingUp, pick.continuing);
  const revealed = revealBeat && answerable;
  const activeMenu = !busy && !error && !catchingUp && menu?.promptId === prompt?.id &&
    menu?.revision === data?.engine?.revision ? menu : null;

  // Human attack flow: pick the attacker in the menu (preview arrow), aim at a target, confirm.
  const [pendingAttack, setPendingAttack] = useState<{ key: string; direct: boolean } | null>(null);
  const [actionPreview, setActionPreview] = useState<{ from: string; direct: boolean } | null>(null);
  const [aimHoverKey, setAimHoverKey] = useState<string | null>(null);
  const [aimLock, setAimLock] = useState<AimLock | null>(null);
  const myPrompt = prompt != null && data?.mySeat != null && prompt.seat === data.mySeat &&
    data.session.status === "active";
  const attackTargetActive = myPrompt && isAttackTargetPrompt(prompt, pendingAttack != null);
  const directPromptActive = myPrompt && isDirectAttackPrompt(prompt);
  const attackTargets = useMemo(() => {
    const map = new Map<string, DuelPromptOption>();
    if (!attackTargetActive || !prompt) return map;
    for (const option of prompt.options) {
      const [key] = optionZoneKeys(option);
      if (key) map.set(key, option);
    }
    return map;
  }, [attackTargetActive, prompt]);

  useEffect(() => {
    setMenu(null);
    setHover(null);
    setAimLock(null);
    setAimHoverKey(null);
  }, [prompt?.id, data?.engine?.revision, realtime.recovering]);

  useEffect(() => {
    if (!activeMenu) setActionPreview(null);
  }, [activeMenu]);

  // A new prompt that wants cards outside the open pile (summon materials on the field) must not stay hidden
  // behind the pile viewer's scrim. A prompt that wants cards inside the pile keeps it open.
  useEffect(() => {
    const engine = data?.engine;
    if (!engine) return;
    const answered = pileAnswered.current;
    pileAnswered.current = false;
    if (!prompt) {
      // Answered and now waiting (no prompt for anyone yet): let the player watch the board, not the pile.
      if (answered) setPile((current) => (current?.open ? { ...current, open: false } : current));
      return;
    }
    const seat = data?.mySeat ?? 0;
    setPile((current) => {
      if (!current?.open) return current;
      const cards = livePileCards(current, engine, seat);
      return shouldClosePileForPrompt(cards, promptLegalKeys(prompt), promptMine, answered) ? { ...current, open: false } : current;
    });
    // Only a new prompt decides this; later revisions of the same prompt must not close a pile the player opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt?.id]);

  // Hovering or focusing a legal target on the board aims the arrow at it.
  useEffect(() => {
    if (!attackTargetActive) {
      setAimHoverKey(null);
      return;
    }
    const keyOf = (target: EventTarget | null): string | null => {
      const zone = target instanceof Element ? target.closest("[data-zones]") : null;
      const keys = zone?.getAttribute("data-zones")?.split(" ") ?? [];
      return keys.find((key) => attackTargets.has(key)) ?? null;
    };
    const enter = (event: Event) => {
      const key = keyOf(event.target);
      if (key) setAimHoverKey(key);
    };
    const leave = (event: Event) => {
      if (keyOf(event.target) && keyOf((event as PointerEvent | FocusEvent).relatedTarget) == null) setAimHoverKey(null);
    };
    document.addEventListener("pointerover", enter);
    document.addEventListener("pointerout", leave);
    document.addEventListener("focusin", enter);
    document.addEventListener("focusout", leave);
    return () => {
      document.removeEventListener("pointerover", enter);
      document.removeEventListener("pointerout", leave);
      document.removeEventListener("focusin", enter);
      document.removeEventListener("focusout", leave);
    };
  }, [attackTargetActive, attackTargets]);

  useEffect(() => {
    setInspect(null);
    setPile(null);
    setHideResult(false);
    setSideOpen(false);
    setMobileInspect(false);
    setActionError(null);
    setStarting(false);
  }, [slug]);

  const run = useCallback(
    async (work: () => Promise<DuelRoom | { session: unknown } | void>) => {
      // React's busy state alone cannot reject two clicks within one render.
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      setMenu(null);
      setHover(null);
      setActionError(null);
      try {
        const result = await work();
        if (result && "engine" in result) await mutate(result, { revalidate: true });
        else await mutate();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Action failed");
        await mutate();
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [mutate],
  );

  // A series moves on to its next game by itself: follow it, keeping the duel window.
  const nextTarget = data ? nextGameTarget(data, slug) : null;
  const goToGame = useCallback((next: string) => {
    router.replace(inDuelWindow ? duelWindowPath(next) : `/duels/${encodeURIComponent(next)}`);
  }, [router, inDuelWindow]);
  useEffect(() => {
    if (nextTarget) goToGame(nextTarget);
  }, [nextTarget, goToGame]);

  // The side deck window and the next game start on the server; poll in case the socket misses it.
  const seriesWaiting = data?.series != null && isSeriesOpen(data.series) && data.session.status !== "active"
    && data.session.status !== "lobby";
  useEffect(() => {
    if (!seriesWaiting) return undefined;
    const timer = window.setInterval(() => void refreshRoom(), 2000);
    return () => window.clearInterval(timer);
  }, [seriesWaiting, refreshRoom]);

  const onSubmitAnswer = useCallback(
    (answer: DuelAnswer) => {
      if (!data?.engine || !prompt || error || catchingUp || data.mySeat !== prompt.seat ||
          data.session.status !== "active" || inFlight.current) return;
      const command = { promptId: prompt.id, revision: data.engine.revision, answer };
      // The answer is on its way (e.g. an Extra Deck summon picked in the pile viewer): the next prompt decides
      // whether the viewer stays (it wants a card in the pile) or closes (materials on the field must not sit behind it).
      pileAnswered.current = true;
      pick.noteAnswer(prompt, answer);
      // Remember the declared attacker so the target step can draw the arrow from it.
      const attack = prompt.context?.type === "action" && answer.choice?.startsWith("attack:")
        ? prompt.options.find((option) => option.id === answer.choice) : undefined;
      setPendingAttack(attack && attack.controller != null && attack.location != null && attack.sequence != null
        ? { key: zoneKey(attack.controller, attack.location, attack.sequence), direct: /directly/i.test(attack.label) }
        : null);
      void run(() => sendDuelAction(slug, command));
    },
    [data, prompt, error, catchingUp, run, slug, pick.noteAnswer],
  );

  /** A prompt tile or response row under the pointer: show the card in the inspector, as board cards do. */
  function inspectInfo(card: DuelCardInfo) {
    if (pane === "card") setInspect({ type: "info", card });
  }

  function showInspector(target: InspectTarget, mobile = false) {
    if (target.type === "pile") {
      // Piles open in the centred viewer over the board, never in the inspector (whose state it does not share).
      const seat = data?.mySeat ?? 0;
      const first = target.cards[0];
      const owner: "you" | "opp" = first ? (first.controller === seat ? "you" : "opp")
        : target.title.toLowerCase().startsWith(playerNameOf(seat).toLowerCase()) ? "you" : "opp";
      setHover(null);
      setMobileInspect(false);
      setPile({ title: target.title, owner, cards: target.cards, open: true });
      return;
    }
    setInspect(target);
    setPane("card");
    if (mobile && window.matchMedia("(max-width: 900px)").matches) setMobileInspect(true);
  }

  function playerNameOf(seat: number): string {
    return data?.session.seats.find((player) => player.seat === seat)?.displayName ?? `Player ${seat + 1}`;
  }

  const closePile = useCallback(() => setPile((current) => (current ? { ...current, open: false } : null)), []);

  /** Point the arrow at a legal target and open the confirm. Nothing is submitted yet. */
  function lockTarget(option: DuelPromptOption, anchor: HTMLElement | null) {
    if (!prompt) return;
    const [key] = optionZoneKeys(option);
    const el = anchor ?? (key ? zoneAnchor(key) : null);
    if (!key || !el) {
      onSubmitAnswer({ selected: [option.id] });
      return;
    }
    setMenu(null);
    setHover(null);
    setAimLock({ promptId: prompt.id, optionId: option.id, key, anchor: el, name: targetName(option) });
  }

  function confirmAim() {
    if (!aimLock || aimLock.promptId !== prompt?.id) return;
    const { optionId } = aimLock;
    setAimLock(null);
    onSubmitAnswer({ selected: [optionId] });
  }

  function onMenuOptionHover(option: DuelPromptOption | null) {
    if (!option || !option.id.startsWith("attack:") || option.controller == null || option.location == null ||
        option.sequence == null) {
      setActionPreview(null);
      return;
    }
    setActionPreview({ from: zoneKey(option.controller, option.location, option.sequence), direct: /directly/i.test(option.label) });
  }

  function onHoverCard(card: DuelCard | null, anchor: HTMLElement | null) {
    if (!card || !anchor || card.code == null) {
      setHover(null);
      return;
    }
    setHover({ card, anchor });
    if (pane === "card") setInspect({ type: "card", card });
  }

  function onFieldActivate(keys: string[], card: DuelCard | null, anchor: HTMLElement, preserveInspector = false) {
    setHover(null);
    if (card && !preserveInspector) showInspector({ type: "card", card });
    if (busy || error || catchingUp) return;
    const mine = prompt != null && data?.mySeat != null && prompt.seat === data.mySeat;
    if (mine && (prompt.kind === "choice" || prompt.kind === "toggle")) {
      const options = optionsForCard(prompt, card, keys);
      if (prompt.kind === "toggle" && options.length === 1) {
        onSubmitAnswer({ choice: options[0].id });
        return;
      }
      if (options.length && data?.engine) {
        setMenu({
          anchor,
          title: card?.name ?? "Card",
          options,
          promptId: prompt.id,
          revision: data.engine.revision,
          tone: prompt.context?.type === "chain" ? "chain" : "action",
        });
        return;
      }
    }
    if (mine && isAttackTargetPrompt(prompt, pendingAttack != null)) {
      const targets = optionsForCard(prompt, card, keys);
      if (targets.length === 1) {
        lockTarget(targets[0], anchor);
        return;
      }
    }
    closeMenu();
    const handled = activatePromptFromField(prompt, Boolean(mine), keys, card, draft, onSubmitAnswer);
    if (card && !handled) showInspector({ type: "card", card }, true);
  }

  function onInspectorActivate(card: DuelCard, anchor: HTMLElement) {
    onFieldActivate([zoneKey(card.controller, card.location, card.sequence)], card, anchor, true);
  }

  if (isLoading && !data) return <div className="p-6 text-sm text-text-secondary">Loading table…</div>;
  if (error && !data) {
    const message = error instanceof Error ? error.message : "Could not load this table.";
    return (
      <div className="space-y-3 p-6">
        <p className="text-sm text-accent-cta">{message}</p>
        <Button type="button" size="sm" variant="secondary" onClick={() => void mutate()}>Retry</Button>
        <Link href="/duels" className="ml-3 text-sm text-text-secondary">Back to tables</Link>
      </div>
    );
  }
  if (!data) return null;
  // The server flips to active before it answers Start duel; the pop-up already has the duel then.
  const ownWindowGate = ownWindowGateVisible({
    status: data.session.status, mySeat: data.mySeat, inDuelWindow, playHere,
    hasResult: Boolean(data.engine?.result), starting, windowOpened,
  });
  if (data.session.status === "lobby" && !ownWindowGate) {
    return (
      <RoomLobby room={data} slug={slug} busy={busy} starting={starting} actionError={actionError}
        onDeckLocked={() => void refreshRoom()}
        onJoin={() => void run(() => joinDuel(slug))}
        onAddBot={() => void run(() => addPracticeBot(slug))}
        onRemoveBot={() => void run(() => removePracticeBot(slug))}
        onReady={(deck) => void run(() => setDuelDeck(slug, deck))}
        onMarkReady={() => void run(() => markDuelReady(slug))}
        onStart={() => {
          // Inside the click, so pop-up blockers allow it. Seated players on other devices get the prompt below.
          if (inFlight.current) return;
          const opened = inDuelWindow ? null : openWindow();
          setStarting(true);
          void run(async () => {
            try {
              return await startDuel(slug);
            } catch (err) {
              // Back to the lobby with the error; the pop-up has nothing to show.
              setStarting(false);
              try { opened?.close(); } catch { /* the browser keeps it open */ }
              throw err;
            }
          });
        }}
        onCancel={() => void run(() => cancelDuel(slug))}
        onLeave={() => void run(async () => {
          await leaveDuel(slug);
          router.replace("/duels");
        })}
      />
    );
  }

  const engine = data.engine;
  const localSeat = data.mySeat ?? 0;
  const bottom = engine?.seats.find((seat) => seat.seat === localSeat);
  const top = engine?.seats.find((seat) => seat.seat !== localSeat);
  const mine = prompt != null && prompt.seat === data.mySeat;
  const canAct = mine && !busy && !error && !catchingUp && data.session.status === "active";
  const canSurrender = data.session.status === "active" && data.mySeat != null && !engine?.result;
  const terminal = data.session.status !== "active";
  const isOrganizer = data.session.seats.some((seat) =>
    seat.seat === data.mySeat && seat.playerId === data.session.organizerPlayerId);
  const canArchive = terminal && isOrganizer && !data.session.archivedAt;
  const series = data.series ?? null;
  const myIndex = series ? seriesPlayerIndex(data, series) : null;
  const sidePanelOpen = sideOpen && series != null && myIndex != null && data.mySide != null && isBetweenGames(data, slug);
  const showResult = !hideResult && !sidePanelOpen && resultReady && (engine?.result != null || terminal);
  const hasResult = engine?.result != null || terminal;
  const exitDuel = () => {
    if (inDuelWindow) exitDuelWindow(slug, () => router.replace("/duels"));
    else router.replace("/duels");
  };
  if (ownWindowGate) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center gap-4 text-center"
        data-testid="duel-window-gate">
        <h1 className="text-xl font-semibold text-text-primary">{windowOpened ? "Duel is open in its own window" : "Your duel is live"}</h1>
        <p className="text-sm text-text-secondary">
          {windowOpened ? "" : "Open it in its own window. "}The duel runs in a separate window so Back and Forward cannot pull you out of it.
          {windowBlocked ? " Your browser blocked the window. Click the button to open it." : ""}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <SheetButton kind="primary" size="lg" onClick={openWindow}>
            <ExternalLink size={16} strokeWidth={1.6} aria-hidden />{windowOpened ? "Focus window" : "Open duel window"}
          </SheetButton>
          <SheetButton kind="quiet" onClick={() => setPlayHere(true)}>Open here instead</SheetButton>
        </div>
      </div>
    );
  }
  const connectionLabel = terminal ? "Finished" : realtime.syncing ? "Catching up…" :
    error || realtime.recovering ? "Reconnecting" : realtime.connected ? "Live" : "Polling";
  const domain = data.session.mode === "domain";
  const actionOptions = prompt?.context?.type === "action" ? prompt.options : [];
  const playerName = (seat: number) => data.session.seats.find((player) => player.seat === seat)?.displayName ?? `Player ${seat + 1}`;
  const spectator = data.mySeat == null;
  const battle = isBattlePhase(engine?.phase);
  // engine.battleStep is a round-4 contract field; read it defensively until every shared build carries it.
  const engineStep = (engine as { battleStep?: BattleStep | null } | null)?.battleStep ?? null;
  const battleStep = battle ? resolveBattleStep(engine?.phase, engineStep) : null;
  const stepName = battleStepLabel(battleStep);
  const headerPhase = battle ? `Battle Phase${stepName ? ` · ${stepName}` : ""}` : phaseTitle(engine?.phase);
  const turnSeat = engine?.turnSeat;
  const myTurn = !spectator && turnSeat === data.mySeat;
  const turnText = turnSeat == null ? null : myTurn ? "Your turn" : `${playerName(turnSeat)}'s turn`;
  const soundLabel = preferences.soundEnabled ? "On" : "Off";

  const isActionPrompt = prompt?.kind === "choice" && prompt.context?.type === "action";
  // idle: nothing to answer here (the field, the station track or the centre layer answer it);
  // float: a short action-prompt control over the lower left sheet;
  // flow: fallback list for a prompt kind the centre layer does not know.
  const dockMode = !promptMine || prompt == null || centered ? "idle"
    : isActionPrompt ? (prompt.cancelable || prompt.finishable ? "float" : "idle")
      : "flow";
  const trackCaption = data.session.status !== "active" ? "Duel finished" : prompt == null ? null
    : promptMine ? (isActionPrompt ? null : prompt.title)
      : `${playerName(prompt.seat)} is choosing…`;

  // The arrow the player is steering: a dim preview from the menu, the aimed arrow, or a locked one.
  const oppSeat = top?.seat ?? 1 - localSeat;
  const attackerKey = pendingAttack?.key ?? null;
  let battleAim: BattleAim | null = null;
  if (attackTargetActive && attackerKey) {
    const key = aimLock?.key ?? aimHoverKey;
    if (key) battleAim = { mode: aimLock ? "locked" : "aim", from: attackerKey, to: { zones: [key] } };
  } else if (directPromptActive && attackerKey) {
    battleAim = { mode: "aim", from: attackerKey, to: { lpSeat: oppSeat } };
  } else if (actionPreview && activeMenu) {
    const foes = (top?.monsters ?? []).filter((card): card is DuelCard => card != null)
      .map((card) => zoneKey(card.controller, card.location, card.sequence));
    battleAim = actionPreview.direct
      ? { mode: "preview", from: actionPreview.from, to: { lpSeat: oppSeat } }
      : { mode: "preview", from: actionPreview.from, to: { zones: foes } };
  }
  const promptAim: PromptAim | undefined = attackTargetActive
    ? {
        lockedId: aimLock?.optionId ?? null,
        onAim: (option) => lockTarget(option, null),
        onHover: (option) => setAimHoverKey(option ? optionZoneKeys(option)[0] ?? null : null),
      }
    : undefined;

  const inspector = (
    <CardInspector target={inspect}
      onInspectCard={(card) => setInspect({ type: "card", card })}
      onActivateCard={onInspectorActivate}
    />
  );
  const masterRail = domain && engine ? (
    <DeckMasterRail engine={engine} mySeat={data.mySeat} legalKeys={legalKeys}
      selectedKeys={selectedKeys} canAct={canAct}
      legalActionsFor={(card, keys) =>
        canAct && prompt?.kind === "choice" && prompt.context?.type === "action"
          ? optionsForCard(prompt, card, keys)
          : []
      }
      onChooseAction={(option) => {
        setMobileInspect(false);
        onSubmitAnswer({ choice: option.id });
      }}
      onActivate={onFieldActivate}
      onHoverCard={onHoverCard} onInspect={(target) => showInspector(target, true)} />
  ) : null;
  const sideContent = pane === "card" ? inspector : pane === "log" ? (
    <div className={styles.logPane}>
      {engine ? <DuelHistoryRail events={engine.events} engine={engine} mySeat={data.mySeat} playerName={playerName}
        onInspectCard={(card) => showInspector("location" in card ? { type: "card", card } : { type: "info", card })}
        reducedMotion={preferences.reducedMotion} /> : null}
      <details className={styles.textLog}>
        <summary>Text log</summary>
        <MatchSheetLog entries={engine?.log ?? []} playerName={playerName}
          players={data.session.seats.map((seat) => seat.displayName).join(" v ")} />
      </details>
    </div>
  ) : pane === "masters" ? (
    <div className={styles.mastersSheet}>{masterRail}</div>
  ) : (
    <div className={styles.options}>
      <DuelSettingsSummary session={data.session} />
      <RoomInvite room={data} slug={slug} />
      <h2>Presentation</h2>
      <DuelSoundControls enabled={preferences.soundEnabled} volume={preferences.soundVolume}
        onEnabledChange={preferences.setSoundEnabled} onVolumeChange={preferences.setSoundVolume} />
      <label className="flex flex-col gap-2">Motion
        <select value={preferences.motion}
          onChange={(event) => preferences.setMotion(event.target.value as typeof preferences.motion)}>
          <option value="system">Use device setting</option>
          <option value="reduced">Reduced motion</option>
          <option value="full">Full motion</option>
        </select>
      </label>
      <div className={`${fxStyles.shakeRow} ${duelFontClasses}`}>
        <span>Screen shake</span>
        <div className={fxStyles.segment} role="group" aria-label="Screen shake">
          {DUEL_SHAKE_LEVELS.map((level) => (
            <button key={level} type="button" aria-pressed={preferences.shake === level}
              onClick={() => preferences.setShake(level)}>{SHAKE_LABEL[level]}</button>
          ))}
        </div>
        <p className={fxStyles.shakeNote}>How hard heavy summons rattle the field.</p>
      </div>
      <p>Effects never pause the duel or submit a response.</p>
      {actionOptions.filter((option) => option.id === "shuffle").map((option) => (
        <Button key={option.id} type="button" size="sm" variant="secondary" disabled={!canAct}
          onClick={() => onSubmitAnswer({ choice: option.id })}>{option.label}</Button>
      ))}
      <h2>Connection</h2>
      <p role="status">{terminal ? "Showing the saved final state." : realtime.syncing
        ? "Catching up to the current duel. Actions resume when the latest state arrives."
        : realtime.connected ? "Live updates connected." : "Reconnecting live updates; polling for the latest state."}</p>
      {!terminal ? <Button type="button" size="sm" variant="secondary" disabled={busy || realtime.syncing}
        onClick={() => void realtime.resync().catch(() => setActionError("Could not catch up. Check your connection and retry."))}>
        Catch up now
      </Button> : null}
      {data.mySeat == null ? <p>Watching only. Both players’ hidden cards remain private.</p> : null}
      {realtime.presence ? (
        <div>
          <p>{realtime.presence.spectatorCount} watching</p>
          {data.session.seats.map((seat) => (
            <p key={seat.seat}>{seat.displayName} · {seat.isBot ? "Bot" : realtime.presence?.onlineSeats.includes(seat.seat) ? "Connected" : "Disconnected"}</p>
          ))}
        </div>
      ) : null}
      {canSurrender ? <Button type="button" variant="danger" size="sm" disabled={busy}
        onClick={() => setConfirmSurrender(true)}>Surrender</Button> : null}
      {canArchive ? <Button type="button" variant="secondary" size="sm" disabled={busy}
        onClick={() => void run(() => archiveDuel(slug))}>Archive table</Button> : null}
      {data.session.status === "completed" || data.session.status === "interrupted" ? (
        <>
          <p>Finished. This duel is in Match history.</p>
          <Link href={`/duels/${slug}/replay`}>Watch replay</Link>
        </>
      ) : null}
      <Link href="/duels">Back to tables</Link>
    </div>
  );
  const tabs = (mobile = false) => {
    const panes: readonly Pane[] = mobile
      ? (domain ? ["card", "log", "options", "masters"] : ["card", "log", "options"])
      : ["card", "log"];
    return (
      <div className={styles.tabs} role={mobile ? undefined : "tablist"} aria-label={mobile ? "Mobile duel panels" : "Duel panels"}
        onKeyDown={(event) => {
          if (mobile || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
          const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
            : (current + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next]?.focus();
          buttons[next]?.click();
        }}>
        {panes.map((tab) => (
          <button key={tab} type="button" role={mobile ? undefined : "tab"}
            aria-selected={mobile ? undefined : pane === tab} aria-haspopup={mobile ? "dialog" : undefined}
            tabIndex={mobile || pane === tab || (!mobile && pane === "options" && tab === "card") ? 0 : -1}
            onClick={() => { setPane(tab); if (mobile) setMobileInspect(true); }}>
            {tab[0].toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className={`${styles.shell} ${duelFontClasses} -mx-4 -my-4 sm:-mx-6 sm:-my-6 lg:-mx-8 lg:-my-8`}
      data-domain={domain} data-fit="true" data-phase={battle ? "battle" : undefined}
      data-turn={spectator ? "watch" : myTurn ? "you" : "opp"}
      data-reduced={preferences.reducedMotion ? "true" : "false"}>
      <header className={styles.header}>
        <div className={styles.identity}>
          <Link href="/duels" replace={inDuelWindow}>Yugidraft</Link>
          {spectator ? <strong className={styles.viewerRole} title="You are watching. Both players' hidden cards remain private.">
            <Eye size={15} strokeWidth={1.5} aria-hidden /> You are spectating
          </strong> : null}
          <span className={styles.format}>{domain ? isCustomDomain(data.session.masterRule, data.session.settings) ? "Custom Domain" : "Domain" : `MR${data.session.masterRule}`} · 1v1</span>
        </div>
        <div className={styles.turn}>
          <strong>Turn {engine?.turn ?? "—"}</strong><span className={styles.phaseName} data-step={battleStep ?? undefined}>{headerPhase}</span>
          {turnText ? (
            <span className={styles.whoPill} data-turn={spectator ? "watch" : myTurn ? "you" : "opp"}>
              {spectator ? <Eye size={13} strokeWidth={1.75} aria-hidden /> : myTurn
                ? <Diamond size={13} strokeWidth={1.75} fill="currentColor" aria-hidden />
                : <Circle size={13} strokeWidth={1.75} aria-hidden />}
              {turnText}
            </span>
          ) : null}
        </div>
        <div className={styles.status}>
          <span className={styles.connectionStatus} role="status" aria-live="polite" data-live={connectionLabel === "Live"}>
            {connectionLabel === "Live" ? <i className={styles.liveDot} aria-hidden /> : <Radio size={15} strokeWidth={1.75} aria-hidden />}
            {connectionLabel === "Live" ? (spectator ? "Live duel · watching" : "Live duel") : connectionLabel}
          </span>
          {hasResult && hideResult ? (
            <button type="button" className={styles.tool} onClick={() => setHideResult(false)}>
              <span>Show result</span>
            </button>
          ) : null}
          {hasResult && resultReady ? (
            <button type="button" className={styles.tool} onClick={exitDuel}>
              <span>Exit duel</span>
            </button>
          ) : null}
          <button type="button" className={`${styles.tool} ${styles.pref}`}
            aria-label={`Sound effects ${soundLabel.toLowerCase()}`}
            onClick={() => preferences.setSoundEnabled(!preferences.soundEnabled)}>
            {preferences.soundEnabled ? <Volume2 size={16} strokeWidth={1.75} aria-hidden /> : <VolumeX size={16} strokeWidth={1.75} aria-hidden />}
            <span>Sound <b>{soundLabel}</b></span>
          </button>
          <button
            type="button"
            className={styles.gear}
            aria-label="Options"
            aria-pressed={pane === "options"}
            onClick={() => {
              setPane("options");
              if (window.matchMedia("(max-width: 900px)").matches) setMobileInspect(true);
            }}
          >
            <Settings size={20} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      </header>
      {series && !showResult ? (
        <SeriesBanner room={data} slug={slug} onChanged={() => void refreshRoom()} onNavigate={goToGame}
          onOpenSide={() => setSideOpen(true)} />
      ) : null}
      {error ? <div className={styles.error} role="alert">Connection lost. Actions paused until reconnected.
        <button type="button" onClick={() => void mutate()}>Retry</button></div> : null}
      {actionError ? <div className={styles.error} role="alert">{actionError}</div> : null}
      {data.error ? <div className={styles.error} role="alert">{data.error}</div> : null}
      <div className={styles.layout}>
        <aside className={styles.inspector}>
          {tabs()}
          <div className={styles.sideContent} role="tabpanel" aria-label={pane}>{sideContent}</div>
        </aside>
        <div
          className={styles.promptDock}
          data-mode={dockMode}
          data-tone={prompt?.context?.type === "chain" ? "chain" : "action"}
          data-idle={dockMode === "idle" ? "true" : "false"}
        >
          <PromptTray prompt={prompt} mySeat={data.mySeat} slug={slug} busy={busy || Boolean(error) || catchingUp}
            draft={draft} onSubmit={onSubmitAnswer} menuOpen={Boolean(activeMenu)}
            active={data.session.status === "active"} aim={promptAim} headless={centered} suspended={centered && !revealed} />
        </div>
        <section className={styles.boardColumn} aria-label="Duel field">
          <div className={styles.board} ref={boardRef}>
            {engine ? (
              <>
                <DuelField key={slug} engine={engine} mySeat={data.mySeat} masterRule={data.session.masterRule}
                  reducedMotion={preferences.reducedMotion}
                  legalKeys={legalKeys} selectedKeys={selectedKeys} onActivate={onFieldActivate}
                  onHoverCard={onHoverCard} onInspect={(target) => showInspector(target, true)}
                  bottomName={playerName(localSeat)}
                  topName={playerName(top?.seat ?? 1 - localSeat)} />
                <FxBoundary>
                {!error && !realtime.recovering ? <DuelFeedback events={engine.events} duelKey={slug}
                  soundEnabled={preferences.soundEnabled} soundVolume={preferences.soundVolume} reducedMotion={preferences.reducedMotion} /> : null}
                {!error && !realtime.recovering ? <SummonFx events={engine.events} duelKey={slug}
                  reducedMotion={preferences.reducedMotion} shake={preferences.shake} /> : null}
                {!error && !realtime.recovering ? <MoveFx events={engine.events} duelKey={slug} reducedMotion={preferences.reducedMotion} /> : null}
                {!error && !realtime.recovering ? <PositionFx events={engine.events} duelKey={slug} reducedMotion={preferences.reducedMotion} /> : null}
                {!error && !realtime.recovering ? <ChainFx events={engine.events} chain={engine.chain} duelKey={slug}
                  reducedMotion={preferences.reducedMotion} mySeat={data.mySeat} playerName={playerName} /> : null}
                {!error && !realtime.recovering ? <MasterReturnFx events={engine.events} seats={engine.seats} duelKey={slug}
                  reducedMotion={preferences.reducedMotion} mySeat={data.mySeat} /> : null}
                <BattleFx key={`battle-${slug}`} events={engine.events} seats={engine.seats} reducedMotion={preferences.reducedMotion}
                  active={!error && !realtime.recovering} aim={battleAim} />
                <DestroyFx key={`destroy-${slug}`} events={engine.events} reducedMotion={preferences.reducedMotion}
                  active={!error && !realtime.recovering} mySeat={localSeat} />
                </FxBoundary>
                <PromptCenter prompt={prompt ?? pick.waiting} mySeat={data.mySeat} active={data.session.status === "active"} slug={slug}
                  busy={busy || Boolean(error) || catchingUp || (prompt == null && pick.waiting != null)} draft={draft} onSubmit={onSubmitAnswer}
                  menuOpen={Boolean(activeMenu)} chain={engine.chain} aim={promptAim}
                  aimLocked={aimLock != null && aimLock.promptId === prompt?.id}
                  reducedMotion={preferences.reducedMotion} revision={engine.revision} battleStep={battleStep}
                  revealed={revealed} onInspectCard={inspectInfo} />
                {pile ? (
                  <PileViewer title={pile.title} owner={pile.owner} open={pile.open}
                    cards={livePileCards(pile, engine, localSeat)} onClose={closePile}
                    onInspectCard={(card) => { setInspect({ type: "card", card }); setPane("card"); }}
                    onHoverCard={(card) => { if (pane === "card") setInspect({ type: "card", card }); }}
                    onActivateCard={onInspectorActivate}
                    legalKeys={legalKeys} selectedKeys={selectedKeys}
                    reducedMotion={preferences.reducedMotion} />
                ) : null}
              </>
            ) : <p className="p-4">{data.session.status === "active" ? "Waiting for engine view…" : "No saved final board is available for this record."}</p>}
          </div>
        </section>
        {masterRail ? <aside className={styles.masters} aria-label="Deck Masters">{masterRail}</aside> : null}
      </div>
      <div className={styles.track}>
        <StationTrack
          phase={engine?.phase}
          battleStep={battleStep}
          turn={engine?.turn}
          turnSeat={engine?.turnSeat}
          mySeat={data.mySeat}
          playerName={playerName}
          actionOptions={mine ? actionOptions : []}
          canAct={canAct}
          noLegalMoves={canAct && hasNoLegalMoves(actionOptions)}
          onChoose={(id) => onSubmitAnswer({ choice: id })}
          clock={data.clock ? <DuelClockDisplay key={data.clock.serverNow} clock={data.clock} session={data.session} /> : null}
          caption={trackCaption}
          reducedMotion={preferences.reducedMotion}
        />
      </div>
      <div className={styles.mobileBar}>{tabs(true)}</div>
      {activeMenu ? <CardActionMenu anchor={activeMenu.anchor} title={activeMenu.title}
        options={activeMenu.options} busy={busy} onClose={closeMenu}
        tone={activeMenu.tone}
        onOptionHover={onMenuOptionHover}
        onChoose={(option) => {
          if (activeMenu.promptId !== prompt?.id || activeMenu.revision !== engine?.revision) return;
          closeMenu();
          onSubmitAnswer({ choice: option.id });
        }} /> : null}
      {attackTargetActive && aimLock && aimLock.promptId === prompt?.id && !busy && !error && !catchingUp ? (
        <AttackConfirm anchor={aimLock.anchor} targetName={aimLock.name} busy={busy}
          prefer={confirmSide(attackerKey, aimLock.anchor)} onConfirm={confirmAim}
          onBack={() => setAimLock(null)} />
      ) : null}
      {hover && !activeMenu && !mobileInspect && !pile?.open ? <CardHoverInfo card={hover.card} anchor={hover.anchor} /> : null}
      <Sheet open={mobileInspect} onClose={() => setMobileInspect(false)}
        title={pane === "card" ? "Card" : pane === "log" ? "Duel log" : pane === "masters" ? "Deck Masters" : "Options"}>
        {sideContent}
      </Sheet>
      <Modal open={confirmSurrender && !hasResult} onClose={() => setConfirmSurrender(false)} title="Surrender">
        <p className="text-sm text-text-secondary">This ends the duel. Confirm surrender?</p>
        <div className="mt-4 flex gap-2">
          <Button type="button" variant="danger" loading={busy} onClick={() => {
            setConfirmSurrender(false);
            void run(() => surrenderDuel(slug));
          }}>Surrender</Button>
          <Button type="button" variant="ghost" onClick={() => setConfirmSurrender(false)}>Keep playing</Button>
        </div>
      </Modal>
      {showResult ? (
        <DuelResultScreen room={data} slug={slug} reducedMotion={preferences.reducedMotion}
          soundEnabled={preferences.soundEnabled} onClose={() => setHideResult(true)} onExit={exitDuel}
          onOpenSide={() => { setHideResult(true); setSideOpen(true); }}
          onSeriesChanged={() => void refreshRoom()} onNavigate={goToGame} />
      ) : null}
      {sidePanelOpen && series && myIndex != null && data.mySide ? (
        <SideDeckPanel slug={slug} series={series} myIndex={myIndex} side={data.mySide}
          onClose={() => setSideOpen(false)} onChanged={() => void refreshRoom()} onNavigate={goToGame} />
      ) : null}
    </div>
  );
}
