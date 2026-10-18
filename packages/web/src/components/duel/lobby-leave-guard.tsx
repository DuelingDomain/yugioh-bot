"use client";

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { useNavigationLeaveGuard, type LeaveIntercept } from "@/lib/hooks/navigation-leave-guard";
import { leaveLobbyRoom } from "./api";
import { SheetButton } from "./sheet-ui";
import ui from "./sheet-ui.module.css";
import styles from "./room-lobby.module.css";

const TAB_CLOSE_MESSAGE = "Leave this room? Your seat is kept until you leave from the room.";

/** Dialog copy: the host closes the room, a guest only gives up the seat. */
export function lobbyLeaveCopy(host: boolean) {
  return host
    ? {
        title: "Leave and close this room?",
        body: "The room closes for everyone. Other players see that it is closed.",
        confirm: "Leave and close room",
      }
    : {
        title: "Leave this room?",
        body: "You give up your seat. The room stays open for the other players.",
        confirm: "Leave room",
      };
}

/**
 * Lobby only (the game has not started). Back and in-app links ask first in a styled dialog; Stay keeps the room,
 * Leave calls the leave route and then continues the navigation. A reload keeps the room: nothing here closes it
 * on unload. Closing the tab only gets the browser prompt.
 */
export function useLobbyLeaveGuard({ slug, active, host }: { slug: string; active: boolean; host: boolean }): ReactNode {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const proceedRef = useRef<(() => void) | null>(null);
  const inFlight = useRef(false);

  const request = useCallback((proceed: () => void) => {
    // A second Back while the dialog is up keeps the first request; Stay drops it.
    proceedRef.current ??= proceed;
    setError(null);
    setOpen(true);
  }, []);
  const navigate = useCallback((href: string) => router.push(href), [router]);
  const intercept = useMemo<LeaveIntercept>(() => ({ request, navigate }), [request, navigate]);

  useNavigationLeaveGuard(active, TAB_CLOSE_MESSAGE, slug, intercept);

  const stay = useCallback(() => {
    if (inFlight.current) return;
    proceedRef.current = null;
    setError(null);
    setOpen(false);
  }, []);

  const leave = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await leaveLobbyRoom(slug);
      const proceed = proceedRef.current;
      proceedRef.current = null;
      setOpen(false);
      proceed?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not leave the room.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [slug]);

  const copy = lobbyLeaveCopy(host);
  return (
    <Modal open={open && active} onClose={stay} title={copy.title} className="max-w-[min(32rem,calc(100vw-2rem))]">
      <p className="text-sm text-text-secondary">{copy.body}</p>
      {error ? <p role="alert" className={`${ui.alert} mt-3`}>{error}</p> : null}
      <div className={`${styles.headActions} mt-5`}>
        <SheetButton kind="danger" loading={busy} disabled={busy} onClick={() => void leave()}>{copy.confirm}</SheetButton>
        <SheetButton kind="quiet" disabled={busy} onClick={stay}>Stay in room</SheetButton>
      </div>
    </Modal>
  );
}
