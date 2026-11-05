"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { plural } from "@/lib/admin-console/format";
import { createRelease, previewEmail, publishRelease, releaseFrom, saveRelease, sendEmail } from "@/lib/updates/admin-client";
import { SECTION_META, longDate, shortDate } from "@/lib/updates/model";
import { SECTION_KINDS, type AdminRelease, type EmailPreview, type EmailSendState, type ReleaseDraftInput, type ReleaseSectionKind } from "@/lib/updates/types";
import type { ConsoleActions } from "./admin-console";
import { SheetFrame } from "./creators-sheet";
import { Icon, StatusIcon, Tag } from "./parts";
import styles from "./admin-console.module.css";
import own from "./updates-admin.module.css";

const MAX_HIGHLIGHTS = 6;
const VERSION = /^\d+\.\d+\.\d+$/;

const lines = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);

/** Answers from the release routes, in plain words. */
function failText(status: number, error: string | null, fallback: string): string {
  if (status === 403) return "Only an owner can change releases.";
  if (status === 409 || error === "version_exists") return "A release with this version already exists, or this release changed. Close the sheet and open it again.";
  if (status === 410 || error === "preview_expired") return "The preview ran out. Preview again.";
  if (status === 429) return "Busy. Try again in a minute.";
  if (status === 0) return "The server did not answer. Try again.";
  return fallback;
}

interface ReleaseSheetProps {
  /** Null for a new draft. */
  release: AdminRelease | null;
  configured: boolean;
  missingConfig: string[];
  actions: ConsoleActions;
  onChanged: () => Promise<void> | void;
  onCreated: (release: AdminRelease) => void;
  onClose: () => void;
}

/** One release in the right-side sheet: the editor while it is a draft, the notes and the email once it is published. */
export function ReleaseSheet({ release, configured, missingConfig, actions, onChanged, onCreated, onClose }: ReleaseSheetProps) {
  const published = release?.status === "published";
  // A button that was just used can leave the page (Publish, Send email). Focus then rests on the sheet body, so Escape still works.
  const body = useRef<HTMLDivElement>(null);
  const park = () => { requestAnimationFrame(() => body.current?.focus({ preventScroll: true })); };
  const wasPublished = useRef(published);
  useEffect(() => {
    if (published && !wasPublished.current) park();
    wasPublished.current = published;
  }, [published]);
  return (
    <SheetFrame label={release ? `Release v${release.version}` : "New release"} onClose={onClose}>
      <div className={styles.crHead}>
        <h2>{release ? `v${release.version}` : "New release"}</h2>
        <p>
          {published && release?.publishedAt ? `Published ${longDate(release.publishedAt)}. Players can read these notes now.`
            : release ? "A draft. Players can not see it yet."
            : "Write the notes first. Nothing shows to players until you publish."}
        </p>
      </div>

      <div ref={body} tabIndex={-1} className={own.body}>
        {published && release ? (
          <>
            <Notes release={release} />
            <EmailBox release={release} configured={configured} missingConfig={missingConfig} actions={actions} onChanged={onChanged} onSent={park} />
          </>
        ) : (
          <Editor release={release} configured={configured} actions={actions} onChanged={onChanged} onCreated={onCreated} onClose={onClose} />
        )}
      </div>
    </SheetFrame>
  );
}

/* ---------- read-only notes of a published release ---------- */
function Notes({ release }: { release: AdminRelease }) {
  return (
    <div className={styles.crBlock}>
      <div className={styles.crH}>
        <h3>{release.title}{release.major ? <Tag>Major</Tag> : null}</h3>
      </div>
      <ul className={own.hl}>
        {release.highlights.map((h, i) => <li key={i}>{stripBold(h)}</li>)}
      </ul>
      {release.sections.filter((s) => s.items.length).map((s) => (
        <div key={s.kind} className={own.secRead}>
          <h4>{SECTION_META[s.kind].label}<span>{s.items.length}</span></h4>
          <ul>{s.items.map((item, i) => <li key={i}>{stripBold(item)}</li>)}</ul>
        </div>
      ))}
    </div>
  );
}
const stripBold = (text: string) => text.replace(/\*\*(.+?)\*\*/g, "$1");

