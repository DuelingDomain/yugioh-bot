"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { maskEmail, plural } from "@/lib/admin-console/format";
import { formatDayMonthUnlessThisYear } from "@/lib/admin-console/time";
import type {
  AddEmailResult, AddEmailsResponse, BusyResponse, CreateCreatorResponse, CreateLinkResponse, Creator, CreatorDetailResponse,
  CreatorGrant, CreatorLink, CreatorSummary, LinkState, ResendResponse, RevokeLinkResponse,
} from "@/lib/admin-console/creators-types";
import type { ConsoleActions } from "./admin-console";
import { Avatar, Icon, StatusIcon, Tag, type Tone } from "./parts";
import { refreshSection } from "./use-admin-section";
import styles from "./admin-console.module.css";

/* ---------- requests ---------- */
type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: string | null; retryAfterSeconds: number | null };

/** Same-origin JSON request. The browser adds Origin; the routes check it on every write. */
async function api<T>(url: string, method: "GET" | "POST" | "PATCH", body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      cache: "no-store",
      headers: method === "GET" ? undefined : { "content-type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    });
    const parsed: unknown = await res.json().catch(() => null);
    if (res.ok) return { ok: true, status: res.status, data: parsed as T };
    const fail = (parsed && typeof parsed === "object" ? parsed : {}) as Partial<BusyResponse> & { error?: unknown };
    return {
      ok: false, status: res.status, error: typeof fail.error === "string" ? fail.error : null,
      retryAfterSeconds: typeof fail.retryAfterSeconds === "number" ? fail.retryAfterSeconds : null,
    };
  } catch {
    return { ok: false, status: 0, error: null, retryAfterSeconds: null };
  }
}

/** "Busy. Try again in 3 minutes." from a 429 answer. */
export function busyText(retryAfterSeconds: number | null): string {
  const minutes = Math.max(1, Math.ceil((retryAfterSeconds ?? 60) / 60));
  return `Busy. Try again in ${plural(minutes, "minute", "minutes")}.`;
}

function failText(result: { status: number; error: string | null; retryAfterSeconds: number | null }, fallback: string): string {
  if (result.status === 429) return busyText(result.retryAfterSeconds);
  if (result.status === 404) return "This creator was not found. Close and refresh.";
  if (result.error === "creator_archived") return "This creator is archived. No invites can go out.";
  if (result.error === "clerk_not_configured") return "Clerk is not set up here, so no invite can go out.";
  if (result.status === 503) return "Clerk did not answer. Try again in a minute.";
  return fallback;
}

const base = (id: number) => `/api/admin/console/creators/${id}`;

/* ---------- small helpers ---------- */
function day(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "-";
  return formatDayMonthUnlessThisYear(ms);
}

/** Paste box text to unique emails, split on commas, semicolons, spaces and new lines. */
export function splitEmails(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    const email = part.trim().replace(/^<|>$/g, "");
    if (!email || seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    out.push(email);
  }
  return out;
}

const MAX_EMAILS = 20;
const LINK_TAG: Record<LinkState, { word: string; tone?: "gold" | "crit" | "warn" }> = {
  open: { word: "Open", tone: "gold" }, full: { word: "Full", tone: "warn" }, expired: { word: "Expired" }, revoked: { word: "Revoked", tone: "crit" },
};
const OUTCOME: Record<AddEmailResult["outcome"], { tone: Tone; word: string }> = {
  sent: { tone: "good", word: "Invite sent" },
  already: { tone: "info", word: "Already has an invite" },
  existing_account: { tone: "quiet", word: "Already has an account" },
  failed: { tone: "crit", word: "Not sent. Try again later." },
  invalid: { tone: "warn", word: "Not a valid email" },
};
const GRANT_STATE: Record<CreatorGrant["view"], { word: string; tone?: "good" | "warn" | "crit" }> = {
  sending: { word: "Sending" }, sent: { word: "Sent", tone: "good" }, failed: { word: "Failed", tone: "crit" },
  signed_up: { word: "Signed up", tone: "good" }, revoked: { word: "Revoked" }, expired: { word: "Expired", tone: "warn" },
};
const RESEND_TEXT: Record<ResendResponse["result"], string> = {
  sent: "Invite sent again.",
  existing_account: "This email already has an account. No invite was sent.",
  failed: "The invite was not sent. Try again later.",
  not_resendable: "This invite can not be sent again.",
  full: "The link is full. There is no free use for this invite.",
};

