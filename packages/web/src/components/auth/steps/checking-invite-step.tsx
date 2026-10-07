import { SigningRow } from "../fields";
import { SignInBanner } from "../sign-in-error";
import { SignInFootLinks, SignInStep } from "../sign-in-step";
import shell from "../sign-in-shell.module.css";
import type { AuthBanner } from "@/lib/auth-flow";

export interface CheckingInviteStepProps {
  /** Set when the invitation could not be opened (timeout, Clerk trouble). Shows the banner and a retry instead of spinning. */
  banner?: AuthBanner | null;
  onRetry?(): void;
}

/** Shown on the sign-up page until Clerk has consumed the invitation ticket and reported the locked email. */
export function CheckingInviteStep({ banner, onRetry }: CheckingInviteStepProps = {}) {
  return (
    <SignInStep
      eyebrow="Invite"
      title={banner ? <>Let’s try that <em>again</em></> : <>Checking your <em>invite</em></>}
      screen={banner ? "err-service" : "checking-invite"}
      foot={<SignInFootLinks waitlist={false} />}
    >
      <div className={shell.form}>
        {banner ? (
          <>
            <SignInBanner tone={banner.tone} code={banner.code}>{banner.body}</SignInBanner>
            {onRetry && <button type="button" className={`${shell.btn} ${shell["btn-alt"]}`} onClick={onRetry}>Try again</button>}
          </>
        ) : (
          <SigningRow>Opening your invitation…</SigningRow>
        )}
      </div>
    </SignInStep>
  );
}
