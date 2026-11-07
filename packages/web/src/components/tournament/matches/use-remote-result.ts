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

async function readResult(res: Response): Promise<RemoteResult | null | undefined> {
  const data = await res.json().catch(() => null);
  if (!data || typeof data !== "object" || !("remoteResult" in data)) return undefined;
  return (data.remoteResult as RemoteResult | null) ?? null;
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
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const changed = useRef(onChanged);
  useEffect(() => { changed.current = onChanged; });

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!enabled || !tournamentSlug) return;
    try {
      const res = await fetch(endpoint(tournamentSlug, tournamentMatchId), { cache: "no-store", signal });
      if (signal?.aborted) return;
      if (!res.ok) { setResult(null); return; }
      const next = await readResult(res);
      if (signal?.aborted) return;
      setResult(next ?? null);
    } catch {
      // A network failure keeps what is on screen; the next poll tries again.
    } finally {
      if (!signal?.aborted) setLoaded(true);
    }
  }, [enabled, tournamentSlug, tournamentMatchId]);

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
        void load();
        return;
      }
      const next = await readResult(res);
      if (next !== undefined) setResult(next);
      changed.current?.();
    } catch {
      setError(action === "confirm" ? "Failed to confirm the result" : "Failed to dispute the result");
    } finally {
      setBusy(null);
    }
  }

  return {
    result, loaded, busy, error,
    refresh: () => load(),
    confirm: () => send("confirm", {}),
    dispute: (note: string) => send("dispute", note.trim() ? { note: note.trim() } : {}),
  };
}

export type RemoteResultState = ReturnType<typeof useRemoteResult>;