/* ---------- the sheet frame: right side on wide screens, bottom sheet on a phone ---------- */
const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]):not([type='hidden']), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])";

function SheetFrame({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus({ preventScroll: true }); }, []);
  // Keys stay inside the sheet: the console's 1-7 and "/" shortcuts must not switch the view under an open sheet.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    e.stopPropagation();
    const target = e.target as HTMLElement;
    if (e.key === "Escape") {
      if (target.closest("input, textarea, select")) { target.blur(); ref.current?.focus({ preventScroll: true }); return; }
      onClose();
      return;
    }
    if (e.key !== "Tab" || !ref.current) return;
    const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  return (
    <>
      <div className={styles.crScrim} onClick={onClose} aria-hidden="true" />
      <div ref={ref} className={styles.crSheet} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} onKeyDown={onKeyDown}>
        <button ref={closeRef} type="button" className={`${styles.btn} ${styles.btnSm} ${styles.crClose}`} onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        {children}
      </div>
    </>
  );
}

/* ---------- add creator ---------- */
const CREATE_ERRORS: Record<string, { field: "name" | "channelUrl" | "notes" | "email" | "form"; text: string }> = {
  invalid_name: { field: "name", text: "Enter a name of 1 to 80 characters." },
  invalid_channel_url: { field: "channelUrl", text: "Enter a full http or https link, up to 300 characters." },
  invalid_notes: { field: "notes", text: "Notes can have up to 1000 characters." },
  invalid_email: { field: "email", text: "Enter a valid email, or leave it empty." },
};

export function AddCreatorSheet({ onClose, onCreated, actions }: { onClose: () => void; onCreated: (creator: Creator) => void; actions: ConsoleActions }) {
  const [errors, setErrors] = useState<Partial<Record<"name" | "channelUrl" | "notes" | "email" | "form", string>>>({});
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const form = new FormData(e.currentTarget);
    const text = (key: string) => String(form.get(key) ?? "").trim();
    const name = text("name");
    if (!name) { setErrors({ name: "Enter the creator’s name." }); return; }
    setErrors({});
    setPending(true);
    const result = await api<CreateCreatorResponse>("/api/admin/console/creators", "POST", {
      name, channelUrl: text("channelUrl") || null, notes: text("notes") || null, email: text("email") || null,
    });
    setPending(false);
    if (!result.ok) {
      const known = result.error ? CREATE_ERRORS[result.error] : undefined;
      setErrors({ [known?.field ?? "form"]: known?.text ?? failText(result, "The creator was not added. Try again.") });
      return;
    }
    const email = result.data.email;
    actions.toast(email ? `Creator added. ${OUTCOME[email.outcome].word}.` : "Creator added.", email?.outcome === "failed" ? "crit" : undefined);
    refreshSection("creators");
    onCreated(result.data.creator);
  }

  return (
    <SheetFrame label="Add creator" onClose={onClose}>
      <div className={styles.crHead}>
        <h2>Add creator</h2>
        <p>Add the creator first. Then make invite links for their community.</p>
      </div>
      <form className={`${styles.crForm} ${styles.crBlock}`} onSubmit={submit} noValidate aria-busy={pending}>
        <CrField label="Name" error={errors.name} id="cr-name">
          {(aria) => <input id="cr-name" name="name" className={styles.crInput} maxLength={80} autoComplete="off" placeholder="Shown on the invite page" {...aria} />}
        </CrField>
        <CrField label="Channel link" optional error={errors.channelUrl} id="cr-url">
          {(aria) => <input id="cr-url" name="channelUrl" type="url" inputMode="url" className={styles.crInput} maxLength={300} placeholder="https://youtube.com/@name" autoComplete="off" {...aria} />}
        </CrField>
        <CrField label="Notes" optional error={errors.notes} id="cr-notes">
          {(aria) => <textarea id="cr-notes" name="notes" className={`${styles.crInput} ${styles.crNotes}`} maxLength={1000} placeholder="Only you see this" {...aria} />}
        </CrField>
        <CrField label="Creator’s email" optional error={errors.email} id="cr-email" hint="We send this person an invite now, so they can join at once.">
          {(aria) => <input id="cr-email" name="email" type="email" inputMode="email" className={styles.crInput} autoComplete="off" spellCheck={false} placeholder="name@example.com" {...aria} />}
        </CrField>
        {errors.form ? <p className={styles.crErr} role="alert">{errors.form}</p> : null}
        <div className={styles.crActs}>
          <button type="button" className={styles.btn} onClick={onClose} disabled={pending}>Cancel</button>
          <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={pending}><Icon name="plus" />{pending ? "Adding" : "Add creator"}</button>
        </div>
      </form>
    </SheetFrame>
  );
}

