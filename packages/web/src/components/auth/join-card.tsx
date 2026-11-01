"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { JoinPageProps, LinkState } from "@/lib/admin-console/creators-types";
import { DoneRow, NoteBox, TextField } from "./fields";
import { SignInBanner } from "./sign-in-error";
import { SignInShell } from "./sign-in-shell";
import { SignInFootLinks, SignInStep } from "./sign-in-step";
import shell from "./sign-in-shell.module.css";

export interface JoinCardProps extends JoinPageProps {
  /** `creator:<code>` for a well-formed code, so waitlist leads from a closed link still count for the creator. */
  waitlistSource: string;
  marketingUrl: string | null;
}

/** The same shape `POST /api/waitlist` and `POST /api/join/<code>` check; the server checks it again. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
const isEmail = (value: string) => value.length <= 254 && EMAIL_SHAPE.test(value);
const BAD_EMAIL = "Enter a valid email address.";
const SENT_COPY = "If this email can join, your invite is on its way. Check your inbox.";

const busy = (seconds: number | null) => {
  const minutes = Math.max(1, Math.ceil((seconds ?? 60) / 60));
  return `Busy. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
};
const isClosed = (value: unknown): value is Exclude<LinkState, "open"> => value === "full" || value === "expired" || value === "revoked";

function SignInLead() {
  return <p>Already a member? <a className={shell.link} href="/sign-in">Sign in</a></p>;
}

/**
 * Moves focus to the card heading after the card changes, so a screen reader reads the new state. The first render is
 * skipped unless `onMount` is set (the card replaced another one after a submit). Returns a callback ref for any element.
 */
function useFocusHeading(key: string, onMount = false) {
  const node = useRef<HTMLElement | null>(null);
  const first = useRef(!onMount);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const heading = node.current?.closest("section")?.querySelector("h1");
    if (heading) { heading.tabIndex = -1; heading.focus(); }
  }, [key]);
  return useCallback((el: HTMLElement | null) => { node.current = el; }, []);
}

/** Hidden field that only bots fill. The routes answer as if it worked and write nothing. */
function Honeypot() {
  return (
    <div className={shell.sr} aria-hidden="true">
      <label>Company<input type="text" name="company" defaultValue="" tabIndex={-1} autoComplete="off" /></label>
    </div>
  );
}

/** `/join/<code>`: "Invited by <creator>" with one email field, or the closed card with the normal waitlist join. */
export function JoinCard({ code, state, creatorName, spotsLeft, waitlistSource, marketingUrl }: JoinCardProps) {
  const [link, setLink] = useState<LinkState>(state);
  return (
    <SignInShell marketingUrl={marketingUrl ?? undefined}>
      {link === "open"
        ? <InviteForm code={code} creatorName={creatorName} spotsLeft={spotsLeft} onClosed={setLink} />
        : <ClosedForm state={link} creatorName={creatorName} source={waitlistSource} announce={link !== state} />}
    </SignInShell>
  );
}

type InvitePhase = "idle" | "pending" | "sent";

