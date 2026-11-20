"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { DoneRow, HeardFromSelect, TextField, readHeardFrom } from "./fields";
import { signInHref } from "./marketing-links";
import { SignInBanner } from "./sign-in-error";
import { SignInShell } from "./sign-in-shell";
import { SignInFootLinks, SignInStep } from "./sign-in-step";
import shell from "./sign-in-shell.module.css";

import type { WaitlistView } from "@/lib/waitlist-views";

const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
const isEmail = (value: string) => value.length <= 254 && EMAIL_SHAPE.test(value);

/**
 * `/waitlist`: the one place to join. Discord sign-in lands here with the result (the email was already taken from Discord);
 * the sign-in links open the form directly. No bounce to the marketing page, and every state has a way back to sign in.
 */
export function WaitlistCard({ marketingUrl, initial }: { marketingUrl: string | null; initial: WaitlistView }) {
  const [view, setView] = useState<WaitlistView>(initial);
  const [email, setEmail] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string>();
  const [banner, setBanner] = useState<string | null>(initial === "retry" ? "We couldn’t add you just now. Enter your email to try again." : null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const head = useRef<HTMLDivElement>(null);

  // Move focus to the new heading after a join, so a screen reader reads the confirmation.
  useEffect(() => {
    if (view !== "joined" || email === null) return;
    const heading = head.current?.closest("section")?.querySelector("h1");
    if (heading) { heading.tabIndex = -1; heading.focus(); }
  }, [view, email]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const data = new FormData(event.currentTarget);
    const value = String(data.get("email") ?? "").trim();
    if (!isEmail(value)) { setFieldError("Enter a valid email."); return; }
    inFlight.current = true; setPending(true); setFieldError(undefined); setBanner(null);
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ email: value, source: "app-not-invited", ...readHeardFrom(data) }),
      });
      if (response.status === 429) setBanner("Too many tries. Try again in a few minutes.");
      else if (response.status === 400) setFieldError("Enter a valid email.");
      else if (!response.ok) setBanner("Couldn’t add you just now. Try again.");
      else { setEmail(value); setView("joined"); }
    } catch { setBanner("Couldn’t reach the list. Check your connection and try again."); }
    finally { inFlight.current = false; setPending(false); }
  }

  const back = <a className={`${shell.btn} ${shell["btn-alt"]}`} href={signInHref("/dashboard")}>Back to sign in</a>;
  let step;
  if (view === "joined") {
    step = (
      <SignInStep eyebrow="Closed alpha" title={<>You’re on the <em>waitlist</em></>} screen="waitlist-joined" foot={<SignInFootLinks waitlist={false} />}
        lede={email ? <>We’ll email <span data-email="">{email}</span> when it’s your turn.</> : "We’ll email the address on your Discord account when it’s your turn."}>
        <div ref={head} className={shell.form} data-clerk="waitlist-joined">
          <DoneRow title="On the waitlist" subtitle="Nothing else to do for now." />
          {back}
        </div>
      </SignInStep>
    );
  } else if (view === "invited") {
    step = (
      <SignInStep eyebrow="Closed alpha" title={<>You’re <em>invited</em></>} screen="waitlist-invited" foot={<SignInFootLinks waitlist={false} />}
        lede="We already sent your invite. Open that email and use its link to make your account. You can pick Discord there.">
        <div className={shell.form} data-clerk="waitlist-invited">{back}</div>
      </SignInStep>
    );
  } else if (view === "account") {
    step = (
      <SignInStep eyebrow="Closed alpha" title={<>You already have an <em>account</em></>} screen="waitlist-account" foot={<SignInFootLinks waitlist={false} />}
        lede="Your Discord email already has an account. Sign in with that email. You can connect Discord later in Settings.">
        <div className={shell.form} data-clerk="waitlist-account">{back}</div>
      </SignInStep>
    );
  } else {
    step = (
      <SignInStep eyebrow="Closed alpha" title={<>Join the <em>waitlist</em></>} screen="waitlist-form" foot={<SignInFootLinks waitlist={false} />}
        lede="Access opens in waves. Enter your email and we’ll write when it’s your turn. You can use any email, not only your Discord one.">
        <form className={shell.form} data-clerk="waitlist-form" noValidate aria-busy={pending} onSubmit={submit}>
          {banner && <SignInBanner tone="bad" code="waitlist">{banner}</SignInBanner>}
          <TextField id="f-waitlist-email" name="email" type="email" label="Email address" autoComplete="email" inputMode="email" placeholder="you@email.com" error={fieldError} autoFocus />
          <HeardFromSelect id="f-heard-wl" />
          <button className={`${shell.btn} ${shell["btn-primary"]}`} type="submit" disabled={pending}>
            {pending && <span className={shell.spinner} aria-hidden="true" />}
            <span>Join the waitlist</span>
          </button>
          {back}
        </form>
      </SignInStep>
    );
  }
  return <SignInShell marketingUrl={marketingUrl ?? undefined} packState={view === "joined" || view === "invited" ? "open" : "sealed"}>{step}</SignInShell>;
}
