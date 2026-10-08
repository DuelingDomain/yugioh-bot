"use client";

import * as React from "react";
import { Check, Link2 } from "lucide-react";
import type { DraftVisibility } from "@yugidraft/shared/types";
import { Segmented, StatusLine, SvButton, svButtonClass } from "@/components/sheet";
import { fetchInviteUrl, patchVisibility, resetInviteUrl, VISIBILITY_HELP, VISIBILITY_LABEL } from "@/lib/draft-invite";
import { useInlineConfirm } from "../use-inline-confirm";
import styles from "./visibility.module.css";

type Busy = "visibility" | "copy" | "reset" | null;

const COPIED_MS = 2000;
const OPTIONS = (["private", "open"] as const).map((value) => ({ value, label: VISIBILITY_LABEL[value] }));

/** Write to the clipboard. False when the browser refuses or has no clipboard. */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export interface HostInviteControlsProps {
  slug: string;
  visibility: DraftVisibility;
  /** The draft is still in its lobby. The switch is locked once it is not. */
  pending: boolean;
  /** Called after the visibility changed, so the page can read the draft again. */
  onChanged?: () => void;
}

/**
 * What only the host sees in the lobby: the Private/Open switch, Copy invite link and Reset link. Copy asks the server
 * for the link each time (the first call makes the code), then copies it. If the browser refuses the clipboard, the
 * link shows in a field to copy by hand. Reset has an inline confirm step, not a browser dialog.
 */
export function HostInviteControls({ slug, visibility, pending, onChanged }: HostInviteControlsProps) {
  const [busy, setBusy] = React.useState<Busy>(null);
  const [target, setTarget] = React.useState<DraftVisibility | null>(null);
  const [copied, setCopied] = React.useState<"copy" | "reset" | null>(null);
  const [fallback, setFallback] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const confirm = useInlineConfirm(busy === "reset");
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const field = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  React.useEffect(() => {
    if (fallback !== null) {
      field.current?.focus();
      field.current?.select();
    }
  }, [fallback]);

  const flash = (kind: "copy" | "reset") => {
    setCopied(kind);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), COPIED_MS);
  };

  /** Copy a link the server just gave; show it for hand-copying when the clipboard is closed. */
  const deliver = async (url: string, kind: "copy" | "reset") => {
    if (await writeClipboard(url)) {
      setFallback(null);
      flash(kind);
    } else {
      setCopied(null);
      setFallback(url);
    }
  };

  const copy = async () => {
    if (busy) return;
    setBusy("copy");
    setError(null);
    try {
      await deliver(await fetchInviteUrl(slug), "copy");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't get the invite link.");
    } finally {
      setBusy(null);
    }
  };

  const reset = async () => {
    if (busy) return;
    setBusy("reset");
    setError(null);
    try {
      const url = await resetInviteUrl(slug);
      confirm.setOpen(false);
      await deliver(url, "reset");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reset the invite link.");
    } finally {
      setBusy(null);
    }
  };

  const choose = async (next: DraftVisibility) => {
    if (busy || next === visibility || !pending) return;
    setBusy("visibility");
    setTarget(next);
    setError(null);
    try {
      await patchVisibility(slug, next);
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't change who can join.");
    } finally {
      setTarget(null);
      setBusy(null);
    }
  };

  const shown = target ?? visibility;
  return (
    <div className={styles.host}>
      <div className={styles.hostRow}>
        <div className={styles.segWrap}>
          <Segmented label="Who can join" value={shown} options={OPTIONS} onChange={(value) => void choose(value)} disabled={!pending || busy === "visibility"} />
        </div>
      </div>
      <p className={styles.note}>{VISIBILITY_HELP[shown]}.</p>
      {!pending && <p className={styles.locked}>This is locked once the draft starts.</p>}

      {confirm.open ? (
        <div className={styles.confirm} role="group" aria-label="Reset invite link" onKeyDown={confirm.onKeyDown}>
          <p>Make a new link? The old one stops letting new people in. People already invited keep access.</p>
          <div className={styles.confirmActs}>
            <SvButton variant="primary" disabled={busy === "reset"} aria-busy={busy === "reset" || undefined} onClick={() => void reset()}>
              Reset link
            </SvButton>
            <SvButton variant="quiet" disabled={busy === "reset"} onClick={() => confirm.setOpen(false)}>
              Keep current link
            </SvButton>
          </div>
        </div>
      ) : (
        <>
          <div className={styles.hostRow}>
            <button
              type="button"
              className={`${svButtonClass("ghost")} ${styles.copyBtn}`}
              data-copied={copied === "copy" || undefined}
              disabled={busy !== null}
              aria-busy={busy === "copy" || undefined}
              onClick={() => void copy()}
            >
              {copied === "copy" ? <Check size={16} aria-hidden="true" /> : <Link2 size={16} aria-hidden="true" />}
              {copied === "copy" ? "Copied" : "Copy invite link"}
            </button>
            <button
              ref={confirm.triggerRef}
              type="button"
              className={svButtonClass("quiet")}
              disabled={busy !== null}
              onClick={() => confirm.setOpen(true)}
            >
              Reset link
            </button>
          </div>
          <p className={styles.note}>Reset makes a new link. People already invited keep access.</p>
        </>
      )}

      {copied === "reset" && <p className={styles.status}>New link copied. The old one no longer lets new people in.</p>}
      {fallback !== null && (
        <div className={styles.fallback}>
          <span>Your browser blocked copying. Copy the link from here.</span>
          <input ref={field} type="text" readOnly value={fallback} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
        </div>
      )}
      <span className="sv-sr" role="status" aria-live="polite">{copied === "copy" ? "Invite link copied" : copied === "reset" ? "New invite link copied" : ""}</span>
      {error && (
        <div role="alert" className={styles.err}>
          <StatusLine tone="block">{error}</StatusLine>
        </div>
      )}
    </div>
  );
}
