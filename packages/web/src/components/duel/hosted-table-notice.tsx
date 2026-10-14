"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { cancelWaitingDuel, getHostedWaitingTable } from "./api";
import { SheetButton } from "./sheet-ui";
import ui from "./sheet-ui.module.css";
import styles from "./creator.module.css";

export function HostedTableNotice({ disabled, refreshVersion = 0, onCancelled }: {
  disabled: boolean; refreshVersion?: number; onCancelled?: (slug: string) => void;
}) {
  const [table, setTable] = useState<Awaited<ReturnType<typeof getHostedWaitingTable>>["table"]>(null);
  const [cancelVersion, setCancelVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const sequence = useRef(0);
  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      const request = ++sequence.current;
      try {
        const result = await getHostedWaitingTable();
        if (!disposed && request === sequence.current) setTable(result.table);
      } catch { /* Creation still checks the current table on the server. */ }
    };
    void refresh();
    window.addEventListener("pageshow", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("popstate", refresh);
    return () => {
      disposed = true;
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("popstate", refresh);
    };
  }, [refreshVersion, cancelVersion]);

  async function cancel() {
    if (!table || !table.canCancel || inFlight.current || disabled) return;
    inFlight.current = true;
    ++sequence.current;
    setBusy(true);
    setError(null);
    try {
      await cancelWaitingDuel(table.slug);
      ++sequence.current;
      setTable(null);
      setCancelVersion(version => version + 1);
      onCancelled?.(table.slug);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not cancel the table.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  if (!table) return null;
  return <aside className={styles.openTable} aria-label="Your open table">
    <p>{table.reason === "challenge" ? <>
      Your challenge to {table.opponentName ?? "your opponent"} is still open: <Link href={`/duels/${table.slug}`}>{table.name}</Link>.
      {" Creating a new game will keep this challenge open."}
    </> : <>
      You already have an open table: <Link href={`/duels/${table.slug}`}>{table.name}</Link>. {table.canReplace === false
        ? "Another player has joined or the game has started. Return to this table before creating a new game."
        : "Creating a new game will close it."}
    </>}</p>
    <SheetButton kind="quiet" size="sm" disabled={disabled || busy || !table.canCancel} loading={busy} onClick={() => void cancel()}>Cancel table</SheetButton>
    {error ? <p role="alert" className={ui.alert}>{error}</p> : null}
  </aside>;
}
