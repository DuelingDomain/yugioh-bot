"use client";

import type { FormEvent } from "react";
import { DiscordButton, OrDivider, TextField } from "../fields";
import { SignInBanner } from "../sign-in-error";
import { SignInFootLinks, SignInStep } from "../sign-in-step";
import shell from "../sign-in-shell.module.css";
import type { AuthBanner } from "./types";

export interface IdentifierStepProps {
  identifier?: string;
  error?: string;
  banner?: AuthBanner | null;
  pending: boolean;
  onSubmit(identifier: string): void;
  onDiscord(): void;
  /** Feeds the "Join the waitlist" foot line; the line is left out without it. */
  marketingUrl?: string;
}

export function IdentifierStep({ identifier, error, banner, pending, onSubmit, onDiscord, marketingUrl }: IdentifierStepProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    onSubmit(String(new FormData(event.currentTarget).get("identifier") ?? "").trim());
  }

  return (
    <SignInStep
      eyebrow="Closed alpha"
      title={<>Welcome <em>back</em></>}
      lede="Sign in to your drafts, decks and duels."
      screen={banner ? "err-service" : "signin"}
      foot={<SignInFootLinks marketingUrl={marketingUrl} />}
    >
      <form className={shell.form} data-clerk="sign-in-start" noValidate aria-busy={pending} onSubmit={handleSubmit}>
        {banner && <SignInBanner tone={banner.tone} code={banner.code}>{banner.body}</SignInBanner>}
        <DiscordButton onClick={onDiscord} pending={pending} fineId="fine-discord" />
        <OrDivider />
        <TextField
          id="f-email"
          name="identifier"
          type="email"
          label="Email address"
          autoComplete="username"
          inputMode="email"
          placeholder="you@email.com"
          defaultValue={identifier}
          error={error}
        />
        <button className={`${shell.btn} ${shell["btn-primary"]}`} type="submit" disabled={pending}>Continue</button>
      </form>
    </SignInStep>
  );
}
