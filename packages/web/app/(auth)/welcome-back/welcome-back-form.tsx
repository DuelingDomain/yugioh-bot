"use client";

import { useRef, useState, type FormEvent } from "react";
import { ConsentCheckbox } from "@/components/auth/fields";
import { hardNavigate } from "@/components/auth/navigate";
import { SignInBanner } from "@/components/auth/sign-in-error";
import shell from "@/components/auth/sign-in-shell.module.css";

export function WelcomeBackForm() {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [legalError, setLegalError] = useState<string>();
  const [error, setError] = useState<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const consent = new FormData(event.currentTarget).has("legal");
    if (!consent) { setLegalError("Accept the terms and privacy policy to continue."); return; }
    setLegalError(undefined); setError(undefined); busy.current = true; setPending(true);
    try {
      const response = await fetch("/api/auth/existing-player/complete", { method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ consent: true }) });
      const body = await response.json();
      if (response.ok && body.redirectTo === "/sign-in?existing_player=1") hardNavigate(body.redirectTo);
      else setError(typeof body.error === "string" ? body.error : "Sign-in is having trouble. Try again in a moment.");
    } catch { setError("Sign-in is having trouble. Try again in a moment."); }
    finally { busy.current = false; setPending(false); }
  }
  return <form className={shell.form} noValidate aria-busy={pending} onSubmit={submit}>
    {error && <SignInBanner tone="bad">{error}</SignInBanner>}
    <ConsentCheckbox name="legal" error={legalError} />
    <button type="submit" className={`${shell.btn} ${shell["btn-primary"]}`} disabled={pending}>Continue</button>
  </form>;
}
