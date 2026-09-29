"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Settings } from "lucide-react";
import type { DuelAnswer, DuelCard, DuelDeck, DuelPromptOption, DuelRoom } from "@yugidraft/shared/duels";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Sheet } from "@/components/ui/sheet";
import { useDuelWebsocket } from "@/lib/hooks/use-duel-websocket";
import {
  addPracticeBot,
  archiveDuel,
  cancelDuel,
  duelRoomKey,
  getDuelRoom,
  joinDuel,
  sendDuelAction,
  setDuelDeck,
  startDuel,
  surrenderDuel,
} from "./api";
import { DeckEditor } from "./deck-editor";
import { DeckMasterRail, DuelField } from "./field";
import styles from "./room.module.css";
import { CardActionMenu, CardHoverInfo } from "./card-interactions";
import { DuelFeedback } from "./feedback";
import { useDuelPreferences } from "./preferences";
import { CardInspector, type InspectTarget } from "./inspector";
import {
  activatePromptFromField,
  optionsForCard,
  PromptTray,
  promptLegalKeys,
  promptSelectedKeys,
  usePromptDraft,
} from "./prompts";
import { phaseLabel, zoneKey } from "./constants";

function copyInvite(slug: string): Promise<void> {
  const url = `${window.location.origin}/duels/${slug}`;
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(url);
  return Promise.reject(new Error("Clipboard unavailable"));
}

function RoomLobby({
  room,
  slug,
  busy,
  actionError,
  onJoin,
  onAddBot,
  onReady,
  onStart,
  onCancel,
}: {
  room: DuelRoom;
  slug: string;
  busy: boolean;
  actionError: string | null;
  onJoin: () => void;
  onAddBot: () => void;
  onReady: (deck: DuelDeck) => void;
  onStart: () => void;
  onCancel: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const session = room.session;
  const mySeat = room.mySeat;
  const occupied = session.seats.length;
  const readyCount = session.seats.filter((seat) => seat.ready).length;
  const myMeta = mySeat != null ? session.seats.find((seat) => seat.seat === mySeat) : undefined;
  const isOrganizer = myMeta?.playerId === session.organizerPlayerId;
  const canStart = isOrganizer && occupied >= 2 && readyCount >= 2 && session.status === "lobby";

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-text-muted">
            {session.mode === "domain" ? "Domain 1v1 · singleton" : `Master Rule ${session.masterRule}`} · Lobby
          </p>
          <h1 className="font-display text-2xl text-text-primary">{session.name}</h1>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              copyInvite(slug)
                .then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 2000);
                })
                .catch(() => {});
            }}
          >
            {copied ? "Copied" : "Copy invite"}
          </Button>
          <Link href="/duels" className="inline-flex h-8 items-center px-3 text-sm text-text-secondary">
            All tables
          </Link>
        </div>
      </div>

      <ul className="divide-y divide-border border border-border">
        {[0, 1].map((seat) => {
          const taken = session.seats.find((item) => item.seat === seat);
          return (
            <li key={seat} className="flex items-center justify-between px-3 py-3 text-sm">
              <span>
                Seat {seat + 1}
                {taken ? ` · ${taken.displayName}` : " · open"}
              </span>
              <span className="text-xs uppercase tracking-wide text-text-muted">
                {taken?.ready ? "Ready" : taken ? "Deck needed" : "Waiting"}
              </span>
            </li>
          );
        })}
      </ul>

      {isOrganizer && occupied < 2 ? (
        <div className="space-y-2">
          <Button type="button" variant="secondary" loading={busy} disabled={busy} onClick={onAddBot}>
            Add practice bot
          </Button>
          <p className="text-sm text-text-secondary">
            Play solo against a basic bot with a supplied {session.mode === "domain" ? "Domain" : "40-card"} deck.
            It makes legal moves automatically; it is not a competitive AI.
          </p>
        </div>
      ) : null}

      {mySeat != null ? (
        <p className="text-sm text-text-secondary" role="status">
          {myMeta?.ready
            ? "Your deck is ready. Both seats must be ready before the organizer starts."
            : "Import your deck, then click Ready with this deck. Deck needed means no valid deck has been submitted yet."}
        </p>
      ) : null}
      {actionError ? <p role="alert" className="text-sm text-accent-cta">{actionError}</p> : null}

      {mySeat == null ? (
        <Button type="button" loading={busy} disabled={busy || occupied >= 2} onClick={onJoin}>
          Join table
        </Button>
      ) : (
        <DeckEditor
          mode={session.mode}
          initial={room.myDeck}
          busy={busy}
          onReady={onReady}
        />
      )}

      {canStart ? (
        <Button type="button" loading={busy} disabled={busy} onClick={onStart}>
          Start duel
        </Button>
      ) : isOrganizer ? (
        <p className="text-sm text-text-secondary">Start unlocks when both seats are ready.</p>
      ) : null}
      {isOrganizer ? (
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>Cancel table</Button>
      ) : null}

    </div>
  );
}

