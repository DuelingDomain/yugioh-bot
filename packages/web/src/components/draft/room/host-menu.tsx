"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { DraftTerminalAction } from "@/lib/draft-terminal-client";
import { usePopover } from "./popover";

export const HOST_ICON = (
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <path d="M10 2.5 16.5 5v4.6c0 3.9-2.6 6.6-6.5 7.9-3.9-1.3-6.5-4-6.5-7.9V5L10 2.5Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
  </svg>
);

/** The word the host types before a cancel goes through. */
export const CANCEL_WORD = "cancel";

/** The Host controls popover under the Host button: the two ways to stop a live draft. Nothing is sent from here. */
export function HostMenu({
  open,
  anchor,
  onChoose,
  onClose,
}: {
  /** False starts the exit; the menu leaves the DOM once it has played. */
  open: boolean;
  anchor: HTMLElement | null;
  onChoose: (action: DraftTerminalAction) => void;
  onClose: () => void;
}) {
  const { mounted, props, anchor: at } = usePopover(open, anchor, onClose, (el) => el.querySelector<HTMLElement>("button"));
  if (!mounted) return null;
  return (
    <div
      className="pop host-pop"
      id="hostPop"
      {...props}
      role="dialog"
      aria-label="Host controls"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
          at?.focus();
        }
      }}
    >
      <h3>Host controls</h3>
      <p className="host-lede">Each one asks you to confirm.</p>
      <div className="host-acts">
        <button type="button" data-host-action="end" onClick={() => onChoose("end")}>
          <b>End now (keep picks)</b>
          <small>Stops the draft. Everyone keeps the cards they have picked.</small>
        </button>
        <button type="button" data-host-action="cancel" data-tone="danger" onClick={() => onChoose("cancel")}>
          <b>Cancel draft</b>
          <small>Stops the draft and throws away every pick.</small>
        </button>
      </div>
    </div>
  );
}

const COPY: Record<DraftTerminalAction, { title: string; body: string; confirm: string; busy: string; back: string }> = {
  end: {
    title: "End the draft now?",
    body: "The draft stops at once for everyone. No more cards are dealt. Every player keeps the picks they have made so far, and the draft moves to its summary. This cannot be undone.",
    confirm: "End draft",
    busy: "Ending…",
    back: "Keep drafting",
  },
  cancel: {
    title: "Cancel this draft?",
    body: "The draft stops at once for everyone, and every pick, pack and card dealt so far is thrown away. Nobody gets a deck from it. This cannot be undone. To keep the picks, use End now instead.",
    confirm: "Cancel draft",
    busy: "Cancelling…",
    back: "Keep drafting",
  },
};

/**
 * The confirm for End now and Cancel draft. It is a modal inside the room layer, so Tab stays on it. Cancel is
 * destructive: it is red, and the button stays off until the host types the word. While the request runs both buttons
 * are off, and a lock that is not state stops a second click in the same frame from sending a second request.
 */
export function HostConfirm({
  action,
  onConfirm,
  onClose,
}: {
  /** Null closes the dialog. */
  action: DraftTerminalAction | null;
  onConfirm: (action: DraftTerminalAction) => Promise<void>;
  onClose: () => void;
}) {
  // Keyed by the action, so each open starts clean: no old error, no old typed word.
  return action ? <ConfirmBody key={action} action={action} onConfirm={onConfirm} onClose={onClose} /> : null;
}

function ConfirmBody({
  action,
  onConfirm,
  onClose,
}: {
  action: DraftTerminalAction;
  onConfirm: (action: DraftTerminalAction) => Promise<void>;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const backRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const errorId = useId();

  useEffect(() => {
    backRef.current?.focus();
  }, []);

  const copy = COPY[action];
  const danger = action === "cancel";
  const armed = !danger || typed.trim().toLowerCase() === CANCEL_WORD;

  const confirm = async () => {
    if (sending.current || !armed) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(action);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      if (!busy) onClose();
      return;
    }
    // Tab stays inside the dialog.
    if (e.key !== "Tab" || !panelRef.current) return;
    const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)"));
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="hc-scrim" onKeyDown={onKeyDown}>
      <div
        ref={panelRef}
        className="hc"
        data-tone={danger ? "danger" : undefined}
        data-host-confirm={action}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={headingId}
      >
        <h2 id={headingId}>{copy.title}</h2>
        <p>{copy.body}</p>
        {danger ? (
          <label className="hc-type">
            <span>Type <b>{CANCEL_WORD}</b> to confirm</span>
            <input
              type="text"
              value={typed}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              disabled={busy}
              aria-describedby={error ? errorId : undefined}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void confirm();
                }
              }}
            />
          </label>
        ) : null}
        {error ? (
          <p className="hc-error" id={errorId} role="alert">
            {error}
          </p>
        ) : null}
        <div className="hc-acts">
          <button ref={backRef} type="button" className="hc-btn" data-kind="ghost" disabled={busy} onClick={onClose}>
            {copy.back}
          </button>
          <button
            type="button"
            className="hc-btn"
            data-kind={danger ? "danger" : "primary"}
            disabled={busy || !armed}
            aria-busy={busy || undefined}
            onClick={() => void confirm()}
          >
            {busy ? copy.busy : copy.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
