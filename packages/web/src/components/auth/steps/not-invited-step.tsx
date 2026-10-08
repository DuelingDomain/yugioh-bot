"use client";

import { useEffect, useRef, useState } from "react";
import { DoneRow, NoteBox } from "../fields";
import { SignInBanner } from "../sign-in-error";
import { SignInFootLinks, SignInStep } from "../sign-in-step";
import shell from "../sign-in-shell.module.css";

export interface NotInvitedStepProps {
  identifier: string;
  waitlistUrl: string;
  onRetry(): void;
  /** Called once the email is on the list (new or already there), so the page can drop the error tone. */
  onJoined?(): void;
  /** Review page only: start on a state that is otherwise reached by a click and a response. */
  previewPhase?: WaitlistPhase;
}

export type WaitlistPhase = "idle" | "pending" | "joined" | "exists" | "limited" | "failed";

/** The same shape `POST /api/waitlist` checks. A username (Clerk also resolves those) fails it and keeps the marketing link. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
const isEmail = (value: string) => value.length <= 254 && EMAIL_SHAPE.test(value);

const ERROR_COPY: Record<"limited" | "failed", string> = {
  limited: "Too many tries. Try again in a few minutes.",
  failed: "Couldn’t add you just now. Try again.",
};

export function NotInvitedStep({ identifier, waitlistUrl, onRetry, onJoined, previewPhase = "idle" }: NotInvitedStepProps) {
  const email = identifier.trim();
  const [phase, setPhase] = useState<WaitlistPhase>(previewPhase);
  // A ref, not state: two clicks in one tick both see the same render, so state alone would let both through.
  const inFlight = useRef(false);
  // A failed try may still have saved the email (Clerk failed after the local row); a later "exists" is then this person's own join.
  const failedOnce = useRef(false);
  const confirmation = useRef<HTMLDivElement>(null);

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

  async function join() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPhase("pending");
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email, source: "app-not-invited" }),
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

  const pending = phase === "pending";
  return (
    <SignInStep
      eyebrow="Closed alpha"
      title={<>This email isn’t in the <em>alpha</em> yet</>}
      lede="Access opens in waves. Join the waitlist and we’ll email you when it’s your turn."
      screen="err-invite"
      foot={<SignInFootLinks waitlist={false} />}
    >
      <div className={shell.form} data-clerk="identifier-not-found" aria-busy={pending}>
        <NoteBox label="Email"><span data-email="">{identifier}</span></NoteBox>
        {(phase === "limited" || phase === "failed") && <SignInBanner tone="bad" code={phase}>{ERROR_COPY[phase]}</SignInBanner>}
        {isEmail(email) ? (
          <button type="button" className={`${shell.btn} ${shell["btn-primary"]}`} disabled={pending} onClick={join}>
            {pending && <span className={shell.spinner} aria-hidden="true" />}
            <span>Join the waitlist</span>
          </button>
        ) : (
          <a className={`${shell.btn} ${shell["btn-primary"]}`} href={waitlistUrl}>Join the waitlist</a>
        )}
        <button type="button" className={`${shell.btn} ${shell["btn-alt"]}`} onClick={onRetry} disabled={pending}>Try a different email</button>
      </div>
    </SignInStep>
  );
}