function ResultBanner({
  room,
  onClose,
}: {
  room: DuelRoom;
  onClose: () => void;
}) {
  const result = room.engine?.result;
  const reason = result?.reason ?? room.session.resultReason ?? "Duel ended";
  let headline = room.session.status === "interrupted" ? "Duel interrupted"
    : room.session.status === "cancelled" ? "Table cancelled" : "Draw";
  const winnerSeat = result?.winnerSeat ?? room.session.winnerSeat;
  if (winnerSeat != null) {
    const winner = room.session.seats.find((seat) => seat.seat === winnerSeat);
    headline = winner ? `${winner.displayName} wins` : `Seat ${winnerSeat + 1} wins`;
  }
  return (
    <Modal open onClose={onClose} title="Result">
      <p className="font-display text-2xl text-text-primary">{headline}</p>
      <p className="mt-2 text-sm text-text-secondary">{reason}</p>
      <div className="mt-4 flex gap-2">
        <Link href="/duels">
          <Button type="button">Back to tables</Button>
        </Link>
        <Button type="button" variant="ghost" onClick={onClose}>
          Stay
        </Button>
      </div>
    </Modal>
  );
}

type CardMenuState = {
  anchor: HTMLElement;
  title: string;
  options: DuelPromptOption[];
  promptId: string;
  revision: number;
};

const PHASES = [
  { label: "DP", name: "Draw" },
  { label: "SP", name: "Standby" },
  { label: "M1", name: "Main 1" },
  { label: "BP", name: "Battle", action: "to_bp" },
  { label: "M2", name: "Main 2", action: "to_m2" },
  { label: "EP", name: "End", action: "to_ep" },
];

