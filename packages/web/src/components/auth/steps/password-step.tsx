"use client";

import type { FormEvent } from "react";
import { LinkButton, PasswordField } from "../fields";
import { SignInFootLinks, SignInStep } from "../sign-in-step";
import shell from "../sign-in-shell.module.css";
import styles from "../steps.module.css";

export interface PasswordStepProps {
  identifier: string;
  error?: string;
  pending: boolean;
  onSubmit(password: string): void;
  onForgot(): void;
  onBack(): void;
}

export function PasswordStep({ identifier, error, pending, onSubmit, onForgot, onBack }: PasswordStepProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    onSubmit(String(new FormData(event.currentTarget).get("password") ?? ""));
  }

  return (
    <SignInStep
      eyebrow="Step 2 of 2"
      title={<>Enter your <em>password</em></>}
      screen={error ? "err-password" : "password"}
      foot={<SignInFootLinks waitlist={false} />}
    >
      <form className={shell.form} data-clerk="sign-in-password" noValidate aria-busy={pending} onSubmit={handleSubmit}>
        <div className={styles.idrow}>
          <span className={styles.v}><span data-email="">{identifier}</span></span>
          <LinkButton onClick={onBack} disabled={pending}>Change <span className={shell.sr}>email</span></LinkButton>
        </div>
        <PasswordField
          id="f-pw"
          name="password"
          label="Password"
          autoComplete="current-password"
          error={error}
          hint="First time here with email? Use Forgot password to set one."
          autoFocus
        />
        <button className={`${shell.btn} ${shell["btn-primary"]}`} type="submit" disabled={pending}>Sign in</button>
        <div className={shell["alt-links"]}>
          <LinkButton onClick={onForgot} disabled={pending}>Forgot password?</LinkButton>
        </div>
      </form>
    </SignInStep>
  );
}
