"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, X } from "lucide-react";
import { SANDBOX_SHARE_PREFIX, SandboxBoardError, decodeSandboxShare, type SandboxShare } from "@yugidraft/shared/duels";
import styles from "./share-dialog.module.css";

export type ShareDialogMode = "import" | "export";

export interface ShareDialogProps {
  mode: ShareDialogMode;
  /** Export: the code to show when the browser did not let us copy it. */
  code?: string;
  /** Import: load the decoded share. A thrown error shows inline and keeps the dialog open. */
  onImport?: (share: SandboxShare) => Promise<void> | void;
  onClose: () => void;
}

/** One line for the owner. A share code error names its field, except transport errors (path `share`). */
export function shareErrorText(error: unknown): string {
  if (error instanceof SandboxBoardError) {
    return error.path === "share" || error.path === "$" ? error.message : `${error.path}: ${error.message}`;
  }
  return error instanceof Error && error.message ? error.message : "That code did not work.";
}

/**
 * Share code dialog of the sandbox builder. Import: paste a code, decode it in the browser, hand it to the
 * builder. Export: shows a code the browser would not copy. Native `<dialog>`, so the top layer keeps it above
 * the Match Sheet container.
 */
export function ShareDialog({ mode, code = "", onImport, onClose }: ShareDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }, []);

  async function submit() {
    // A code pasted from chat or mail may wrap over lines.
    const value = text.replace(/\s+/g, "");
    if (!value) {
      setError("Paste a share code first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const share = decodeSandboxShare(value);
      await onImport?.(share);
      onClose();
    } catch (failure) {
      setError(shareErrorText(failure));
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const importing = mode === "import";
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby="sbx-share-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={styles.panel}>
        <div className={styles.head}>
          <h2 id="sbx-share-title">{importing ? "Import share code" : "Share code"}</h2>
          <button type="button" className={styles.close} aria-label="Close dialog" onClick={onClose}>
            <X size={16} aria-hidden />
          </button>
        </div>
        {importing ? (
          <>
            <p className={styles.hint}>Paste a code from another developer. It replaces the board in the builder. Undo brings the old board back.</p>
            <label className={styles.field}>
              <span>Share code</span>
              <textarea
                className={`input ${styles.code}`}
                value={text}
                rows={5}
                spellCheck={false}
                autoFocus
                placeholder={`${SANDBOX_SHARE_PREFIX}…`}
                aria-invalid={error ? true : undefined}
                onChange={(event) => {
                  setText(event.target.value);
                  setError(null);
                }}
              />
            </label>
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
            <div className={styles.acts}>
              <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={busy || text.trim() === ""} onClick={() => void submit()}>
                {busy ? "Importing…" : "Import"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className={styles.hint}>The browser did not let us copy it. Copy the code below and send it. Any developer can import it.</p>
            <label className={styles.field}>
              <span>Share code</span>
              <textarea className={`input ${styles.code}`} value={code} rows={5} readOnly spellCheck={false} onFocus={(event) => event.currentTarget.select()} />
            </label>
            <div className={styles.acts}>
              <button type="button" className="btn btn-quiet" onClick={onClose}>Close</button>
              <button type="button" className="btn btn-primary" onClick={() => void copy()}>
                <Copy size={14} aria-hidden /> {copied ? "Copied" : "Copy code"}
              </button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