export function DuelRoomView({ slug }: { slug: string }) {
  const realtimeConnected = useRef(false);
  const { data, error, isLoading, mutate } = useSWR(
    slug ? duelRoomKey(slug) : null,
    () => getDuelRoom(slug),
    { refreshInterval: () => realtimeConnected.current ? 10_000 : 1000, revalidateOnFocus: true, revalidateOnReconnect: true },
  );
  const refreshRoom = useCallback(
    () => mutate(() => getDuelRoom(slug), { revalidate: false }),
    [mutate, slug],
  );
  const realtime = useDuelWebsocket(slug, data?.mySeat, refreshRoom);
  realtimeConnected.current = realtime.connected;
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [inspect, setInspect] = useState<InspectTarget | null>(null);
  const [pane, setPane] = useState<"card" | "log" | "options">("card");
  const [mobileInspect, setMobileInspect] = useState(false);
  const [confirmSurrender, setConfirmSurrender] = useState(false);
  const [hideResult, setHideResult] = useState(false);
  const [menu, setMenu] = useState<CardMenuState | null>(null);
  const [hover, setHover] = useState<{ card: DuelCard; anchor: HTMLElement } | null>(null);
  const preferences = useDuelPreferences();
  const prompt = data?.engine?.prompt ?? null;
  const draft = usePromptDraft(prompt);
  const legalKeys = useMemo(() => promptLegalKeys(prompt), [prompt]);
  const selectedKeys = useMemo(() => promptSelectedKeys(prompt, draft.selected), [draft.selected, prompt]);
  const closeMenu = useCallback(() => setMenu(null), []);
  const activeMenu = !busy && !error && menu?.promptId === prompt?.id &&
    menu?.revision === data?.engine?.revision ? menu : null;

  useEffect(() => {
    setMenu(null);
    setHover(null);
  }, [prompt?.id, data?.engine?.revision]);

  useEffect(() => {
    setInspect(null);
    setHideResult(false);
    setMobileInspect(false);
    setActionError(null);
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

  const onSubmitAnswer = useCallback(
    (answer: DuelAnswer) => {
      if (!data?.engine || !prompt || error || data.mySeat !== prompt.seat ||
          data.session.status !== "active" || inFlight.current) return;
      const command = { promptId: prompt.id, revision: data.engine.revision, answer };
      void run(() => sendDuelAction(slug, command));
    },
    [data, prompt, error, run, slug],
  );

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

  function onFieldActivate(keys: string[], card: DuelCard | null, anchor: HTMLElement, preserveInspector = false) {
    setHover(null);
    if (card && !preserveInspector) showInspector({ type: "card", card });
    if (busy || error) return;
    const mine = prompt != null && data?.mySeat != null && prompt.seat === data.mySeat;
    if (mine && (prompt.kind === "choice" || prompt.kind === "toggle")) {
      const options = optionsForCard(prompt, card, keys);
      if (prompt.kind === "toggle" && options.length === 1) {
        onSubmitAnswer({ choice: options[0].id });
        return;
      }
      if (options.length && data?.engine) {
        setMenu({ anchor, title: card?.name ?? "Card", options, promptId: prompt.id, revision: data.engine.revision });
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
  if (data.session.status === "lobby") {
    return (
      <RoomLobby room={data} slug={slug} busy={busy} actionError={actionError}
        onJoin={() => void run(() => joinDuel(slug))}
        onAddBot={() => void run(() => addPracticeBot(slug))}
        onReady={(deck) => void run(() => setDuelDeck(slug, deck))}
        onStart={() => void run(() => startDuel(slug))}
        onCancel={() => void run(() => cancelDuel(slug))}
      />
    );
  }

  const engine = data.engine;
  const localSeat = data.mySeat ?? 0;
  const bottom = engine?.seats.find((seat) => seat.seat === localSeat);
  const top = engine?.seats.find((seat) => seat.seat !== localSeat);
  const mine = prompt != null && prompt.seat === data.mySeat;
  const canAct = mine && !busy && !error && data.session.status === "active";
  const canSurrender = data.session.status === "active" && data.mySeat != null && !engine?.result;
  const terminal = data.session.status !== "active";
  const isOrganizer = data.session.seats.some((seat) =>
    seat.seat === data.mySeat && seat.playerId === data.session.organizerPlayerId);
  const canArchive = terminal && isOrganizer && !data.session.archivedAt;
  const showResult = !hideResult && (engine?.result != null || terminal);
  const domain = data.session.mode === "domain";
  const actionOptions = prompt?.context?.type === "action" ? prompt.options : [];
  const playerName = (seat: number) => data.session.seats.find((player) => player.seat === seat)?.displayName ?? `Player ${seat + 1}`;
  const inspector = (
    <CardInspector target={inspect}
      onInspectCard={(card) => setInspect({ type: "card", card })}
      onActivateCard={onInspectorActivate}
    />
  );
  const sideContent = pane === "card" ? inspector : pane === "log" ? (
    <ol className={styles.log} aria-label="Duel log">
      {engine?.log.map((entry) => <li key={entry.id}>{entry.text}</li>)}
    </ol>
  ) : (
    <div className={styles.options}>
      <h2>Presentation</h2>
      <label className={styles.soundOption}>
        <span>Sound effects</span>
        <input type="checkbox" checked={preferences.soundEnabled}
          onChange={(event) => preferences.setSoundEnabled(event.target.checked)} />
      </label>
      <label className="flex flex-col gap-2">Motion
        <select value={preferences.motion}
          onChange={(event) => preferences.setMotion(event.target.value as typeof preferences.motion)}>
          <option value="system">Use device setting</option>
          <option value="reduced">Reduced motion</option>
          <option value="full">Full motion</option>
        </select>
      </label>
      <p>Effects never pause the duel or submit a response.</p>
      {actionOptions.filter((option) => option.id === "shuffle").map((option) => (
        <Button key={option.id} type="button" size="sm" variant="secondary" disabled={!canAct}
          onClick={() => onSubmitAnswer({ choice: option.id })}>{option.label}</Button>
      ))}
      <h2>Connection</h2>
      <p role="status">{realtime.connected ? "Live updates connected." : "Reconnecting live updates; polling for the latest state."}</p>
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
      {data.session.archivedAt ? <p>Archived. The result and saved final board remain in match history.</p> : null}
      <Link href="/duels">Back to tables</Link>
    </div>
  );
  const tabs = (mobile = false) => (
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
      {(mobile ? (["card", "log", "options"] as const) : (["card", "log"] as const)).map((tab) => (
        <button key={tab} type="button" role={mobile ? undefined : "tab"}
          aria-selected={mobile ? undefined : pane === tab} aria-haspopup={mobile ? "dialog" : undefined}
          tabIndex={mobile || pane === tab || (!mobile && pane === "options" && tab === "card") ? 0 : -1}
          onClick={() => { setPane(tab); if (mobile) setMobileInspect(true); }}>
          {tab[0].toUpperCase() + tab.slice(1)}
        </button>
      ))}
    </div>
  );

  return (
    <div className={`${styles.shell} -mx-4 -my-4 sm:-mx-6 sm:-my-6 lg:-mx-8 lg:-my-8`} data-domain={domain}>
      <header className={styles.header}>
        <div className={styles.identity}><Link href="/duels">Yugidraft</Link><span>{domain ? "Domain" : `MR${data.session.masterRule}`} · 1v1</span></div>
        <div className={styles.turn}><strong>Turn {engine?.turn ?? "—"}</strong><span>{phaseLabel(engine?.phase)}</span></div>
        <div className={styles.status}>
          <span className={styles.pref} role="status">
            {data.mySeat == null ? "Watching" : realtime.connected ? "Live" : "Polling"}
          </span>
          <span className={styles.pref}>{preferences.soundEnabled ? "Sound on" : "Sound off"}</span>
          <span className={styles.pref}>
            {preferences.motion === "full"
              ? "Motion full"
              : preferences.motion === "reduced"
                ? "Motion reduced"
                : "Motion device"}
          </span>
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
            <Settings size={22} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      </header>
      {error ? <div className={styles.error} role="alert">Connection lost. Actions paused until reconnected.
        <button type="button" onClick={() => void mutate()}>Retry</button></div> : null}
      {actionError ? <div className={styles.error} role="alert">{actionError}</div> : null}
      {data.error ? <div className={styles.error} role="alert">{data.error}</div> : null}
      <div className={styles.layout}>
        <aside className={styles.inspector}>
          <span className={styles.chamfer} aria-hidden="true" />
          {tabs()}
          <div className={styles.sideContent} role="tabpanel" aria-label={pane}>{sideContent}</div>
        </aside>
        <section className={styles.boardColumn} aria-label="Duel field">
          <div className={styles.board}>
            {engine ? (
              <>
                <DuelField engine={engine} mySeat={data.mySeat} masterRule={data.session.masterRule}
                  legalKeys={legalKeys} selectedKeys={selectedKeys} onActivate={onFieldActivate}
                  onHoverCard={onHoverCard} onInspect={(target) => showInspector(target, true)}
                  bottomName={playerName(localSeat)}
                  topName={playerName(top?.seat ?? 1 - localSeat)} />
                {!error ? <DuelFeedback events={engine.events} duelKey={slug}
                  soundEnabled={preferences.soundEnabled} reducedMotion={preferences.reducedMotion} /> : null}
              </>
            ) : <p className="p-4">{data.session.status === "active" ? "Waiting for engine view…" : "No saved final board is available for this record."}</p>}
          </div>
          <nav className={styles.phases} aria-label="Duel phases">
            {PHASES.map((phase) => {
              const action = actionOptions.find((option) => option.id === phase.action);
              return <button key={phase.label} type="button" aria-label={action?.label ?? phase.name}
                aria-current={phaseLabel(engine?.phase) === phase.name ? "step" : undefined}
                disabled={!canAct || !action} onClick={() => action && onSubmitAnswer({ choice: action.id })}>
                {phase.label}
              </button>;
            })}
          </nav>
          {engine?.chain.length ? (
            <section className={styles.chain} aria-label="Current chain">
              <strong>Chain · resolves highest link first</strong>
              <ol>{engine.chain.map((link) => (
                <li key={link.index}><b>{link.index}</b><span>{link.name ?? "Effect"}<small>{playerName(link.seat)}{link.description ? ` · ${link.description}` : ""}</small></span></li>
              ))}</ol>
            </section>
          ) : null}
          <div
            className={styles.promptDock}
            data-idle={
              !(
                prompt != null &&
                data.mySeat != null &&
                prompt.seat === data.mySeat &&
                data.session.status === "active" &&
                !(prompt.kind === "choice" && prompt.context?.type === "action")
              )
                ? "true"
                : "false"
            }
          >
            <PromptTray prompt={prompt} mySeat={data.mySeat} slug={slug} busy={busy || Boolean(error)}
              draft={draft} onSubmit={onSubmitAnswer} menuOpen={Boolean(activeMenu)}
              active={data.session.status === "active"} />
          </div>
        </section>
        {domain && engine ? <aside className={styles.masters} aria-label="Deck Masters">
          <DeckMasterRail engine={engine} mySeat={data.mySeat} legalKeys={legalKeys}
            selectedKeys={selectedKeys} canAct={canAct}
            legalActionsFor={(card, keys) =>
              canAct && prompt?.kind === "choice" && prompt.context?.type === "action"
                ? optionsForCard(prompt, card, keys)
                : []
            }
            onChooseAction={(option) => onSubmitAnswer({ choice: option.id })}
            onActivate={onFieldActivate}
            onHoverCard={onHoverCard} onInspect={(target) => showInspector(target, true)} />
        </aside> : null}
      </div>
      <div className={styles.mobileBar}>{tabs(true)}</div>
      {activeMenu ? <CardActionMenu anchor={activeMenu.anchor} title={activeMenu.title}
        options={activeMenu.options} busy={busy} onClose={closeMenu}
        onChoose={(option) => {
          if (activeMenu.promptId !== prompt?.id || activeMenu.revision !== engine?.revision) return;
          closeMenu();
          onSubmitAnswer({ choice: option.id });
        }} /> : null}
      {hover && !activeMenu && !mobileInspect ? <CardHoverInfo card={hover.card} anchor={hover.anchor} /> : null}
      <Sheet open={mobileInspect} onClose={() => setMobileInspect(false)} title={pane === "card" ? "Card" : pane === "log" ? "Duel log" : "Options"}>
        {sideContent}
      </Sheet>
      <Modal open={confirmSurrender} onClose={() => setConfirmSurrender(false)} title="Surrender">
        <p className="text-sm text-text-secondary">This ends the duel. Confirm surrender?</p>
        <div className="mt-4 flex gap-2">
          <Button type="button" variant="danger" loading={busy} onClick={() => {
            setConfirmSurrender(false);
            void run(() => surrenderDuel(slug));
          }}>Surrender</Button>
          <Button type="button" variant="ghost" onClick={() => setConfirmSurrender(false)}>Keep playing</Button>
        </div>
      </Modal>
      {showResult ? <ResultBanner room={data} onClose={() => setHideResult(true)} /> : null}
    </div>
  );
}
