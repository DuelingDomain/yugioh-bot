"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import type { DuelMasterRule, DuelMode, DuelSession } from "@yugidraft/shared/duels";
import { Button } from "@/components/ui/button";
import { createDuel, DUEL_LIST_KEY, DuelRequestError, listDuels } from "./api";

function statusLabel(status: DuelSession["status"]): string {
  if (status === "lobby") return "Lobby";
  if (status === "active") return "Dueling";
  if (status === "completed") return "Finished";
  if (status === "cancelled") return "Cancelled";
  return "Interrupted";
}

export function DuelLobby() {
  const router = useRouter();
  const [history, setHistory] = useState(false);
  const { data, error, isLoading, mutate } = useSWR(
    history ? `${DUEL_LIST_KEY}?archived=1` : DUEL_LIST_KEY,
    () => listDuels(history),
    { refreshInterval: history ? 0 : 1000, revalidateOnFocus: true },
  );
  const [name, setName] = useState("Table");
  const [mode, setMode] = useState<DuelMode>("normal");
  const [masterRule, setMasterRule] = useState<DuelMasterRule>(5);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const duels = data?.duels ?? [];

  async function onCreate() {
    setCreating(true);
    setCreateError(null);
    try {
      const result = await createDuel(name.trim() || "Table", mode, mode === "domain" ? 5 : masterRule);
      await mutate();
      router.push(`/duels/${result.session.slug}`);
    } catch (err) {
      setCreateError(err instanceof DuelRequestError || err instanceof Error ? err.message : "Could not open table");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="font-display text-3xl text-text-primary">Duels</h1>
        <p className="mt-1 text-sm text-text-secondary">1v1 tables.</p>
      </header>

      <form
        className="space-y-4 rounded-none border border-border bg-bg-surface p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void onCreate();
        }}
      >
        <h2 className="font-display text-lg text-text-primary">Open a table</h2>
        <label className="block text-sm">
          <span className="mb-1 block text-xs uppercase tracking-wide text-text-muted">Table name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="h-11 w-full rounded-md border border-border bg-bg-deep px-3 text-sm text-text-primary"
            required
          />
        </label>
        <fieldset className="space-y-2">
          <legend className="text-xs uppercase tracking-wide text-text-muted">Format</legend>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="radio"
              name="mode"
              checked={mode === "normal"}
              onChange={() => setMode("normal")}
            />
            Standard · Master Rules
          </label>
          {mode === "normal" ? (
            <label className="block text-sm">
              <span className="mb-1 block text-xs uppercase tracking-wide text-text-muted">Master Rule</span>
              <select value={masterRule} onChange={(event) => setMasterRule(Number(event.target.value) as DuelMasterRule)}
                className="h-11 w-full rounded-md border border-border bg-bg-deep px-3 text-sm text-text-primary">
                <option value={5}>Master Rule 5 — default</option>
                <option value={4}>Master Rule 4</option>
                <option value={3}>Master Rule 3</option>
                <option value={2}>Master Rule 2</option>
                <option value={1}>Master Rule 1</option>
              </select>
              <span className="mt-1 block text-xs text-text-muted">Native gameplay rules with the current card catalog. No historical banlist.</span>
            </label>
          ) : null}
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="radio"
              name="mode"
              checked={mode === "domain"}
              onChange={() => setMode("domain")}
            />
            Domain 1v1 · singleton
          </label>
        </fieldset>
        {createError ? <p className="text-sm text-accent-cta">{createError}</p> : null}
        <Button type="submit" loading={creating} disabled={creating}>
          Create table
        </Button>
      </form>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-lg text-text-primary">{history ? "Match history" : "Live tables"}</h2>
          <Button type="button" size="sm" variant="secondary" onClick={() => setHistory(!history)}>
            {history ? "Live tables" : "Match history"}
          </Button>
        </div>
        <p className="text-sm text-text-secondary">
          {history ? "Archived results and saved final boards." : "Return to your seat or watch a game. Finished tables move to history automatically."}
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
        {!isLoading && duels.length === 0 ? (
          <p className="rounded-none border border-border bg-bg-surface px-4 py-8 text-center text-sm text-text-secondary">
            {history ? "No archived games yet." : "No live tables. Open one above."}
          </p>
        ) : (
          <ul className="divide-y divide-border border border-border">
            {duels.map((duel) => (
              <li key={duel.slug}>
                <Link
                  href={`/duels/${duel.slug}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-bg-elevated"
                >
                  <span>
                    <span className="block font-display text-text-primary">{duel.name}</span>
                    <span className="text-xs uppercase tracking-wide text-text-muted">
                      {duel.mode === "domain" ? "Domain 1v1" : `Master Rule ${duel.masterRule}`} · {statusLabel(duel.status)} ·{" "}
                      {duel.seats.length}/2
                    </span>
                  </span>
                  <span className="text-xs text-accent-gold">{history ? "Review" : duel.status === "active" ? "Open / watch" : "Open"}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