/* ---------- the draft editor ---------- */
type FieldErrors = Partial<Record<"version" | "title" | "highlights" | "form", string>>;

function Editor({ release, configured, actions, onChanged, onCreated }: Omit<ReleaseSheetProps, "missingConfig">) {
  const initial = (kind: ReleaseSectionKind) => release?.sections.find((s) => s.kind === kind)?.items.join("\n") ?? "";
  const [version, setVersion] = useState(release?.version ?? "");
  const [title, setTitle] = useState(release?.title ?? "");
  const [titleTouched, setTitleTouched] = useState(Boolean(release));
  const [major, setMajor] = useState(release?.major ?? false);
  const [highlights, setHighlights] = useState(release?.highlights.join("\n") ?? "");
  const [sections, setSections] = useState<Record<ReleaseSectionKind, string>>(() => ({
    new: initial("new"), improvements: initial("improvements"), cards: initial("cards"), fixes: initial("fixes"), howto: initial("howto"),
  }));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState<"save" | "publish" | null>(null);
  const [dirty, setDirty] = useState(!release);
  const [confirm, setConfirm] = useState(false);
  // The email choice follows "major" until the owner touches it.
  const [autoTouched, setAutoTouched] = useState(false);
  const [autoPick, setAutoPick] = useState(true);
  const autoEmail = major && configured && (autoTouched ? autoPick : true);

  const touch = () => setDirty(true);
  const onVersion = (value: string) => {
    setVersion(value);
    if (!titleTouched) setTitle(value.trim() ? `Dueling Domain v${value.trim()}` : "");
    touch();
  };

  function build(): ReleaseDraftInput | null {
    const next: FieldErrors = {};
    const v = version.trim();
    if (!VERSION.test(v)) next.version = "Use three numbers with dots, for example 0.2.3.";
    if (!title.trim()) next.title = "Enter a title.";
    const hl = lines(highlights);
    if (hl.length === 0) next.highlights = "Add at least one highlight.";
    else if (hl.length > MAX_HIGHLIGHTS) next.highlights = `Use ${MAX_HIGHLIGHTS} highlights or fewer. You have ${hl.length}.`;
    setErrors(next);
    if (Object.keys(next).length) return null;
    return {
      version: v, title: title.trim(), major, highlights: hl,
      sections: SECTION_KINDS.map((kind) => ({ kind, items: lines(sections[kind]) })).filter((s) => s.items.length),
    };
  }

  /** Saves the draft. Returns the saved release, or null when it did not save. */
  async function save(): Promise<AdminRelease | null> {
    const input = build();
    if (!input) return null;
    const result = release ? await saveRelease(release.id, input) : await createRelease(input);
    if (!result.ok) { setErrors({ form: failText(result.status, result.error, "The draft was not saved. Try again.") }); return null; }
    const saved = releaseFrom(result.data);
    if (!saved) { setErrors({ form: "The draft was not saved. Try again." }); return null; }
    setDirty(false);
    await onChanged();
    return saved;
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending("save");
    const saved = await save();
    setPending(null);
    if (!saved) return;
    actions.toast(release ? "Draft saved." : "Draft made.");
    if (!release) onCreated(saved);
  }

  async function onPublish() {
    if (!release || pending) return;
    setConfirm(false);
    setPending("publish");
    const result = await publishRelease(release.id, autoEmail);
    setPending(null);
    if (!result.ok) { setErrors({ form: failText(result.status, result.error, "The release was not published. Try again.") }); return; }
    actions.toast(autoEmail ? `v${release.version} is published. The email is queued.` : `v${release.version} is published.`);
    await onChanged();
  }

  return (
    <>
      <form className={`${styles.crForm} ${styles.crBlock}`} onSubmit={onSave} noValidate aria-busy={pending !== null}>
        <div className={styles.crRow2}>
          <Field label="Version" id="rl-version" error={errors.version}>
            {(aria) => <input id="rl-version" className={styles.crInput} value={version} inputMode="decimal" maxLength={20} autoComplete="off" spellCheck={false} placeholder="0.2.3"
              onChange={(e) => onVersion(e.target.value)} {...aria} />}
          </Field>
          <Field label="Title" id="rl-title" error={errors.title}>
            {(aria) => <input id="rl-title" className={styles.crInput} value={title} maxLength={80} autoComplete="off" placeholder="Dueling Domain v0.2.3"
              onChange={(e) => { setTitle(e.target.value); setTitleTouched(true); touch(); }} {...aria} />}
          </Field>
        </div>

        <label className={own.check}>
          <input type="checkbox" checked={major} onChange={(e) => { setMajor(e.target.checked); touch(); }} />
          <span><b>Major update</b><small>A major update can email everyone by itself. A minor update is never emailed unless you send it by hand.</small></span>
        </label>

        <Field label="Highlights" id="rl-hl" error={errors.highlights} hint={`One per line, up to ${MAX_HIGHLIGHTS}. They show on the reveal card and the small panel. Put **two stars** around words to make them bold.`}>
          {(aria) => <textarea id="rl-hl" className={`${styles.crInput} ${own.area}`} rows={5} value={highlights} placeholder={"Synergy search shows two groups.\nNew FAQ page."}
            onChange={(e) => { setHighlights(e.target.value); touch(); }} {...aria} />}
        </Field>

        <div className={own.secs}>
          <h3>Full notes</h3>
          {SECTION_KINDS.map((kind) => (
            <Field key={kind} label={`${SECTION_META[kind].emoji} ${SECTION_META[kind].label}`} id={`rl-sec-${kind}`} optional hint={SECTION_META[kind].hint}>
              {(aria) => <textarea id={`rl-sec-${kind}`} className={`${styles.crInput} ${own.area}`} rows={3} value={sections[kind]}
                onChange={(e) => { setSections((prev) => ({ ...prev, [kind]: e.target.value })); touch(); }} {...aria} />}
            </Field>
          ))}
        </div>

        {errors.form ? <p className={styles.crErr} role="alert">{errors.form}</p> : null}
        <div className={styles.crActs}>
          <button type="submit" className={`${styles.btn} ${release ? "" : styles.btnPrimary}`} disabled={pending !== null || (Boolean(release) && !dirty)}>
            {pending === "save" ? "Saving" : release ? "Save draft" : "Make draft"}
          </button>
          {release && !dirty ? <span className={`${styles.crHint} ${styles.aside}`}>Saved</span> : null}
        </div>
      </form>

      {release ? (
        <section className={styles.crBlock} aria-labelledby="rl-pub">
          <div className={styles.crH}><h3 id="rl-pub">Publish</h3></div>
          <div className={own.box}>
            <label className={own.check} data-off={!major || !configured}>
              <input type="checkbox" checked={autoEmail} disabled={!major || !configured || pending !== null}
                onChange={(e) => { setAutoTouched(true); setAutoPick(e.target.checked); }} />
              <span>
                <b>Email it automatically</b>
                <small>
                  {!configured ? "Email is not set up, so nothing can be sent."
                    : !major ? "Off for a minor update. You can send one email by hand after you publish."
                    : "The email goes out once, right after you publish."}
                </small>
              </span>
            </label>
            <div className={styles.crActs}>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={dirty || pending !== null} onClick={() => setConfirm(true)}>
                <Icon name="check" />{pending === "publish" ? "Publishing" : `Publish v${release.version}`}
              </button>
              {dirty ? <span className={styles.crHint}>Save the draft first.</span> : null}
            </div>
          </div>
        </section>
      ) : null}

      {confirm && release ? (
        <ConfirmDialog
          title={`Publish v${release.version} now?`}
          confirm="Publish"
          onConfirm={() => void onPublish()}
          onCancel={() => setConfirm(false)}
        >
          Players see these notes at once.{" "}
          {autoEmail ? "The release email is queued for everyone on the list." : "No email goes out. You can send one by hand afterwards."}
        </ConfirmDialog>
      ) : null}
    </>
  );
}

