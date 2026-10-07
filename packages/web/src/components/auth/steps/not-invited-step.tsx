"use client";

import { NoteBox } from "../fields";
import { SignInFootLinks, SignInStep } from "../sign-in-step";
import shell from "../sign-in-shell.module.css";

export interface NotInvitedStepProps {
  identifier: string;
  waitlistUrl: string;
  onRetry(): void;
}

export function NotInvitedStep({ identifier, waitlistUrl, onRetry }: NotInvitedStepProps) {
  return (
    <SignInStep
      eyebrow="Closed alpha"
      title={<>This email isn’t in the <em>alpha</em> yet</>}
      lede="Access opens in waves. Join the waitlist and we’ll email you when it’s your turn."
      screen="err-invite"
      foot={<SignInFootLinks waitlist={false} />}
    >
      <div className={shell.form} data-clerk="identifier-not-found">
        <NoteBox label="Email"><span data-email="">{identifier}</span></NoteBox>
        <a className={`${shell.btn} ${shell["btn-primary"]}`} href={waitlistUrl}>Join the waitlist</a>
        <button type="button" className={`${shell.btn} ${shell["btn-alt"]}`} onClick={onRetry}>Try a different email</button>
      </div>
    </SignInStep>
  );
}
