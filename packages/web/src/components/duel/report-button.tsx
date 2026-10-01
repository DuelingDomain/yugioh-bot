"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { getDuelRoom, listDuelPresets, reportEnabled, type DuelPreset } from "./api";
import {
  addMark, errorSignature, installReportCapture, isTypingTarget, marks, snapshotBuffers,
} from "./report-buffers";

export const REPORT_CATEGORIES = [
  { id: "stall", label: "Stall (nothing happens)" },
  { id: "wrong-rule", label: "Wrong rule" },
  { id: "ui", label: "UI" },
  { id: "crash", label: "Crash" },
  { id: "checklist", label: "Checklist" },
  { id: "other", label: "Other" },
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number]["id"];

const MAX_NOTE = 4000;

export interface ReportForm {
  category: ReportCategory;
  checklistItem?: string;
  expected?: string;
  actual?: string;
  free?: string;
  auto?: boolean;
}

/** The host op takes one text `note`. The structured fields go in as labelled lines. Always at most 4000 characters. */
export function composeNote(form: ReportForm, markTexts: string[] = []): string {
  const lines = [`Category: ${form.category}${form.auto ? " (automatic)" : ""}`];
  if (form.checklistItem) lines.push(`Checklist item: ${form.checklistItem}`);
  if (form.expected) lines.push(`Expected: ${form.expected}`);
  if (form.actual) lines.push(`Actual: ${form.actual}`);
  if (form.free) lines.push(`Note: ${form.free}`);
  if (markTexts.length) lines.push(`Marks: ${markTexts.join(" | ")}`);
  const text = lines.join("\n");
  return text.length > MAX_NOTE ? `${text.slice(0, MAX_NOTE - 1)}…` : text;
}

