"use client";

import { SignInFootLinks, SignInStep } from "../sign-in-step";
import shell from "../sign-in-shell.module.css";

export interface AccountUnavailableStepProps {
  onBack(): void;
}

/** No emphasis in the title: "sign in" is not an alarming word to gold (README, Design fix). */
export function AccountUnavailableStep({ onBack }: AccountUnavailableStepProps) {
  return (
    <SignInStep
      eyebrow="Account"
      title="This account can’t sign in"
      lede="If you think that’s a mistake, reach out to the alpha team."
      screen="err-banned"
      foot={<SignInFootLinks waitlist={false} />}
    >
      <div className={shell.form} data-clerk="account-locked">
        <button type="button" className={`${shell.btn} ${shell["btn-alt"]}`} onClick={onBack}>Back to sign in</button>
        <a className={`${shell.btn} ${shell["btn-alt"]}`} href="mailto:support@duelingdomain.com">Contact support</a>
      </div>
    </SignInStep>
  );
}
