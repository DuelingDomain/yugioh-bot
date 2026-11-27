"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { DoneRow, HeardFromSelect, TextField, type HeardFromValue } from "../fields";
import { SignInBanner } from "../sign-in-error";
import { SignInFootLinks, SignInStep } from "../sign-in-step";
import shell from "../sign-in-shell.module.css";

export interface NotInvitedStepProps {
  identifier: string;
  /** Field error from the sign-in check (shown under the email field). */
  error?: string;
  /** Banner from the sign-in check, e.g. the service is unreachable. */
  banner?: { tone: "bad" | "info"; body: string; code?: string } | null;
  /** The sign-in check is running. */
  pending?: boolean;
  /** Back to the first sign-in card. */
  onRetry(): void;
  /** Runs the sign-in check again with the edited email. The page moves on if it passes, or stays here if it does not. */
  onCheck?(email: string): void | Promise<void>;
  /** Called once the email is on the list (new or already there), so the page can drop the error tone. */
  onJoined?(): void;
  /** Review page only: start on a state that is otherwise reached by a click and a response. */
  previewPhase?: WaitlistPhase;
}

export type WaitlistPhase = "idle" | "pending" | "joined" | "exists" | "limited" | "failed";

/** The same shape `POST /api/waitlist` checks. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
const isEmail = (value: string) => value.length <= 254 && EMAIL_SHAPE.test(value);

const ERROR_COPY: Record<"limited" | "failed", string> = {
  limited: "Too many tries. Try again in a few minutes.",
  failed: "Couldn’t add you just now. Try again.",
};

export function NotInvitedStep({ identifier, error, banner, pending: checking = false, onRetry, onCheck, onJoined, previewPhase = "idle" }: NotInvitedStepProps) {
  const checked = identifier.trim();
  // The field is editable: `email` is what is typed now, `checked` is what the sign-in check last refused.
  const [email, setEmail] = useState(checked);
  const [localError, setLocalError] = useState<string>();
  const [stillClosed, setStillClosed] = useState<string | null>(null);
  const [phase, setPhase] = useState<WaitlistPhase>(previewPhase);
  // A ref, not state: two clicks in one tick both see the same render, so state alone would let both through.
  const inFlight = useRef(false);
  // A failed try may still have saved the email (Clerk failed after the local row); a later "exists" is then this person's own join.
  const failedOnce = useRef(false);
  const confirmation = useRef<HTMLDivElement>(null);
  const heard = useRef<HeardFromValue>({});
  const formRef = useRef<HTMLFormElement>(null);

  // Arriving on this card from a refused check: read the new heading first, the way the joined card does.
  useEffect(() => {
    const heading = formRef.current?.closest("section")?.querySelector("h1");
    if (heading) { heading.tabIndex = -1; heading.focus(); }
  }, []);

  const joined = phase === "joined" || phase === "exists";
  const notify = useRef(onJoined);
  notify.current = onJoined;
  useEffect(() => {
    if (!joined) return;
    notify.current?.();
    // The focused button is gone; move focus to the new heading so screen readers read the confirmation.
    const heading = confirmation.current?.closest("section")?.querySelector("h1");
    if (heading) { heading.tabIndex = -1; heading.focus(); }
  }, [joined]);

  const edited = email.trim() !== checked;
  const typed = (value: string) => { setEmail(value.trim()); setLocalError(undefined); };
  const valid = () => {
    if (isEmail(email)) return true;
    setLocalError("Enter a valid email.");
    return false;
  };

  async function check() {
    if (inFlight.current || checking || !onCheck || !valid()) return;
    inFlight.current = true;
    try {
      await onCheck(email);
      setStillClosed(email);
      // Still here, so the check did not move on. The pressed button was disabled meanwhile; put focus back in the field.
      formRef.current?.querySelector<HTMLInputElement>("#f-email-wl")?.focus();
    } finally {
      inFlight.current = false;
    }
  }

  // Enter after an edit asks the question the person just changed (is this email in?); otherwise it joins.
  // Handled on the keydown, not as a form submit: the Join button's own click would otherwise look like an Enter.
  function enter(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement)) return;
    event.preventDefault();
    if (edited && onCheck) void check();
    else void join();
  }

  async function join() {
    if (inFlight.current || checking || !valid()) return;
    inFlight.current = true;
    setPhase("pending");
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email, source: "app-not-invited", ...heard.current }),
      });
      if (response.status === 429) return setPhase("limited");
      if (!response.ok) { failedOnce.current = true; return setPhase("failed"); }
      const body: unknown = await response.json().catch(() => null);
      const status = body && typeof body === "object" ? (body as { status?: unknown }).status : undefined;
      setPhase(status === "joined" || (status === "exists" && failedOnce.current) ? "joined" : status === "exists" ? "exists" : "failed");
    } catch {
      failedOnce.current = true;
      setPhase("failed");
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
        screen="waitlist-joined"
        foot={<SignInFootLinks waitlist={false} />}
      >
        <div ref={confirmation} className={shell.form} data-clerk="waitlist-joined" data-status={phase}>
          <DoneRow title={already ? "Already on the waitlist" : "On the waitlist"} subtitle="Nothing else to do for now." />
          <button type="button" className={`${shell.btn} ${shell["btn-alt"]}`} onClick={onRetry}>Use a different email</button>
        </div>
      </SignInStep>
    );
  }

  const pending = phase === "pending" || checking;
  const shownBanner = banner && <SignInBanner tone={banner.tone} code={banner.code}>{banner.body}</SignInBanner>;
  return (
    <SignInStep
      eyebrow="Closed alpha"
      title={<>This email isn’t in the <em>alpha</em> yet</>}
      lede="Access opens in waves. Join the waitlist and we’ll email you when it’s your turn."
      screen="err-invite"
      foot={<SignInFootLinks waitlist={false} />}
    >
      <form ref={formRef} className={shell.form} data-clerk="identifier-not-found" noValidate aria-busy={pending} onSubmit={(event) => event.preventDefault()} onKeyDown={enter}>
        {shownBanner}
        {(phase === "limited" || phase === "failed") && <SignInBanner tone="bad" code={phase}>{ERROR_COPY[phase]}</SignInBanner>}
        <TextField
          id="f-email-wl"
          name="email"
          type="email"
          label="Email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@email.com"
          defaultValue={identifier}
          error={localError ?? (edited ? undefined : error)}
          onChange={typed}
        />
        {!edited && !pending && stillClosed === checked && !banner && !error && <SignInBanner tone="info" code="still-closed">Still not in the alpha. You can join the waitlist with this email.</SignInBanner>}
        <HeardFromSelect id="f-heard-wl" onChange={(value) => { heard.current = value; }} />
        <button type="button" className={`${shell.btn} ${shell["btn-primary"]}`} disabled={pending} onClick={() => void join()}>
          {phase === "pending" && <span className={shell.spinner} aria-hidden="true" />}
          <span>Join the waitlist</span>
        </button>
        {edited && onCheck ? (
          <button type="button" className={`${shell.btn} ${shell["btn-alt"]}`} onClick={check} disabled={pending}>
            {checking && <span className={shell.spinner} aria-hidden="true" />}
            <span>Check this email</span>
          </button>
        ) : (
          <button type="button" className={`${shell.btn} ${shell["btn-alt"]}`} onClick={onRetry} disabled={pending}>Try a different email</button>
        )}
      </form>
    </SignInStep>
  );
}