function Field({ id, label, optional, error, hint, children }: {
  id: string; label: string; optional?: boolean; error?: string; hint?: string;
  children: (aria: { "aria-invalid"?: true; "aria-describedby"?: string }) => ReactNode;
}) {
  const describedBy = [error && `${id}-err`, hint && `${id}-hint`].filter(Boolean).join(" ") || undefined;
  return (
    <div className={styles.crField}>
      <span><label htmlFor={id}>{label}</label>{optional ? <small>optional</small> : null}</span>
      {children({ "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {error ? <p className={styles.crErr} id={`${id}-err`} role="alert">{error}</p> : null}
      {hint ? <p className={styles.crHint} id={`${id}-hint`}>{hint}</p> : null}
    </div>
  );
}

/* ---------- the email box of a published release ---------- */
function EmailBox({ release, configured, missingConfig, actions, onChanged, onSent }: {
  release: AdminRelease; configured: boolean; missingConfig: string[]; actions: ConsoleActions; onChanged: () => Promise<void> | void; onSent: () => void;
}) {
  const [local, setLocal] = useState<EmailSendState | null>(null);
  const [preview, setPreview] = useState<EmailPreview | null>(null);
  const [busy, setBusy] = useState<"preview" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  // The list is the truth once it has moved past "none"; until then the answer of the send call shows.
  const email: EmailSendState = release.email.state !== "none" ? release.email : local ?? release.email;
  const running = email.state === "queued" || email.state === "sending";

  // While the email goes out, ask the list again every few seconds.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") void onChanged(); }, 4000);
    return () => clearInterval(timer);
  }, [running, onChanged]);

  async function onPreview() {
    if (busy) return;
    setBusy("preview");
    setError(null);
    const result = await previewEmail(release.id);
    setBusy(null);
    if (!result.ok) { setPreview(null); setError(failText(result.status, result.error, "The preview did not load. Try again.")); return; }
    setPreview(result.data);
  }

  async function onSend() {
    if (!preview || busy) return;
    setConfirm(false);
    setBusy("send");
    setError(null);
    const result = await sendEmail(release.id, preview.token);
    setBusy(null);
    if (!result.ok) { setError(failText(result.status, result.error, "The email was not sent. Try again.")); if (result.status === 410 || result.status === 409) setPreview(null); return; }
    setLocal(result.data);
    setPreview(null);
    onSent();
    actions.toast(`The email for v${release.version} is queued.`);
    await onChanged();
  }

  const total = preview?.counts.total ?? 0;
  const expired = preview ? Date.parse(preview.expiresAt) < Date.now() : false;

  return (
    <section className={styles.crBlock} aria-labelledby="rl-mail">
      <div className={styles.crH}><h3 id="rl-mail">Release email</h3>{release.major ? <Tag>Major</Tag> : null}</div>

      {email.state === "not_configured" || !configured ? (
        <div className={own.box}>
          <div className={own.state}>
            <StatusIcon tone="info" />
            <div>
              <b>Email is not set up</b>
              <p>Nothing can be sent yet. These settings are missing on the server:</p>
              {missingConfig.length ? <ul className={own.missing}>{missingConfig.map((m) => <li key={m}><code>{m}</code></li>)}</ul> : <p className={own.muted}>The server did not name them.</p>}
            </div>
          </div>
        </div>
      ) : running ? (
        <div className={own.box}>
          <div className={own.state}>
            <StatusIcon tone="info" />
            <div>
              <b>{email.state === "queued" ? "Queued" : "Sending"}</b>
              <p>{plural(email.sent, "email", "emails")} sent, {email.failed} failed, {email.queued} waiting.</p>
            </div>
          </div>
          <Progress sent={email.sent} failed={email.failed} total={email.total} />
        </div>
      ) : email.state === "done" || email.state === "needs_review" ? (
        <div className={own.box} data-locked="true">
          <div className={own.state}>
            <StatusIcon tone={email.state === "done" ? "good" : "warn"} />
            <div>
              <b>Sent on {email.confirmedAt ? longDate(email.confirmedAt) : "an earlier day"}</b>
              <p>
                {plural(email.sent, "email", "emails")} sent{email.failed ? `, ${email.failed} did not go out` : ""}.
                {email.state === "needs_review" ? " Check the numbers." : ""} A release email can go out once, so there is no second send.
              </p>
            </div>
          </div>
          <Progress sent={email.sent} failed={email.failed} total={email.total} />
        </div>
      ) : (
        <div className={own.box}>
          <p className={own.lead}>Send one email about this release. You see the numbers first.</p>
          {preview ? (
            <PreviewCounts preview={preview} expired={expired} />
          ) : null}
          {error ? <p className={styles.crErr} role="alert">{error}</p> : null}
          <div className={styles.crActs}>
            <button type="button" className={styles.btn} disabled={busy !== null} onClick={() => void onPreview()}>
              {busy === "preview" ? "Counting" : preview ? "Preview again" : "Preview"}
            </button>
            {preview && !expired ? (
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy !== null || total === 0} onClick={() => setConfirm(true)}>
                <Icon name="check" />{busy === "send" ? "Sending" : "Send email"}
              </button>
            ) : null}
          </div>
        </div>
      )}

      {confirm && preview ? (
        <ConfirmDialog
          title={`Email v${release.version} once to ${plural(total, "person", "people")}`}
          confirm={`Send to ${total.toLocaleString("en-US")}`}
          onConfirm={() => void onSend()}
          onCancel={() => setConfirm(false)}
        >
          This is the only send for this release. It can not be undone, and a second send is not possible.
        </ConfirmDialog>
      ) : null}
    </section>
  );
}

