"use client";

import type { FormEvent } from "react";
import { PasswordField } from "../fields";
import { SignInFootLinks, SignInStep } from "../sign-in-step";
import shell from "../sign-in-shell.module.css";

export interface NewPasswordStepProps {
  errors: { newPassword?: string; confirm?: string };
  pending: boolean;
  onSubmit(password: string, confirm: string): void;
  /** Email the reset was sent for; the lede falls back to "your account" without it. */
  identifier?: string | null;
}

export function NewPasswordStep({ errors, pending, onSubmit, identifier }: NewPasswordStepProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    onSubmit(String(data.get("newPassword") ?? ""), String(data.get("confirm") ?? ""));
  }

  return (
    <SignInStep
      eyebrow="Reset"
      title={<>Set a new <em>password</em></>}
      lede={identifier ? <>Choose a password for <span data-email="">{identifier}</span>.</> : "Choose a password for your account."}
      screen="newpw"
      foot={<SignInFootLinks waitlist={false} />}
    >
      <form className={shell.form} data-clerk="reset-password" noValidate aria-busy={pending} onSubmit={handleSubmit}>
        <PasswordField id="f-np" name="newPassword" label="New password" autoComplete="new-password" error={errors.newPassword} hint="At least 8 characters." autoFocus />
        <PasswordField id="f-np2" name="confirm" label="Confirm password" autoComplete="new-password" error={errors.confirm} />
        <button className={`${shell.btn} ${shell["btn-primary"]}`} type="submit" disabled={pending}>Save password</button>
      </form>
    </SignInStep>
  );
}
