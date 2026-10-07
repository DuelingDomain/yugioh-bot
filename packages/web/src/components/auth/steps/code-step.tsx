"use client";

import type { FormEvent } from "react";
import { FieldError, LinkButton, OtpInput, useSecondsUntil } from "../fields";
import { SignInBanner } from "../sign-in-error";
import { SignInFootLinks, SignInStep } from "../sign-in-step";
import shell from "../sign-in-shell.module.css";
import styles from "../steps.module.css";
import type { AuthBanner, CodePurpose } from "@/lib/auth-flow";

export interface CodeStepProps {
  purpose: CodePurpose;
  identifier: string | null;
  error?: string;
  /** Service trouble or other notice that is not about the code. */
  banner?: AuthBanner | null;
  pending: boolean;
  resendAvailableAt: number | null;
  onSubmit(code: string): void;
  onResend(): void;
  /** Leave out where the email is locked (the signup code step): the "Use a different email" link is then hidden. */
  onBack?(): void;
  /** Pre-fills the cells (preview page only). */
  defaultCode?: string;
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function CodeStep({ purpose, identifier, error, banner, pending, resendAvailableAt, onSubmit, onResend, onBack, defaultCode }: CodeStepProps) {
  const left = useSecondsUntil(resendAvailableAt);
  const waiting = left !== null && left > 0;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    onSubmit(String(new FormData(event.currentTarget).get("code") ?? ""));
  }

  return (
    <SignInStep
      eyebrow="Verify"
      title={<>Check your <em>email</em></>}
      lede={identifier ? <>We sent a 6-digit code to <span data-email="">{identifier}</span>.</> : "We sent a 6-digit code to your email."}
      screen="code"
      foot={<SignInFootLinks waitlist={false} />}
    >
      <form className={shell.form} data-clerk="verify-email-code" data-purpose={purpose} noValidate aria-busy={pending} onSubmit={handleSubmit}>
        {banner && <SignInBanner tone={banner.tone} code={banner.code}>{banner.body}</SignInBanner>}
        <div className={styles["otp-group"]}>
          <OtpInput
            key={resendAvailableAt}
            id="f-code"
            name="code"
            describedBy={error ? "f-code-err code-help" : "code-help"}
            invalid={Boolean(error)}
            defaultValue={defaultCode}
            autoFocus
          />
          {error && <FieldError id="f-code-err">{error}</FieldError>}
          <p className={styles.hint} id="code-help" style={{ textAlign: "center" }}>Paste works. The code expires in 10 minutes.</p>
        </div>
        <button className={`${shell.btn} ${shell["btn-primary"]}`} type="submit" disabled={pending}>Continue</button>
        <div className={styles.resend}>
          {waiting ? (
            <p>Resend code in&nbsp;<b suppressHydrationWarning>{clock(left)}</b></p>
          ) : (
            <LinkButton onClick={onResend} disabled={pending}>Resend code</LinkButton>
          )}
        </div>
        {onBack && (
          <div className={shell["alt-links"]}>
            <LinkButton onClick={onBack} disabled={pending}>Use a different email</LinkButton>
          </div>
        )}
      </form>
    </SignInStep>
  );
}