function PreviewCounts({ preview, expired }: { preview: EmailPreview; expired: boolean }) {
  const c = preview.counts;
  const excluded = c.excluded.reduce((sum, e) => sum + e.count, 0);
  return (
    <div className={own.counts} aria-live="polite">
      <dl>
        <div><dt>Members</dt><dd>{c.members.toLocaleString("en-US")}</dd></div>
        <div><dt>Invited</dt><dd>{c.invited.toLocaleString("en-US")}</dd></div>
        <div><dt>Waitlist</dt><dd>{c.waitlist.toLocaleString("en-US")}</dd></div>
        <div><dt>Excluded</dt><dd>{excluded.toLocaleString("en-US")}</dd></div>
      </dl>
      <p className={own.total}><b>{c.total.toLocaleString("en-US")}</b> {c.total === 1 ? "person gets" : "people get"} this email.</p>
      {c.excluded.length ? (
        <ul className={own.excl}>{c.excluded.map((e) => <li key={e.reason}><span>{e.reason}</span><b>{e.count.toLocaleString("en-US")}</b></li>)}</ul>
      ) : null}
      <p className={own.muted}>{expired ? "This preview ran out. Preview again before you send." : `The numbers are good until ${shortTime(preview.expiresAt)}.`}</p>
    </div>
  );
}

