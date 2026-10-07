"use client";

import { SignInFootLinks, SignInStep } from "../sign-in-step";
import shell from "../sign-in-shell.module.css";

export interface SignupClosedStepProps {
  waitlistUrl: string;
  onRetry(): void;
}

export function SignupClosedStep({ waitlistUrl, onRetry }: SignupClosedStepProps) {
  return (
    <SignInStep
      eyebrow="Closed alpha"
      title={<>You’re not in the <em>alpha</em> yet</>}
      lede="Accounts are created from an invite. Join the waitlist and we’ll email you when your wave opens."
      screen="err-signup"
      foot={<SignInFootLinks waitlist={false} />}
    >
      <div className={shell.form} data-clerk="sign-up-no-invite">
        <a className={`${shell.btn} ${shell["btn-primary"]}`} href={waitlistUrl}>Join the waitlist</a>
        <button type="button" className={`${shell.btn} ${shell["btn-alt"]}`} onClick={onRetry}>Back to sign in</button>
      </div>
    </SignInStep>
  );
}
