"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { remoteBlocksReport, type RemoteResult } from "../remote-result";
import { remoteErrorText } from "../remote-copy";

/** How often an open result is read again, so the other player's answer shows without a reload. */
export const REMOTE_RESULT_POLL_MS = 20_000;

type Busy = "confirm" | "dispute" | null;

function endpoint(tournamentSlug: string, tournamentMatchId: number) {
  return `/api/tournaments/${encodeURIComponent(tournamentSlug)}/matches/${tournamentMatchId}/remote-result`;
}

/** The result in a response, plus the server clock (`now`, beside `remoteResult` on the GET). */
async function readResult(res: Response): Promise<{ result: RemoteResult | null; serverNow: number | null } | undefined> {
  const data = await res.json().catch(() => null);
  if (!data || typeof data !== "object" || !("remoteResult" in data)) return undefined;
  const read = (data.remoteResult as RemoteResult | null) ?? null;
  // A table that ended with no result (idle close, creator left) leaves a `playing` row with no live table: the slot is open again.
  const result = read && read.status === "playing" && read.tableOpen === false ? null : read;
  const stamp = typeof data.now === "number" && Number.isFinite(data.now) ? data.now : null;
  return { result, serverNow: stamp };
}

/**
 * The Remote result of one slot, for a paired player or the organizer. A missing route or a bad answer
 * reads as "no Remote result", so the slot keeps the manual report. `enabled` false does no request.
 */
export function useRemoteResult({ tournamentSlug, tournamentMatchId, enabled, refreshKey, onChanged }: {
  tournamentSlug: string | null;
  tournamentMatchId: number;
  enabled: boolean;
  /** Changes when the slot changes elsewhere (its status or result time), so the result is read again. */
  refreshKey?: string;
  onChanged?: () => void;
}) {
  const [result, setResult] = useState<RemoteResult | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Server clock minus browser clock, from the last read; 0 when the server sent no `now`.
  const [clockOffset, setClockOffset] = useState(0);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const changed = useRef(onChanged);
  useEffect(() => { changed.current = onChanged; });

  // Newest status seen, so a result that closes elsewhere (final, void, organizer ruling) tells the parent to reload.
  const lastStatus = useRef<RemoteResult["status"] | null>(null);
  const apply = useCallback((next: { result: RemoteResult | null; serverNow: number | null }) => {
    const wasOpen = lastStatus.current === "proposed" || lastStatus.current === "disputed" || lastStatus.current === "playing";
    lastStatus.current = next.result?.status ?? null;
    setResult(next.result);
    setClockOffset(next.serverNow === null ? 0 : next.serverNow - Date.now());
    if (wasOpen && !remoteBlocksReport(next.result)) changed.current?.();
  }, []);

  // A slot that is not open for a Remote answer holds no result: a ruled or reset slot drops its old panel.
  useEffect(() => {
    if (enabled) return;
    lastStatus.current = null;
    setResult(null);
    // Enabled again later (a reopened slot): wait for the new read before Start and Report show.
    setLoaded(false);
  }, [enabled]);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!enabled || !tournamentSlug) return;
    try {
      const res = await fetch(endpoint(tournamentSlug, tournamentMatchId), { cache: "no-store", signal });
      if (signal?.aborted) return;
      if (!res.ok) { apply({ result: null, serverNow: null }); return; }
      const next = await readResult(res);
      if (signal?.aborted) return;
      apply(next ?? { result: null, serverNow: null });
    } catch {
      // A network failure keeps what is on screen; the next poll tries again.
    } finally {
      if (!signal?.aborted) setLoaded(true);
    }
  }, [enabled, tournamentSlug, tournamentMatchId, apply]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, refreshKey]);

  const open = remoteBlocksReport(result);
  useEffect(() => {
    if (!enabled || !open) return;
    const timer = setInterval(() => void load(), REMOTE_RESULT_POLL_MS);
    return () => clearInterval(timer);
  }, [enabled, open, load]);

  async function send(action: "confirm" | "dispute", body: object) {
    if (!tournamentSlug) return;
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`${endpoint(tournamentSlug, tournamentMatchId)}/${action}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const fallback = action === "confirm" ? "Failed to confirm the result" : "Failed to dispute the result";
        setError(typeof data?.error === "string" ? remoteErrorText(data.code, data.error) : fallback);
        // A 409 means the slot moved on (final, ruled, reopened): read it again and let the page reload too.
        void load();
        if (res.status === 409) changed.current?.();
        return;
      }
      const next = await readResult(res);
      if (next !== undefined) apply(next);
      changed.current?.();
    } catch {
      setError(action === "confirm" ? "Failed to confirm the result" : "Failed to dispute the result");
    } finally {
      setBusy(null);
    }
  }

  return {
    result, busy, error, clockOffset,
    // A slot with no Remote request has nothing to wait for.
    loaded: loaded || !enabled,
    refresh: () => load(),
    confirm: () => send("confirm", {}),
    dispute: (note: string) => send("dispute", note.trim() ? { note: note.trim() } : {}),
  };
}

export type RemoteResultState = ReturnType<typeof useRemoteResult>;
