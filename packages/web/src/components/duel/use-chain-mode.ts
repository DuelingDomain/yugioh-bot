"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DuelChainMode } from "@yugidraft/shared/duels";
import {
  hotkeyTarget,
  isChainHotkey,
  loadRememberedChainMode,
  rememberChainMode,
  type RememberedChainMode,
} from "./chain-mode";

/** What the station track needs to draw the switch. Null from the hook means: draw nothing. */
export interface ChainModeControl {
  mode: DuelChainMode;
  onChange: (mode: DuelChainMode) => void;
}

interface Options {
  slug: string;
  /** The mode the server reports for the viewer's own seat; undefined for spectators, replays and scenario tables. */
  serverMode: DuelChainMode | undefined;
  /** The viewer is seated in a live duel that is still running. */
  enabled: boolean;
  /** A dialog or modal owns the keyboard. */
  suspended?: boolean;
  /** Sends one mode to the server and applies the room it returns. Throws when the server refuses. */
  send: (mode: DuelChainMode) => Promise<void>;
  onError: (message: string) => void;
}

/**
 * The state behind the chain response switch: an optimistic position while a request is out, one request in flight at a
 * time (the newest wish wins), the R shortcut, and the browser's remembered Auto or Always.
 */
export function useChainModeControl({ slug, serverMode, enabled, suspended = false, send, onError }: Options): ChainModeControl | null {
  const [pending, setPending] = useState<DuelChainMode | null>(null);
  const shown: DuelChainMode | null = serverMode === undefined ? null : pending ?? serverMode;
  const live = enabled && serverMode !== undefined;

  const lastOn = useRef<RememberedChainMode>("auto");
  const flying = useRef(false);
  // The newest wish with its own remember flag: a choice made while a restore is in flight must still be remembered.
  const wanted = useRef<{ mode: DuelChainMode; remember: boolean } | null>(null);
  const appliedFor = useRef<string | null>(null);
  const latest = useRef({ send, onError });
  latest.current = { send, onError };

  useEffect(() => {
    if (shown && shown !== "off") lastOn.current = shown;
  }, [shown]);

  const request = useCallback(async (mode: DuelChainMode, remember: boolean) => {
    wanted.current = { mode, remember };
    setPending(mode);
    if (flying.current) return;
    flying.current = true;
    try {
      while (wanted.current !== null) {
        const next = wanted.current;
        wanted.current = null;
        try {
          await latest.current.send(next.mode);
          if (next.remember) rememberChainMode(next.mode);
        } catch (err) {
          wanted.current = null;
          latest.current.onError(err instanceof Error ? err.message : "The response switch could not be changed");
        }
      }
    } finally {
      flying.current = false;
      setPending(null);
    }
  }, []);

  const onChange = useCallback((mode: DuelChainMode) => {
    void request(mode, true);
  }, [request]);

  // A new duel starts at the duel setting; this browser's last Auto or Always replaces it once. Off is never carried over.
  useEffect(() => {
    if (!live || serverMode === undefined || appliedFor.current === slug) return;
    appliedFor.current = slug;
    const remembered = loadRememberedChainMode();
    if (!remembered) {
      if (serverMode !== "off") lastOn.current = serverMode;
      return;
    }
    lastOn.current = remembered;
    if (serverMode !== "off" && serverMode !== remembered) void request(remembered, false);
  }, [live, serverMode, slug, request]);

  const current = shown ?? "auto";
  useEffect(() => {
    if (!live || suspended) return undefined;
    function onKey(event: KeyboardEvent) {
      if (!isChainHotkey(event)) return;
      event.preventDefault();
      void request(hotkeyTarget(current, lastOn.current), true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [live, suspended, current, request]);

  if (!live || shown === null) return null;
  return { mode: shown, onChange };
}