function InviteForm({ code, creatorName, spotsLeft, onClosed }: { code: string; creatorName: string; spotsLeft: number; onClosed(state: LinkState): void }) {
  const [phase, setPhase] = useState<InvitePhase>("idle");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [banner, setBanner] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const inFlight = useRef(false);
  const anchor = useFocusHeading(phase === "sent" ? "sent" : "form");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const data = new FormData(event.currentTarget);
    const value = String(data.get("email") ?? "").trim();
    setBanner(null);
    if (!isEmail(value)) { setFieldError(BAD_EMAIL); return; }
    setFieldError(undefined);
    setEmail(value);
    inFlight.current = true;
    setPhase("pending");
    try {
      const response = await fetch(`/api/join/${encodeURIComponent(code)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email: value, company: String(data.get("company") ?? "") }),
      });
      const body = await response.json().catch(() => null) as { status?: unknown; error?: unknown; retryAfterSeconds?: unknown } | null;
      if (response.ok && body?.status === "sent") { setPhase("sent"); return; }
      setPhase("idle");
      if ((response.status === 409 || response.status === 404) && isClosed(body?.status)) { onClosed(body.status); return; }
      if (response.status === 404) { onClosed("revoked"); return; }
      if (response.status === 400 && body?.error === "invalid_email") { setFieldError(BAD_EMAIL); return; }
      if (response.status === 403 && body?.error === "email_mismatch") {
        setFieldError("This invite is for a different email address.");
        return;
      }
      if (response.status === 429) {
        const header = Number(response.headers.get("retry-after"));
        setBanner(busy(typeof body?.retryAfterSeconds === "number" ? body.retryAfterSeconds : Number.isFinite(header) && header > 0 ? header : null));
        return;
      }
      setBanner(response.status === 503 ? "We couldn’t send your invite just now. Try again in a minute." : "Something went wrong. Try again.");
    } catch {
      setPhase("idle");
      setBanner("We couldn’t reach Dueling Domain. Check your connection and try again.");
    } finally {
      inFlight.current = false;
    }
  }

  if (phase === "sent") {
    return (
      <SignInStep eyebrow="Creator invite" title={<>Check your <em>inbox</em></>} lede={SENT_COPY} screen="join-sent" foot={<SignInFootLinks lead={<SignInLead />} />}>
        <div ref={anchor} className={shell.form} data-status="sent">
          <DoneRow title="Request received" subtitle={<>The email can take a few minutes. Look in spam too. <span className={shell.sr}>Sent for {email}</span></>} />
          <button type="button" className={`${shell.btn} ${shell["btn-alt"]}`} onClick={() => setPhase("idle")}>Use a different email</button>
        </div>
      </SignInStep>
    );
  }

  const pending = phase === "pending";
  return (
    <SignInStep
      eyebrow="Creator invite"
      title={creatorName ? <>Invited by <em>{creatorName}</em></> : <>You’re <em>invited</em></>}
      lede="Skip the waitlist. Enter your email and we’ll send your invite to the Dueling Domain closed alpha."
      screen="join-open"
      foot={<SignInFootLinks lead={<SignInLead />} />}
    >
      <form ref={anchor} className={shell.form} noValidate aria-busy={pending} onSubmit={submit} data-clerk="creator-join">
        <NoteBox label="Spots left">{spotsLeft.toLocaleString("en-US")}</NoteBox>
        {banner && <SignInBanner tone="bad" code="join">{banner}</SignInBanner>}
        <TextField id="f-join-email" name="email" label="Email address" type="email" autoComplete="email" inputMode="email" placeholder="you@email.com" defaultValue={email} error={fieldError} />
        <Honeypot />
        <button type="submit" className={`${shell.btn} ${shell["btn-primary"]}`} disabled={pending}>
          {pending && <span className={shell.spinner} aria-hidden="true" />}
          <span>Send my invite</span>
        </button>
        <p className={shell.fine}>We email you a sign-up link. It works for 7 days.</p>
      </form>
    </SignInStep>
  );
}

const CLOSED_COPY: Record<Exclude<LinkState, "open">, { title: ReactNode; lede: string }> = {
  full: { title: <>This invite link is <em>full</em></>, lede: "Every spot on this link is taken. Join the waitlist and we’ll email you when it’s your turn." },
  expired: { title: <>This invite link has <em>expired</em></>, lede: "This link is no longer active. Join the waitlist and we’ll email you when it’s your turn." },
  revoked: { title: <>This invite link is <em>closed</em></>, lede: "This link no longer works. Join the waitlist and we’ll email you when it’s your turn." },
};

type WaitlistPhase = "idle" | "pending" | "joined" | "exists";

function ClosedForm({ state, creatorName, source, announce }: { state: Exclude<LinkState, "open">; creatorName: string; source: string; announce: boolean }) {
  const [phase, setPhase] = useState<WaitlistPhase>("idle");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [banner, setBanner] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const inFlight = useRef(false);
  const joined = phase === "joined" || phase === "exists";
  // When an open link turned full on submit, this card replaced the form: focus its heading at once.
  const anchor = useFocusHeading(joined ? "joined" : `form-${state}`, announce);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const data = new FormData(event.currentTarget);
    const value = String(data.get("email") ?? "").trim();
    setBanner(null);
    if (!isEmail(value)) { setFieldError(BAD_EMAIL); return; }
    setFieldError(undefined);
    setEmail(value);
    inFlight.current = true;
    setPhase("pending");
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email: value, source, company: String(data.get("company") ?? "") }),
      });
      const body = await response.json().catch(() => null) as { status?: unknown; error?: unknown } | null;
      if (response.ok && (body?.status === "joined" || body?.status === "exists")) { setPhase(body.status); return; }
      setPhase("idle");
      if (response.status === 400 && body?.error === "invalid_email") { setFieldError(BAD_EMAIL); return; }
      setBanner(response.status === 429 ? "Too many tries. Try again in a few minutes." : "Couldn’t add you just now. Try again.");
    } catch {
      setPhase("idle");
      setBanner("Couldn’t add you just now. Try again.");
    } finally {
      inFlight.current = false;
    }
  }

  if (joined) {
    const already = phase === "exists";
    return (
      <SignInStep
        eyebrow="Closed alpha"
        title={already ? <>You’re already on the <em>list</em></> : <>You’re on the <em>list</em></>}
        lede={<>We’ll email <span data-email="">{email}</span> when it’s your turn.</>}
        screen="join-waitlisted"
        foot={<SignInFootLinks lead={<SignInLead />} />}
      >
        <div ref={anchor} className={shell.form} data-status={phase}>
          <DoneRow title={already ? "Already on the waitlist" : "On the waitlist"} subtitle="Nothing else to do for now." />
          <button type="button" className={`${shell.btn} ${shell["btn-alt"]}`} onClick={() => setPhase("idle")}>Use a different email</button>
        </div>
      </SignInStep>
    );
  }

  const pending = phase === "pending";
  const copy = CLOSED_COPY[state];
  return (
    <SignInStep eyebrow={creatorName && state !== "revoked" ? `Invite from ${creatorName}` : "Creator invite"} title={copy.title} lede={copy.lede} screen={`join-${state}`} foot={<SignInFootLinks lead={<SignInLead />} />}>
      <form ref={anchor} className={shell.form} noValidate aria-busy={pending} onSubmit={submit} data-clerk="creator-join-waitlist" data-state={state}>
        {banner && <SignInBanner tone="bad" code="waitlist">{banner}</SignInBanner>}
        <TextField id="f-join-wl-email" name="email" label="Email address" type="email" autoComplete="email" inputMode="email" placeholder="you@email.com" defaultValue={email} error={fieldError} />
        <Honeypot />
        <button type="submit" className={`${shell.btn} ${shell["btn-primary"]}`} disabled={pending}>
          {pending && <span className={shell.spinner} aria-hidden="true" />}
          <span>Join the waitlist</span>
        </button>
      </form>
    </SignInStep>
  );
}
