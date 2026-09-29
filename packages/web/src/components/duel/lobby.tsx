"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { isCustomDomain, type DuelHistoryScope, type DuelListItem } from "@yugidraft/shared/duels";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { DUEL_LIST_KEY, cancelDuel, leaveDuel, listDuels, surrenderDuel } from "./api";

export type DuelListView = "live" | "history";

function statusLabel(status: DuelListItem["status"]): string {
  if (status === "lobby") return "Lobby";
  if (status === "active") return "Dueling";
  if (status === "completed") return "Finished";
  if (status === "cancelled") return "Cancelled";
  return "Interrupted";
}

function modeLabel(duel: DuelListItem): string {
  if (duel.mode === "domain") return isCustomDomain(duel.masterRule, duel.settings) ? "Custom Domain" : "Domain 1v1";
  return `Master Rule ${duel.masterRule}`;
}

function parseUtc(text: string | null): Date | null {
  if (!text) return null;
  const date = new Date(`${text.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function relativeActivity(text: string): string {
  const date = parseUtc(text);
  if (!date) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "active just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `active ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `active ${hours}h ago`;
  return `active ${Math.floor(hours / 24)}d ago`;
}

function formatDate(text: string | null): string {
  const date = parseUtc(text);
  return date ? date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";
}

function isOrganizer(duel: DuelListItem): boolean {
  const mine = duel.seats.find((seat) => seat.seat === duel.mySeat);
  return mine != null && duel.organizerPlayerId === mine.playerId;
}

function outcomeLabel(duel: DuelListItem): string {
  if (duel.status === "interrupted") return "Interrupted";
  if (duel.winnerSeat == null) return "Draw";
  if (duel.mySeat != null) return duel.winnerSeat === duel.mySeat ? "Won" : "Lost";
  const winner = duel.seats.find((seat) => seat.seat === duel.winnerSeat);
  return `${winner?.displayName ?? `Seat ${duel.winnerSeat + 1}`} won`;
}

function outcomeTone(label: string): string {
  if (label === "Won") return "text-accent-gold";
  if (label === "Lost") return "text-accent-cta";
  return "text-text-secondary";
}

function opponents(duel: DuelListItem): string {
  const others = duel.seats.filter((seat) => seat.seat !== duel.mySeat);
  return others.map((seat) => seat.displayName).join(" vs ") || "No opponent";
}

type CloseCopy = {
  title: string;
  body: string;
  confirm: string;
  danger: boolean;
  run: (slug: string) => Promise<unknown>;
};

function closeCopy(duel: DuelListItem): CloseCopy {
  if (duel.status === "active") {
    return {
      title: "Surrender and close",
      body: "This ends the duel as a loss for you and moves it to Match history.",
      confirm: "Surrender",
      danger: true,
      run: surrenderDuel,
    };
  }
  if (isOrganizer(duel)) {
    return {
      title: "Cancel table",
      body: "This removes the table. No result is recorded.",
      confirm: "Cancel table",
      danger: false,
      run: cancelDuel,
    };
  }
  return {
    title: "Leave table",
    body: "You give up your seat. The organizer keeps the table.",
    confirm: "Leave table",
    danger: false,
    run: leaveDuel,
  };
}

const tagClass = "border border-border px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-accent-gold";
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary";

function LiveRow({ duel, onClose }: { duel: DuelListItem; onClose: (duel: DuelListItem) => void }) {
  const own = duel.mySeat != null;
  return (
    <li className="flex items-stretch hover:bg-bg-elevated">
      <Link href={`/duels/${duel.slug}`} className={`flex min-w-0 flex-1 items-center justify-between gap-3 px-4 py-3 ${focusRing}`}>
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="break-words font-display text-text-primary">{duel.name}</span>
            {own ? <span className={tagClass}>Your table</span> : null}
          </span>
          <span className="block text-xs uppercase tracking-wide text-text-muted">
            {modeLabel(duel)} · {statusLabel(duel.status)} · {duel.seats.length}/2
            {duel.settings.visibility === "private" ? " · Private" : ""}
          </span>
          <span className="block text-xs text-text-muted">{relativeActivity(duel.lastActivityAt)}</span>
        </span>
        <span className="shrink-0 text-sm font-semibold text-accent-gold">{own ? "Return" : "Watch"}</span>
      </Link>
      {own ? (
        <div className="flex items-center pr-3">
          <Button type="button" size="sm" variant="ghost" onClick={() => onClose(duel)}
            aria-label={`Close ${duel.name}`}>
            Close
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function HistoryRow({ duel }: { duel: DuelListItem }) {
  const outcome = outcomeLabel(duel);
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0 flex-1 basis-56">
        <p className="break-words font-display text-text-primary">{duel.name}</p>
        <p className="text-xs uppercase tracking-wide text-text-muted">
          {modeLabel(duel)}{duel.endedAt ? ` · ${formatDate(duel.endedAt)}` : ""}
        </p>
        <p className="text-sm text-text-secondary">
          {duel.mySeat != null ? "vs " : ""}{opponents(duel)}
        </p>
        <p className="text-sm">
          <span className={`font-semibold ${outcomeTone(outcome)}`}>{outcome}</span>
          {duel.resultReason ? <span className="text-text-muted"> · {duel.resultReason}</span> : null}
        </p>
      </div>
      <div className="flex gap-2">
        <Link href={`/duels/${duel.slug}/replay`}
          className={`inline-flex h-8 items-center bg-accent-primary px-3 text-sm font-semibold text-white hover:brightness-110 ${focusRing}`}>
          Replay
        </Link>
        <Link href={`/duels/${duel.slug}`}
          className={`inline-flex h-8 items-center border border-border px-3 text-sm font-semibold text-text-primary hover:bg-bg-elevated ${focusRing}`}>
          Final board
        </Link>
      </div>
    </li>
  );
}

export function DuelLobby({ initialView = "live" }: { initialView?: DuelListView }) {
  const [history, setHistory] = useState(initialView === "history");
  const [scope, setScope] = useState<DuelHistoryScope>("mine");
  const [closing, setClosing] = useState<DuelListItem | null>(null);
  const [closeBusy, setCloseBusy] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const { data, error, isLoading, mutate } = useSWR(
    history ? `${DUEL_LIST_KEY}?archived=1&scope=${scope}` : DUEL_LIST_KEY,
    () => listDuels(history, scope),
    { refreshInterval: history ? 0 : 1000, revalidateOnFocus: true },
  );

  const duels = data?.duels ?? [];
  const copy = closing ? closeCopy(closing) : null;

  function dismiss() {
    if (closeBusy) return;
    setClosing(null);
    setCloseError(null);
  }

  async function confirmClose() {
    if (!closing || !copy || closeBusy) return;
    setCloseBusy(true);
    setCloseError(null);
    try {
      await copy.run(closing.slug);
      setClosing(null);
      await mutate();
    } catch (err) {
      setCloseError(err instanceof Error ? err.message : "Could not close this table.");
    } finally {
      setCloseBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-text-primary">Duels</h1>
          <p className="mt-1 text-sm text-text-secondary">Automated 1v1 tables.</p>
        </div>
        <Link href="/duels/new" className="inline-flex min-h-11 items-center bg-accent-primary px-5 font-display text-sm font-semibold text-white hover:brightness-110">
          Create game
        </Link>
      </header>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg text-text-primary">{history ? "Match history" : "Live tables"}</h2>
          <div className="flex flex-wrap items-center gap-2">
            {history ? (
              <div role="group" aria-label="History scope" className="flex border border-border">
                {(["mine", "all"] as const).map((value) => (
                  <button key={value} type="button" aria-pressed={scope === value} onClick={() => setScope(value)}
                    className={`h-8 px-3 text-sm font-semibold ${focusRing} ${
                      scope === value ? "bg-bg-elevated text-accent-gold" : "text-text-secondary hover:text-text-primary"}`}>
                    {value === "mine" ? "Mine" : "All"}
                  </button>
                ))}
              </div>
            ) : null}
            <Button type="button" size="sm" variant="secondary" onClick={() => setHistory(!history)}>
              {history ? "Live tables" : "Match history"}
            </Button>
          </div>
        </div>
        <p className="text-sm text-text-secondary">
          {history
            ? "Finished duels with replays and saved final boards."
            : "Your open tables and duels in progress. Finished duels move to Match history."}
        </p>
        {isLoading && !data ? <p className="text-sm text-text-secondary">Loading tables…</p> : null}
        {error && !data ? (
          <div className="space-y-2 text-sm">
            <p className="text-accent-cta">{error instanceof Error ? error.message : "Could not load duels."}</p>
            <Button type="button" size="sm" variant="secondary" onClick={() => void mutate()}>
              Retry
            </Button>
          </div>
        ) : null}
        {error && data ? (
          <p className="text-sm text-accent-gold">Connection dropped. Reconnecting…</p>
        ) : null}
        {!isLoading && data && duels.length === 0 ? (
          <p className="rounded-none border border-border bg-bg-surface px-4 py-8 text-center text-sm text-text-secondary">
            {history ? "No finished duels yet." : "No live duels right now."}
          </p>
        ) : duels.length > 0 ? (
          <ul className="divide-y divide-border border border-border bg-bg-surface">
            {duels.map((duel) => history
              ? <HistoryRow key={duel.slug} duel={duel} />
              : <LiveRow key={duel.slug} duel={duel} onClose={(item) => { setCloseError(null); setClosing(item); }} />)}
          </ul>
        ) : null}
      </section>

      <Modal open={closing != null} onClose={dismiss} title={copy?.title}>
        <p className="text-sm text-text-secondary">{copy?.body}</p>
        {closeError ? <p role="alert" className="mt-3 text-sm text-accent-cta">{closeError}</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant={copy?.danger ? "danger" : "primary"} loading={closeBusy} disabled={closeBusy}
            onClick={() => void confirmClose()}>
            {copy?.confirm}
          </Button>
          <Button type="button" variant="ghost" disabled={closeBusy} onClick={dismiss}>Keep table</Button>
        </div>
      </Modal>
    </div>
  );
}
