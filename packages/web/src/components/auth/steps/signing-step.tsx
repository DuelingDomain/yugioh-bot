import { SigningRow } from "../fields";
import { SignInBanner } from "../sign-in-error";
import { SignInStep } from "../sign-in-step";
import shell from "../sign-in-shell.module.css";
import type { AuthBanner } from "@/lib/auth-flow";

export interface SigningStepProps {
  /**
   * Set when the flow failed while it was already on this card (finalize error, timeout, a callback that cannot resume).
   * The spinner row is replaced by the banner and a retry, so the card never spins forever.
   */
  banner?: AuthBanner | null;
  onRetry?(): void;
}

export function SigningStep({ banner, onRetry }: SigningStepProps = {}) {
  if (banner) {
    return (
      <SignInStep eyebrow="Sign-in" title={<>Let’s try that <em>again</em></>} screen="err-service">
        <div className={shell.form}>
          <SignInBanner tone={banner.tone} code={banner.code}>{banner.body}</SignInBanner>
          {onRetry && <button type="button" className={`${shell.btn} ${shell["btn-alt"]}`} onClick={onRetry}>Try again</button>}
        </div>
      </SignInStep>
    );
  }
  return (
    <SignInStep eyebrow="One moment" title={<>Signing you <em>in</em></>} screen="signing">
      <div className={shell.form}>
        <SigningRow>Opening Dueling Domain…</SigningRow>
      </div>
    </SignInStep>
  );
}
