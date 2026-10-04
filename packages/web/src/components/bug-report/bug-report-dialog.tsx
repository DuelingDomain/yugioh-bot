"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { BUG_TEXT_MAX, validateBugText, type BugFieldErrors } from "@/lib/bug-report";
import { DURATION, usePresence } from "@/lib/motion";
import type { CollectedContext } from "./context";

type Result = { id: number; issue: { number: number; url: string } | null; duplicate: boolean };
type KnownLimit = { id: string; title: string; explanation: string };
type Duplicate = { number: number; url: string; title: string; sameDuel: boolean };
type Step = "write" | "checking" | "review" | "done";

const FIELD = "w-full rounded-md border border-border bg-transparent p-2 text-sm text-text-primary placeholder:text-text-secondary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-primary";
const PRECHECK_TIMEOUT_MS = 5000;

/** What the player reads when the server refuses or the network fails. */
async function failureText(response: Response): Promise<string> {
  if (response.status === 429) {
    const wait = Number(response.headers.get("Retry-After"));
    const minutes = Number.isFinite(wait) && wait > 0 ? Math.max(1, Math.ceil(wait / 60)) : null;
    return `You sent several reports a moment ago. ${minutes ? `Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.` : "Try again later."}`;
  }
  if (response.status === 401 || response.status === 403) return "Sign in again to send a report.";
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && (response.status === 400 || response.status === 409)) return body.error;
  } catch { /* The status is enough. */ }
  return "Could not send the report. Try again.";
}

/**
 * Asks the server whether the report is a known problem or the same as an open issue. Never throws and never blocks the
 * report: a timeout (5 seconds), a network error or any server answer except a good one gives `null`, and the report is
 * then sent without the check. A 400 comes back as its field errors. `cancel` stops the request when the dialog closes.
 */
