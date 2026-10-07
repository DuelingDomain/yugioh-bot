"use client";

import { useRef, type FormEvent } from "react";
import { CaptchaPlaceholder, ConsentCheckbox, DiscordButton, LockedInput, OrDivider, PasswordField, TextField } from "../fields";
import { SignInBanner } from "../sign-in-error";
import { SignInFootLinks, SignInStep } from "../sign-in-step";
import shell from "../sign-in-shell.module.css";
import type { AuthBanner } from "@/lib/auth-flow";

export interface CreateAccountStepProps {
  lockedEmail: string;
  errors: { username?: string; password?: string; legal?: string };
  banner?: AuthBanner | null;
  pending: boolean;
  onSubmit(v: { username: string; password: string; legalAccepted: boolean }): void;
  onDiscord(v: { username: string; legalAccepted: boolean }): void;
  /**
   * True on the SSO-callback missing-requirements card: the person already chose Discord, so only username and consent
   * are asked. The password field and the Discord button are left out and `onSubmit` gets an empty password.
   */
  passwordOptional?: boolean;
  /** Pre-fills the username (preview page only; a live form keeps what was typed). */
  defaultUsername?: string;
  /**
   * Draws the framed bot-check placeholder, which carries `#clerk-captcha` (preview page only). Live pages leave this off:
   * the page owns the single `#clerk-captcha` node (`AuthFlowShell`), so the step never renders one.
   */
  captchaPlaceholder?: boolean;
}

function readForm(form: HTMLFormElement) {
  const data = new FormData(form);
  return {
    username: String(data.get("username") ?? "").trim(),
    password: String(data.get("password") ?? ""),
    legalAccepted: data.get("legal") !== null,
  };
}

export function CreateAccountStep({ lockedEmail, errors, banner, pending, onSubmit, onDiscord, passwordOptional = false, defaultUsername, captchaPlaceholder = false }: CreateAccountStepProps) {
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    onSubmit(readForm(event.currentTarget));
  }

  function handleDiscord() {
    if (pending || !formRef.current) return;
    const { username, legalAccepted } = readForm(formRef.current);
    onDiscord({ username, legalAccepted });
  }

  return (
    <SignInStep
      eyebrow="Invite accepted"
      title={<>You’re in the <em>alpha</em></>}
      lede="Finish your account to start drafting."
      screen={errors.username ? "err-username" : "invite"}
      foot={<SignInFootLinks lead={<p>Already have an account? <a className={shell.link} href="/sign-in">Sign in</a></p>} />}
    >
      <form ref={formRef} className={shell.form} data-clerk="sign-up-continue" noValidate aria-busy={pending} onSubmit={handleSubmit}>
        {banner && <SignInBanner tone={banner.tone} code={banner.code}>{banner.body}</SignInBanner>}
        <LockedInput id="f-iem" name="emailAddress" label="Email address" value={lockedEmail} hint="From your invite. It can’t be changed." />
        <TextField
          id="f-un"
          name="username"
          label="Username"
          autoComplete="username"
          placeholder="Pick a username"
          defaultValue={defaultUsername}
          error={errors.username}
          hint={errors.username ? undefined : "Other players see this. Letters, numbers and underscores."}
        />
        {!passwordOptional && (
          <PasswordField id="f-cp" name="password" label="Create password" autoComplete="new-password" error={errors.password} hint="At least 8 characters." />
        )}
        <ConsentCheckbox name="legal" error={errors.legal} />
        {captchaPlaceholder && <CaptchaPlaceholder />}
        <button className={`${shell.btn} ${shell["btn-primary"]}`} type="submit" disabled={pending}>Create account</button>
        {!passwordOptional && (
          <>
            <OrDivider />
            <DiscordButton onClick={handleDiscord} pending={pending} fineId="fine-discord2" />
          </>
        )}
      </form>
    </SignInStep>
  );
}
