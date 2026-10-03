"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { BUG_TEXT_MAX } from "@/lib/bug-report";
import type { CollectedContext } from "./context";

type Result = { id: number; issue: { number: number; url: string } | null };

const FIELD = "w-full rounded-md border border-border bg-transparent p-2 text-sm text-text-primary placeholder:text-text-secondary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-primary";

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
    if (typeof body.error === "string" && response.status === 400) return body.error;
  } catch { /* The status is enough. */ }
  return "Could not send the report. Try again.";
}

function ReportForm({ collect, onClose }: { collect: () => CollectedContext; onClose: () => void }) {
  const [description, setDescription] = useState("");
  const [expected, setExpected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const sending = useRef(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (sending.current || !description.trim()) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/bug-reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description, ...(expected.trim() ? { expected } : {}), ...collect() }),
      });
      if (!response.ok) {
        setError(await failureText(response));
        return;
      }
      const body = (await response.json()) as Partial<Result>;
      setResult({ id: Number(body.id), issue: body.issue ?? null });
    } catch {
      setError("Could not send the report. Check your connection and try again.");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="grid gap-3" data-testid="bug-report-done">
        {result.issue ? (
          <p role="status" className="text-sm text-text-primary">
            Thank you. Your report is issue{" "}
            <a href={result.issue.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent-primary underline underline-offset-2">
              #{result.issue.number}
            </a>
            .
          </p>
        ) : (
          <p role="status" className="text-sm text-text-primary">Saved — the team will see it.</p>
        )}
        <div><Button type="button" variant="secondary" onClick={onClose}>Close</Button></div>
      </div>
    );
  }

  return (
    <form className="grid gap-3" onSubmit={(event) => void submit(event)}>
      <label className="grid gap-1 text-sm text-text-secondary">
        <span>What went wrong? <span aria-hidden className="text-accent-cta">*</span></span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} maxLength={BUG_TEXT_MAX}
          required aria-required="true" className={FIELD} data-autofocus />
      </label>
      <label className="grid gap-1 text-sm text-text-secondary">
        <span>What did you expect? <span className="text-xs">(optional)</span></span>
        <textarea value={expected} onChange={(e) => setExpected(e.target.value)} rows={2} maxLength={BUG_TEXT_MAX} className={FIELD} />
      </label>
      <p className="text-xs text-text-secondary">
        We add the page, the last public log lines and your browser details. The report is public on GitHub. We never add your hand or your name.
      </p>
      {error ? <p role="alert" className="text-sm text-red-400">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" loading={busy} disabled={!description.trim()}>Send report</Button>
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </form>
  );
}

/** Mounted only while open: Modal then takes focus and sets its trap on the first render. */
function OpenDialog({ collect, onClose }: { collect: () => CollectedContext; onClose: () => void }) {
  // Read while rendering, before Modal moves focus into the dialog, so closing can give focus back.
  const [opener] = useState(() => (typeof document === "undefined" ? null : document.activeElement as HTMLElement | null));
  const body = useRef<HTMLDivElement>(null);
  // This effect runs after Modal's, which put focus on its close button; the first field is the better start.
  useEffect(() => { body.current?.querySelector<HTMLTextAreaElement>("[data-autofocus]")?.focus(); }, []);
  const close = () => {
    onClose();
    queueMicrotask(() => { if (opener?.isConnected) opener.focus(); });
  };
  return (
    <Modal open onClose={close} title="Report a bug">
      <div ref={body}><ReportForm collect={collect} onClose={close} /></div>
    </Modal>
  );
}

/** The small "Report bug" dialog. `collect` runs at send time, so the context is fresh. */
export function BugReportDialog({ open, onClose, collect }: { open: boolean; onClose: () => void; collect: () => CollectedContext }) {
  return open ? <OpenDialog collect={collect} onClose={onClose} /> : null;
}