/** Saves one report. Adds the room JSON, revision, open prompt and the client ring buffers. */
export async function submitReport(slug: string, form: ReportForm, extra: Record<string, unknown> = {}): Promise<{ path: string; attachments?: string }> {
  let room: unknown = null;
  let roomError: string | undefined;
  try {
    room = await getDuelRoom(slug);
  } catch (e) {
    roomError = e instanceof Error ? e.message : String(e);
  }
  const engine = (room as { engine?: { revision?: number; prompt?: unknown } | null } | null)?.engine ?? null;
  const buffers = snapshotBuffers();
  const attachments = {
    form,
    savedAt: new Date().toISOString(),
    page: typeof window !== "undefined" ? window.location.href : null,
    revision: engine?.revision ?? null,
    prompt: engine?.prompt ?? null,
    room,
    ...(roomError ? { roomError } : {}),
    ...buffers,
    ...extra,
  };
  const note = composeNote(form, buffers.marks.slice(-10).map((m) => `${m.t.slice(11, 19)} ${m.text}`));
  const res = await fetch(`/api/duels/${encodeURIComponent(slug)}/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note, attachments }),
  });
  const body = (await res.json().catch(() => null)) as { path?: string; attachments?: string; error?: string } | null;
  if (!res.ok || !body?.path) throw new Error(body?.error ?? `Report failed (${res.status})`);
  return { path: body.path, ...(body.attachments ? { attachments: body.attachments } : {}) };
}

/** Dev only. Renders nothing unless the server runs with DUEL_SCENARIOS=1. */
export function ReportButton({ slug }: { slug: string }) {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<ReportCategory>("other");
  const [checklistItem, setChecklistItem] = useState("");
  const [expected, setExpected] = useState("");
  const [actual, setActual] = useState("");
  const [checklist, setChecklist] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [path, setPath] = useState<string | null>(null);
  const [dropped, setDropped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [markCount, setMarkCount] = useState(0);
  const seenErrors = useRef(new Set<string>());

  useEffect(() => {
    let live = true;
    void reportEnabled(slug).then((ok) => { if (live) setEnabled(ok); });
    return () => { live = false; };
  }, [slug]);

  // Capture starts as soon as the room mounts, so frames and clicks before the first report are kept.
  useEffect(() => { installReportCapture(); }, []);

  // "M" saves a mark with no modal. Ignored while typing.
  useEffect(() => {
    if (!enabled) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "m" && e.key !== "M") return;
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      addMark("mark");
      setMarkCount(marks.size);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);

  // One automatic report per error signature per page load.
  useEffect(() => {
    if (!enabled) return;
    function auto(message: string, source?: string | null, line?: number | null) {
      const sig = errorSignature(message, source, line);
      if (seenErrors.current.has(sig)) return;
      seenErrors.current.add(sig);
      void submitReport(slug, { category: "crash", auto: true, actual: message.slice(0, 1000) }, { errorSignature: sig }).catch(() => {});
    }
    const onError = (e: ErrorEvent) => auto(e.message || String(e.error), e.filename, e.lineno);
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason;
      auto(r instanceof Error ? (r.stack ?? r.message) : String(r));
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [enabled, slug]);

  // Checklist of the preset this room came from (matched by table name = preset title).
  useEffect(() => {
    if (!open) return;
    let live = true;
    void Promise.all([getDuelRoom(slug), listDuelPresets()]).then(([room, list]) => {
      if (!live) return;
      const preset: DuelPreset | undefined = list.presets.find((p) => p.title === room.session.name);
      setChecklist(preset?.checklist ?? []);
    }).catch(() => {});
    return () => { live = false; };
  }, [open, slug]);

  const send = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const saved = await submitReport(slug, {
        category,
        checklistItem: checklistItem || undefined,
        expected: expected || undefined,
        actual: actual || undefined,
      });
      setDropped(saved.attachments === "too-large" || saved.attachments === "failed");
      setPath(saved.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the report");
    } finally {
      setBusy(false);
    }
  }, [slug, category, checklistItem, expected, actual]);

  if (!enabled) return null;

  function close() {
    setOpen(false);
    setPath(null);
    setDropped(false);
    setError(null);
    setCategory("other");
    setChecklistItem("");
    setExpected("");
    setActual("");
  }

  const field = "rounded-md border border-border bg-transparent p-2 text-sm text-text-primary";
  return (
    <>
      <button type="button" className="inline-flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary"
        title="Press M to save a mark" onClick={() => setOpen(true)}>
        <Flag size={14} strokeWidth={1.75} aria-hidden /> Report{markCount > 0 ? ` (${markCount} marks)` : ""}
      </button>
      <Modal open={open} onClose={close} title="Report a problem">
        {path ? (
          <div className="grid gap-3">
            <p className="text-sm text-text-secondary">Report saved to:</p>
            <code className="break-all text-xs text-text-primary">{path}</code>
            {dropped ? <p role="status" className="text-sm text-amber-400">Report saved. The page data was too large and was not attached.</p> : null}
            <div><Button type="button" variant="ghost" onClick={close}>Close</Button></div>
          </div>
        ) : (
          <div className="grid gap-3">
            <label className="grid gap-1 text-sm text-text-secondary">
              Category
              <select value={category} onChange={(e) => setCategory(e.target.value as ReportCategory)} className={field}>
                {REPORT_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
            {checklist.length > 0 ? (
              <label className="grid gap-1 text-sm text-text-secondary">
                Checklist item
                <select value={checklistItem} onChange={(e) => setChecklistItem(e.target.value)} className={field}>
                  <option value="">(none)</option>
                  {checklist.map((item, i) => <option key={i} value={item}>{`${i + 1}. ${item}`}</option>)}
                </select>
              </label>
            ) : null}
            <label className="grid gap-1 text-sm text-text-secondary">
              Expected
              <textarea value={expected} onChange={(e) => setExpected(e.target.value)} rows={2} maxLength={1500} className={field} />
            </label>
            <label className="grid gap-1 text-sm text-text-secondary">
              Actual
              <textarea value={actual} onChange={(e) => setActual(e.target.value)} rows={3} maxLength={1500} className={field} />
            </label>
            <p className="text-xs text-text-secondary">
              Attached by itself: room, revision, open prompt, last 200 frames, console errors, last 20 clicks, marks.
            </p>
            {error ? <p role="alert" className="text-sm text-red-400">{error}</p> : null}
            <div className="flex gap-2">
              <Button type="button" disabled={busy} onClick={() => void send()}>Save report</Button>
              <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