async function precheck(payload: unknown, cancel: AbortSignal): Promise<{ knownLimits: KnownLimit[]; duplicates: Duplicate[] } | { fieldErrors: BugFieldErrors } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PRECHECK_TIMEOUT_MS);
  const onCancel = () => controller.abort();
  if (cancel.aborted) onCancel();
  else cancel.addEventListener("abort", onCancel, { once: true });
  try {
    const response = await fetch("/api/bug-reports/precheck", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (response.status === 400) {
      const body = (await response.json()) as { fieldErrors?: BugFieldErrors };
      return body.fieldErrors ? { fieldErrors: body.fieldErrors } : null;
    }
    if (!response.ok) return null;
    const body = (await response.json()) as { knownLimits?: unknown; duplicates?: unknown };
    return {
      knownLimits: Array.isArray(body.knownLimits) ? (body.knownLimits as KnownLimit[]) : [],
      duplicates: Array.isArray(body.duplicates) ? (body.duplicates as Duplicate[]) : [],
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    cancel.removeEventListener("abort", onCancel);
  }
}

function ReportForm({ collect, onClose, open }: { collect: () => CollectedContext; onClose: () => void; open: boolean }) {
  const [description, setDescription] = useState("");
  const [expected, setExpected] = useState("");
  const [step, setStep] = useState<Step>("write");
  const [tried, setTried] = useState(false);
  const [serverErrors, setServerErrors] = useState<BugFieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [found, setFound] = useState<{ knownLimits: KnownLimit[]; duplicates: Duplicate[] }>({ knownLimits: [], duplicates: [] });
  const sending = useRef(false);
  // Set at the start of submit, so two fast Enter presses send one request before the step state changes.
  const submitting = useRef(false);
  // Closing the dialog stops a running check and keeps the report from being sent afterwards.
  const closed = useRef(false);
  const cancelCheck = useRef<AbortController | null>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  // The context is read once, when the player presses Send, and the same snapshot is checked and sent.
  const snapshot = useRef<CollectedContext | null>(null);

  const quality = validateBugText({ description, expected });
  const fieldErrors: BugFieldErrors = tried ? { ...serverErrors, ...quality } : {};

  // The dialog stays mounted while it fades out, so closing is `open` going false, not the unmount.
  useEffect(() => {
    closed.current = !open;
    if (!open) cancelCheck.current?.abort();
  }, [open]);
  useEffect(() => () => { closed.current = true; cancelCheck.current?.abort(); }, []);

  // Screen readers should land on the new step, not on the removed form.
  useEffect(() => {
    if (step === "review") reviewHeading.current?.focus();
  }, [step]);

  async function post(duplicateOf?: number) {
    if (sending.current || closed.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/bug-reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description, expected, ...snapshot.current, ...(duplicateOf ? { duplicateOf } : {}) }),
      });
      if (!response.ok) {
        const text = await failureText(response);
        setError(text);
        if (duplicateOf && response.status === 409) setFound((f) => ({ ...f, duplicates: f.duplicates.filter((d) => d.number !== duplicateOf) }));
        // A refusal in the write step (the server rules) sends the player back to the text.
        if (step !== "review") setStep("write");
        return;
      }
      const body = (await response.json()) as Partial<Result>;
      setResult({ id: Number(body.id), issue: body.issue ?? null, duplicate: body.duplicate === true });
      setStep("done");
    } catch {
      setError("Could not send the report. Check your connection and try again.");
      if (step !== "review") setStep("write");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current || sending.current || step !== "write") return;
    setTried(true);
    setError(null);
    if (quality.description || quality.expected) return;
    submitting.current = true;
    try {
      snapshot.current = collect();
      setStep("checking");
      cancelCheck.current = new AbortController();
      const checked = await precheck({ description, expected, ...snapshot.current }, cancelCheck.current.signal);
      if (closed.current) return;
      if (checked && "fieldErrors" in checked) {
        setServerErrors(checked.fieldErrors);
        setStep("write");
        return;
      }
      if (checked && (checked.knownLimits.length > 0 || checked.duplicates.length > 0)) {
        setFound(checked);
        setStep("review");
        return;
      }
      await post();
    } finally {
      submitting.current = false;
    }
  }

  if (step === "done" && result) {
    const link = result.issue ? (
      <a href={result.issue.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent-primary underline underline-offset-2">
        #{result.issue.number}
      </a>
    ) : null;
    return (
      <div className="grid gap-3" data-testid="bug-report-done">
        {link ? (
          <p role="status" className="text-sm text-text-primary">
            {result.duplicate ? <>Thank you. Your report was added to issue </> : <>Thank you. Your report is issue </>}
            {link}
            .
          </p>
        ) : (
          <p role="status" className="text-sm text-text-primary">Saved — the team will see it.</p>
        )}
        <div><Button type="button" variant="secondary" onClick={onClose}>Close</Button></div>
      </div>
    );
  }

  if (step === "checking") {
    return <p role="status" className="text-sm text-text-secondary" data-testid="bug-report-checking">Checking if this is already known…</p>;
  }

  if (step === "review") {
    const known = found.knownLimits.length > 0;
    return (
      <div className="grid gap-4" data-testid="bug-report-review">
        {known ? (
          <section className="grid gap-2" data-testid="bug-report-known" aria-labelledby="bug-known-title">
            <h3 id="bug-known-title" ref={reviewHeading} tabIndex={-1} className="text-sm font-semibold text-text-primary outline-none">This is already known</h3>
            <ul className="grid gap-2">
              {found.knownLimits.map((limit) => (
                <li key={limit.id} className="rounded-md border border-border p-2 text-sm">
                  <p className="font-medium text-text-primary">{limit.title}</p>
                  <p className="text-text-secondary">{limit.explanation}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {found.duplicates.length > 0 ? (
          <section className="grid gap-2" data-testid="bug-report-duplicates" aria-labelledby="bug-dup-title">
            <h3 id="bug-dup-title" ref={known ? undefined : reviewHeading} tabIndex={-1} className="text-sm font-semibold text-text-primary outline-none">Is it one of these?</h3>
            <ul className="grid gap-2">
              {found.duplicates.map((issue) => (
                <li key={issue.number} className="grid gap-1 rounded-md border border-border p-2 text-sm">
                  {issue.sameDuel ? <p className="text-xs font-medium text-accent-primary">Reported by another player in this duel</p> : null}
                  <a href={issue.url} target="_blank" rel="noopener noreferrer" className="font-medium text-text-primary underline underline-offset-2">
                    {issue.title} <span className="text-text-secondary">#{issue.number}</span>
                  </a>
                  <div>
                    <Button type="button" variant="secondary" disabled={busy} onClick={() => void post(issue.number)}>Yes, same bug</Button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {error ? <p role="alert" className="text-sm text-red-400">{error}</p> : null}
        <div className="flex gap-2">
          <Button type="button" loading={busy} onClick={() => void post()}>{known ? "My bug is different" : "No, it is different"}</Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => { setError(null); setStep("write"); }}>Back</Button>
        </div>
      </div>
    );
  }

  return (
    <form className="grid gap-3" onSubmit={(event) => void submit(event)} noValidate>
      <label className="grid gap-1 text-sm text-text-secondary">
        <span>What went wrong? <span aria-hidden className="text-accent-cta">*</span> <span className="text-xs">(at least 4 words)</span></span>
        <textarea value={description} onChange={(e) => { setDescription(e.target.value); setServerErrors((s) => ({ ...s, description: undefined })); }} rows={4} maxLength={BUG_TEXT_MAX}
          required aria-required="true" aria-invalid={fieldErrors.description ? true : undefined}
          aria-describedby={fieldErrors.description ? "bug-description-error" : undefined} className={FIELD} data-autofocus />
        {fieldErrors.description ? <span id="bug-description-error" role="alert" className="text-xs text-red-400">{fieldErrors.description}</span> : null}
      </label>
      <label className="grid gap-1 text-sm text-text-secondary">
        <span>What did you expect? <span aria-hidden className="text-accent-cta">*</span></span>
        <textarea value={expected} onChange={(e) => { setExpected(e.target.value); setServerErrors((s) => ({ ...s, expected: undefined })); }} rows={2} maxLength={BUG_TEXT_MAX}
          required aria-required="true" aria-invalid={fieldErrors.expected ? true : undefined}
          aria-describedby={fieldErrors.expected ? "bug-expected-error" : undefined} className={FIELD} />
        {fieldErrors.expected ? <span id="bug-expected-error" role="alert" className="text-xs text-red-400">{fieldErrors.expected}</span> : null}
      </label>
      <p className="text-xs text-text-secondary">
        We add the page, the last public log lines and your browser details. The report is public on GitHub. We never add your hand or your name.
      </p>
      {error ? <p role="alert" className="text-sm text-red-400">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" loading={busy}>Send report</Button>
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </form>
  );
}

/** Mounted from open until the exit ends: Modal takes focus and sets its trap on the first render, and lets go when `open` goes false. */
function OpenDialog({ collect, onClose, open }: { collect: () => CollectedContext; onClose: () => void; open: boolean }) {
  // Read while rendering, before Modal moves focus into the dialog, so closing can give focus back.
  const [opener] = useState(() => (typeof document === "undefined" ? null : document.activeElement as HTMLElement | null));
  const body = useRef<HTMLDivElement>(null);
  // This effect runs after Modal's, which put focus on its close button; the first field is the better start.
  useEffect(() => { body.current?.querySelector<HTMLTextAreaElement>("[data-autofocus]")?.focus(); }, []);
  const close = () => {
    onClose();
    queueMicrotask(() => { if (opener?.isConnected) opener.focus(); });
  };
  const closeRef = useRef(close);
  closeRef.current = close;
  // Escape closes this dialog only. Listening on window in the capture phase runs before the document listeners of a
  // parent Sheet or Modal, and stopping the event keeps them from closing too.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);
  // React events pass through a portal to the parent components. A swipe in this dialog must not close a parent Sheet.
  const keepTouch = (event: React.SyntheticEvent) => event.stopPropagation();
  return (
    <div onTouchStart={keepTouch} onTouchEnd={keepTouch}>
      <Modal open={open} onClose={close} title="Report a bug">
        <div ref={body}><ReportForm collect={collect} onClose={close} open={open} /></div>
      </Modal>
    </div>
  );
}

/**
 * The small "Report bug" dialog. `collect` runs at send time, so the context is fresh. It renders in document.body:
 * inside a phone Sheet the translate and overflow of the Sheet would move and clip the fixed dialog.
 */
export function BugReportDialog({ open, onClose, collect }: { open: boolean; onClose: () => void; collect: () => CollectedContext }) {
  // Stays mounted for the exit fade; Modal inside releases the focus trap and the scroll lock at once.
  const { mounted } = usePresence(open, DURATION.modalOut);
  return mounted && typeof document !== "undefined" ? createPortal(<OpenDialog collect={collect} onClose={onClose} open={open} />, document.body) : null;
}