function CrField({ id, label, optional, error, hint, children }: {
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

/* ---------- one creator ---------- */
function useCreatorDetail(id: number) {
  const [state, setState] = useState<{ detail: CreatorDetailResponse | null; failed: "missing" | "error" | null }>({ detail: null, failed: null });
  const alive = useRef(true);
  const load = useCallback(async () => {
    const result = await api<CreatorDetailResponse>(base(id), "GET");
    if (!alive.current) return;
    if (result.ok) setState({ detail: result.data, failed: null });
    else setState((prev) => ({ detail: prev.detail, failed: result.status === 404 ? "missing" : "error" }));
  }, [id]);
  useEffect(() => {
    alive.current = true;
    void load();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 30_000);
    return () => { alive.current = false; clearInterval(timer); };
  }, [load]);
  return { ...state, reload: load };
}

export function CreatorSheet({ id, summary, budgetLeft, onClose, actions }: {
  id: number; summary: CreatorSummary | null; budgetLeft: number | null; onClose: () => void; actions: ConsoleActions;
}) {
  const { detail, failed, reload } = useCreatorDetail(id);
  const [reveal, setReveal] = useState(false);
  const creator = detail?.creator ?? summary;
  const name = creator?.name ?? "Creator";
  const mutated = useCallback(() => { refreshSection("creators"); void reload(); }, [reload]);
  const shown = (email: string) => (reveal ? email : maskEmail(email));

  return (
    <SheetFrame label={`Creator ${name}`} onClose={onClose}>
      <div className={styles.crHead}>
        <h2>{name}</h2>
        {creator?.channelUrl ? <p><a href={creator.channelUrl} target="_blank" rel="noopener noreferrer">{channelLabel(creator.channelUrl)}<Icon name="ext" /></a></p> : null}
        {creator?.notes ? <p>{creator.notes}</p> : null}
      </div>
      <dl className={styles.facts}>
        <div><dt>Invites sent</dt><dd>{creator ? creator.sent : "-"}</dd></div>
        <div><dt>Signed up</dt><dd>{creator ? creator.signedUp : "-"}</dd></div>
        <div><dt>Active, 7 days</dt><dd>{creator ? creator.active7d : "-"}</dd></div>
        <div><dt>Last sign-up</dt><dd>{creator?.lastSignUpAt ? day(creator.lastSignUpAt) : "-"}</dd></div>
      </dl>

      {failed === "missing" ? <p className={styles.crErr} role="alert">This creator was not found. It may be archived.</p>
        : failed === "error" && !detail ? (
          <div className={styles.crActs} role="alert"><span className={styles.crErr}>This creator did not load.</span><button type="button" className={`${styles.btn} ${styles.btnSm}`} onClick={() => void reload()}>Try again</button></div>
        ) : !detail ? <p className={styles.muted} role="status">Loading</p> : (
          <>
            <LinksBlock creatorId={id} detail={detail} actions={actions} onChange={mutated} />
            <EmailsBlock creatorId={id} budgetLeft={budgetLeft} shown={shown} actions={actions} onChange={mutated} />
            <JoinedBlock detail={detail} actions={actions} />
            <GrantsBlock grants={detail.grants} shown={shown} reveal={reveal} onReveal={() => setReveal((v) => !v)} actions={actions} onChange={mutated} />
            <ArchiveBlock creatorId={id} name={name} actions={actions} onArchived={() => { refreshSection("creators"); onClose(); }} />
          </>
        )}
    </SheetFrame>
  );
}

function channelLabel(url: string): string {
  try { const u = new URL(url); return `${u.hostname.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}`; } catch { return url; }
}

function BlockHead({ title, n, aside }: { title: string; n?: ReactNode; aside?: ReactNode }) {
  return (
    <div className={styles.crH}>
      <h3>{title}{n !== undefined ? <span className={styles.n}>{n}</span> : null}</h3>
      {aside}
    </div>
  );
}

async function copyText(text: string, actions: ConsoleActions) {
  try {
    await navigator.clipboard.writeText(text);
    actions.toast("Link copied.");
  } catch {
    actions.toast("Could not copy. Select the link and copy it.", "crit");
  }
}

/* links */
type Preset = "personal" | "friends" | "community" | "custom";
const PRESETS: Record<Exclude<Preset, "custom">, { label: string; maxUses: number; expiresInDays: number; hint: string }> = {
  personal: { label: "Personal", maxUses: 1, expiresInDays: 14, hint: "1 use, 14 days, any email" },
  friends: { label: "Friends", maxUses: 3, expiresInDays: 14, hint: "3 uses, 14 days" },
  community: { label: "Community", maxUses: 50, expiresInDays: 30, hint: "50 uses, 30 days" },
};

function LinksBlock({ creatorId, detail, actions, onChange }: { creatorId: number; detail: CreatorDetailResponse; actions: ConsoleActions; onChange: () => void }) {
  const [fresh, setFresh] = useState<{ url: string; label: string } | null>(null);
  const open = detail.links.filter((l) => l.state === "open").length;
  return (
    <section className={styles.crBlock} aria-label="Links">
      <BlockHead title="Links" n={detail.links.length ? `${open} open of ${detail.links.length}` : undefined} />
      {fresh ? (
        <div className={styles.crFresh} role="status">
          <span>New link ready{fresh.label ? `: ${fresh.label}` : ""}</span>
          <div className={styles.crUrl}>
            <code>{fresh.url}</code>
            <button type="button" className={`${styles.btn} ${styles.btnSm}`} onClick={() => void copyText(fresh.url, actions)} aria-label="Copy new link"><Icon name="copy" />Copy</button>
          </div>
        </div>
      ) : null}
      {detail.links.length === 0 ? <p className={styles.crNone}>No links yet. Make one below.</p> : (
        <ul style={{ listStyle: "none" }} aria-label="Invite links">
          {detail.links.map((link) => <LinkRow key={link.id} creatorId={creatorId} link={link} url={detail.linkUrls[link.id] ?? ""} actions={actions} onChange={onChange} />)}
        </ul>
      )}
      <NewLinkForm creatorId={creatorId} actions={actions} onCreated={(url, label) => { setFresh({ url, label }); onChange(); }} />
    </section>
  );
}

function LinkRow({ creatorId, link, url, actions, onChange }: { creatorId: number; link: CreatorLink; url: string; actions: ConsoleActions; onChange: () => void }) {
  const [phase, setPhase] = useState<"idle" | "confirm" | "pending">("idle");
  const [error, setError] = useState<string | null>(null);
  const label = link.label || "Untitled link";
  const tag = LINK_TAG[link.state];
  const closed = link.state === "expired" || link.state === "revoked";
  const now = Date.now();

  async function revoke() {
    setPhase("pending");
    setError(null);
    const result = await api<RevokeLinkResponse>(`${base(creatorId)}/links/${link.id}/revoke`, "POST", {});
    setPhase("idle");
    if (!result.ok) { setError(failText(result, "The link was not revoked. Try again.")); return; }
    const n = result.data.invitationsRevoked;
    actions.toast(n > 0 ? `Link revoked. ${plural(n, "unused invite", "unused invites")} cancelled.` : "Link revoked.");
    onChange();
  }

  return (
    <li className={styles.crLink}>
      <div className={styles.crLinkTop}>
        <b>{label}</b>
        <Tag tone={tag.tone}>{tag.word}</Tag>
        <span className={styles.crUses}>{link.used} / {link.maxUses} used</span>
      </div>
      <div className={styles.crUrl} data-closed={closed}>
        <code title={url}>{url || `/join/${link.code}`}</code>
        {!closed && url ? <button type="button" className={`${styles.btn} ${styles.btnSm}`} onClick={() => void copyText(url, actions)} aria-label={`Copy link ${label}`}><Icon name="copy" />Copy</button> : null}
      </div>
      <div className={styles.crMeta}>
        {link.lockedEmail ? <span>Locked: {maskEmail(link.lockedEmail)}</span> : null}
        <span>{plural(link.signedUp, "sign-up", "sign-ups")}</span>
        <span>{link.revokedAt ? `Revoked ${day(link.revokedAt)}` : link.expiresAt <= now ? `Ended ${day(link.expiresAt)}` : `Ends ${day(link.expiresAt)}`}</span>
        {link.state !== "revoked" ? (
          <span className={styles.crEnd}>
            {phase === "idle" ? (
              <button type="button" className={`${styles.btn} ${styles.btnSm}`} onClick={() => setPhase("confirm")} aria-label={`Revoke ${label}`}><Icon name="x" />Revoke</button>
            ) : (
              <>
                <span className={styles.crAsk} role="status">{phase === "pending" ? "Revoking" : "Revoke this link? Unused invites stop working."}</span>
                <button type="button" className={`${styles.btn} ${styles.btnSm}`} disabled={phase === "pending"} onClick={() => setPhase("idle")} autoFocus>Cancel</button>
                <button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.btnDanger}`} disabled={phase === "pending"} onClick={() => void revoke()}>Revoke</button>
              </>
            )}
          </span>
        ) : null}
      </div>
      {error ? <p className={styles.crErr} role="alert">{error}</p> : null}
    </li>
  );
}

function NewLinkForm({ creatorId, actions, onCreated }: { creatorId: number; actions: ConsoleActions; onCreated: (url: string, label: string) => void }) {
  const [preset, setPreset] = useState<Preset>("community");
  const [customUses, setCustomUses] = useState("10");
  const [lockedEmail, setLockedEmail] = useState("");
  const [lockError, setLockError] = useState<string>();
  const lockInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function choosePreset(next: Preset) {
    setPreset(next);
    setLockError(undefined);
  }

  function showLockError(message: string) {
    setError(null);
    setLockError(message);
    lockInput.current?.focus();
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const element = e.currentTarget;
    const form = new FormData(element);
    const typed = String(form.get("label") ?? "").trim().slice(0, 60);
    const lock = preset === "custom" ? lockedEmail.trim() || null : null;
    const maxUses = preset === "custom" ? (lock ? 1 : Number(form.get("maxUses"))) : PRESETS[preset].maxUses;
    const expiresInDays = Number(form.get("expiresInDays"));
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 500) { setError("Uses must be a whole number from 1 to 500."); return; }
    if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 90) { setError("Days must be a whole number from 1 to 90."); return; }
    const label = typed || (preset === "custom" ? null : PRESETS[preset].label);
    setError(null);
    setLockError(undefined);
    setPending(true);
    const result = await api<CreateLinkResponse>(`${base(creatorId)}/links`, "POST", { label, maxUses, expiresInDays, lockedEmail: lock });
    setPending(false);
    if (!result.ok && result.error === "invalid_locked_email") { showLockError("Enter a valid email in Locked to email."); return; }
    if (!result.ok) { setError(failText(result, result.status === 400 ? "Check the uses, days and label." : "The link was not made. Try again.")); return; }
    element.reset();
    setLockedEmail("");
    setCustomUses("10");
    actions.toast("Link made. Copy it from the top of the list.");
    onCreated(result.data.url, result.data.link.label ?? "");
  }

  return (
    <form className={`${styles.crForm} ${styles.crPanel}`} style={{ marginTop: 14 }} onSubmit={submit} noValidate aria-label="New link" aria-busy={pending}>
      <BlockHead title="New link" />
      <div className={styles.seg} role="group" aria-label="Link type">
        <button type="button" aria-pressed={preset === "personal"} onClick={() => choosePreset("personal")}>Personal<span>{PRESETS.personal.hint}</span></button>
        <button type="button" aria-pressed={preset === "friends"} onClick={() => choosePreset("friends")}>Friends<span>{PRESETS.friends.hint}</span></button>
        <button type="button" aria-pressed={preset === "community"} onClick={() => choosePreset("community")}>Community<span>{PRESETS.community.hint}</span></button>
        <button type="button" aria-pressed={preset === "custom"} onClick={() => choosePreset("custom")}>Custom</button>
      </div>
      <div className={preset === "custom" ? styles.crRow3 : styles.crRow2}>
        {preset === "custom" ? (
          <CrField id={`cr-uses-${creatorId}`} label="Uses">
            {(aria) => <input id={`cr-uses-${creatorId}`} name="maxUses" type="number" inputMode="numeric" min={1} max={500} value={lockedEmail.trim() ? "1" : customUses} onChange={(e) => setCustomUses(e.target.value)} disabled={!!lockedEmail.trim()} className={styles.crInput} {...aria} />}
          </CrField>
        ) : null}
        <CrField id={`cr-days-${creatorId}`} label="Days">
          {(aria) => <input key={preset} id={`cr-days-${creatorId}`} name="expiresInDays" type="number" inputMode="numeric" min={1} max={90} defaultValue={preset === "custom" ? 30 : PRESETS[preset].expiresInDays} className={styles.crInput} {...aria} />}
        </CrField>
        <CrField id={`cr-label-${creatorId}`} label="Label" optional>
          {(aria) => <input id={`cr-label-${creatorId}`} name="label" maxLength={60} autoComplete="off" className={styles.crInput} placeholder={preset === "custom" ? "For example: Stream 24 Oct" : PRESETS[preset].label} {...aria} />}
        </CrField>
      </div>
      {preset === "custom" ? (
        <CrField id={`cr-lock-${creatorId}`} label="Locked to email" optional error={lockError} hint="Only this inbox can claim the invite when set, with 1 use. Leave empty for any email.">
          {(aria) => <input ref={lockInput} id={`cr-lock-${creatorId}`} name="lockedEmail" type="email" maxLength={254} autoComplete="off" value={lockedEmail} onChange={(e) => { setLockedEmail(e.target.value); setLockError(undefined); }} className={styles.crInput} placeholder="creator@example.com" {...aria} />}
        </CrField>
      ) : <p className={styles.crHint}>Any email can claim this link and skip the waitlist. A use is counted when the invite email is sent.</p>}
      {error ? <p className={styles.crErr} role="alert">{error}</p> : null}
      <div className={styles.crActs}>
        <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={pending}><Icon name="link" />{pending ? "Making link" : "Make link"}</button>
      </div>
    </form>
  );
}

/* add emails */
function EmailsBlock({ creatorId, budgetLeft, shown, actions, onChange }: {
  creatorId: number; budgetLeft: number | null; shown: (email: string) => string; actions: ConsoleActions; onChange: () => void;
}) {
  const [text, setText] = useState("");
  const [results, setResults] = useState<AddEmailResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const emails = splitEmails(text);
  const tooMany = emails.length > MAX_EMAILS;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || emails.length === 0 || tooMany) return;
    setPending(true);
    setError(null);
    const result = await api<AddEmailsResponse>(`${base(creatorId)}/emails`, "POST", { emails });
    setPending(false);
    if (!result.ok) {
      setError(result.error === "too_many_emails" ? `Send up to ${MAX_EMAILS} emails at a time.` : failText(result, "The invites were not sent. Try again."));
      return;
    }
    const list = result.data.results;
    setResults(list);
    // Keep only what still needs a fix or a retry in the box.
    setText(list.filter((r) => r.outcome === "failed" || r.outcome === "invalid").map((r) => r.email).join("\n"));
    const sent = list.filter((r) => r.outcome === "sent").length;
    actions.toast(sent ? `${plural(sent, "invite", "invites")} sent.` : "No new invites were sent.", list.some((r) => r.outcome === "failed") ? "crit" : undefined);
    onChange();
  }

  const id = `cr-emails-${creatorId}`;
  return (
    <section className={styles.crBlock} aria-label="Add emails">
      <BlockHead title="Add emails" aside={budgetLeft !== null ? <span className={styles.aside}>{plural(budgetLeft, "send", "sends")} left this hour</span> : null} />
      <form className={styles.crForm} onSubmit={submit} noValidate aria-busy={pending}>
        <div className={styles.crField}>
          <label className={styles.srOnly} htmlFor={id}>Emails to invite</label>
          <textarea id={id} className={styles.crInput} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} autoComplete="off"
            placeholder={"one@example.com, two@example.com"} aria-describedby={`${id}-hint`} aria-invalid={tooMany ? true : undefined} />
          <p className={tooMany ? styles.crErr : styles.crHint} id={`${id}-hint`} role={tooMany ? "alert" : undefined}>
            {tooMany ? `Up to ${MAX_EMAILS} emails at a time. This box has ${emails.length}.`
              : `Up to ${MAX_EMAILS}. Split with commas, spaces or new lines. Each person gets their own invite email.`}
          </p>
        </div>
        {error ? <p className={styles.crErr} role="alert">{error}</p> : null}
        <div className={styles.crActs}>
          <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={pending || emails.length === 0 || tooMany}>
            {pending ? "Sending" : emails.length > 1 ? `Send ${emails.length} invites` : "Send invite"}
          </button>
          {budgetLeft !== null && emails.length > budgetLeft ? <span className={styles.aside}>Only {budgetLeft} can go out this hour.</span> : null}
        </div>
      </form>
      {results && results.length > 0 ? (
        <ul className={styles.crRes} style={{ listStyle: "none" }} aria-label="Email results">
          {results.map((r) => (
            <li key={r.email} className={styles.crResRow}>
              <StatusIcon tone={OUTCOME[r.outcome].tone} />
              <b>{shown(r.email)}</b>
              <span>{OUTCOME[r.outcome].word}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/* joined people */
function JoinedBlock({ detail, actions }: { detail: CreatorDetailResponse; actions: ConsoleActions }) {
  return (
    <section className={styles.crBlock} aria-label="Joined people">
      <BlockHead title="Joined" n={detail.joined.length} />
      {detail.joined.length === 0 ? <p className={styles.crNone}>Nobody joined through this creator yet.</p> : (
        <div>
          {detail.joined.map((p) => (
            <button key={p.userId} type="button" className={styles.crPerson} onClick={() => actions.openPerson(p.userId)} aria-label={`Open ${p.displayName}`}>
              <Avatar name={p.displayName} url={p.imageUrl} size="sm" />
              <span className={styles.minw}>
                <span className={styles.nm} style={{ display: "block" }}>{p.displayName}</span>
                <small>@{p.username} · via {p.via}</small>
              </span>
              <span className={styles.crWhen}>{p.active7d ? <b>Active</b> : null}{day(p.signedUpAt)}</span>
              <span className={styles.chev}><Icon name="chev" /></span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/* invites not used yet */
function GrantsBlock({ grants, shown, reveal, onReveal, actions, onChange }: {
  grants: CreatorGrant[]; shown: (email: string) => string; reveal: boolean; onReveal: () => void; actions: ConsoleActions; onChange: () => void;
}) {
  const [rows, setRows] = useState<Record<number, { pending?: boolean; message?: string; bad?: boolean }>>({});

  async function resend(grant: CreatorGrant) {
    setRows((prev) => ({ ...prev, [grant.id]: { pending: true } }));
    const result = await api<ResendResponse>(`/api/admin/console/creators/grants/${grant.id}/resend`, "POST", {});
    const message = result.ok ? RESEND_TEXT[result.data.result] ?? "Done." : failText(result, "The invite was not sent. Try again.");
    const bad = !result.ok || result.data.result !== "sent";
    setRows((prev) => ({ ...prev, [grant.id]: { message, bad } }));
    actions.toast(message, bad ? "crit" : undefined);
    if (result.ok) onChange();
  }

  return (
    <section className={styles.crBlock} aria-label="Invites not used yet">
      <BlockHead title="Invites not used yet" n={grants.length}
        aside={grants.length > 0 ? (
          <button type="button" className={`${styles.btn} ${styles.btnSm}`} aria-pressed={reveal} onClick={onReveal}><Icon name="eye" />{reveal ? "Hide emails" : "Show emails"}</button>
        ) : null} />
      {grants.length === 0 ? <p className={styles.crNone}>Every invite was used, or none went out yet.</p> : (
        <ul style={{ listStyle: "none" }} aria-label="Unused invites">
          {grants.map((g) => {
            const state = GRANT_STATE[g.view];
            const row = rows[g.id];
            const via = g.linkLabel ?? (g.kind === "allowlist" ? "Email" : "Link");
            const label = shown(g.email);
            return (
              <li key={g.id} className={styles.crGrant}>
                <span className={styles.minw}>
                  <b title={reveal ? g.email : undefined}>{label}</b>
                  <small>{via} · {g.sentAt ? `sent ${day(g.sentAt)}` : `added ${day(g.createdAt)}`}{row?.message ? ` · ${row.message}` : ""}</small>
                </span>
                <span className={styles.crState} data-tone={state.tone}>{state.word}</span>
                {g.resendable ? (
                  <button type="button" className={`${styles.btn} ${styles.btnSm}`} disabled={row?.pending} onClick={() => void resend(g)} aria-label={`Resend invite to ${label}`}>{row?.pending ? "Sending" : "Resend"}</button>
                ) : <span />}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* archive */
function ArchiveBlock({ creatorId, name, actions, onArchived }: { creatorId: number; name: string; actions: ConsoleActions; onArchived: () => void }) {
  const [phase, setPhase] = useState<"idle" | "confirm" | "pending">("idle");
  const [error, setError] = useState<string | null>(null);
  async function archive() {
    setPhase("pending");
    setError(null);
    const result = await api<{ creator: Creator }>(base(creatorId), "PATCH", { archived: true });
    if (!result.ok) { setPhase("confirm"); setError(failText(result, "The creator was not archived. Try again.")); return; }
    actions.toast(`${name} archived.`);
    onArchived();
  }
  return (
    <div className={styles.crDanger}>
      <p>Archive closes every link and stops unused invites.</p>
      <div className={styles.crActs}>
        {phase === "idle" ? (
          <button type="button" className={`${styles.btn} ${styles.btnDanger}`} onClick={() => setPhase("confirm")}>Archive creator</button>
        ) : (
          <>
            <span className={styles.crAsk} role="status">{phase === "pending" ? "Archiving" : `Archive ${name}?`}</span>
            <button type="button" className={styles.btn} disabled={phase === "pending"} onClick={() => { setPhase("idle"); setError(null); }} autoFocus>Cancel</button>
            <button type="button" className={`${styles.btn} ${styles.btnDanger}`} disabled={phase === "pending"} onClick={() => void archive()}>Archive</button>
          </>
        )}
      </div>
      {error ? <p className={styles.crErr} role="alert">{error}</p> : null}
    </div>
  );
}