function shortTime(iso: string): string {
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "soon";
}

function Progress({ sent, failed, total }: { sent: number; failed: number; total: number }) {
  const done = total > 0 ? Math.min(100, ((sent + failed) / total) * 100) : 0;
  const bad = total > 0 ? Math.min(100, (failed / total) * 100) : 0;
  return (
    <div className={own.prog} role="progressbar" aria-label="Emails sent" aria-valuemin={0} aria-valuemax={total} aria-valuenow={sent + failed}>
      <span style={{ width: `${done}%` }} />
      {bad > 0 ? <span className={own.progBad} style={{ width: `${bad}%` }} /> : null}
      <em>{(sent + failed).toLocaleString("en-US")} of {total.toLocaleString("en-US")}</em>
    </div>
  );
}

/* ---------- confirm dialog ---------- */
const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled])";

function ConfirmDialog({ title, confirm, onConfirm, onCancel, children }: {
  title: string; confirm: string; onConfirm: () => void; onCancel: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const labelId = useId();
  const textId = useId();
  // Focus starts on Cancel, so a stray Enter does not send.
  useEffect(() => { cancelRef.current?.focus({ preventScroll: true }); }, []);
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); onCancel(); return; }
    if (e.key !== "Tab" || !ref.current) return;
    const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  return (
    <div className={own.scrim} onClick={onCancel}>
      <div ref={ref} className={own.confirm} role="alertdialog" aria-modal="true" aria-labelledby={labelId} aria-describedby={textId}
        onClick={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <h3 id={labelId}>{title}</h3>
        <p id={textId}>{children}</p>
        <div className={styles.crActs}>
          <button ref={cancelRef} type="button" className={styles.btn} onClick={onCancel}>Cancel</button>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onConfirm}>{confirm}</button>
        </div>
      </div>
    </div>
  );
}
