import { SigningRow } from "../fields";
import { SignInStep } from "../sign-in-step";
import shell from "../sign-in-shell.module.css";
import { PRIVACY_URL, TERMS_URL } from "../legal-links";

/**
 * An approved invite opens straight into Discord: no username, password or form. The page leaves for Discord a moment
 * after this card paints; "Use email instead" cancels that and shows the email-code form. Continuing is consent.
 */
export function DiscordInviteStep({ lockedEmail, onUseEmail }: { lockedEmail: string; onUseEmail(): void }) {
  return (
    <SignInStep eyebrow="Invite accepted" title={<>You’re in the <em>alpha</em></>} lede={`Opening Discord to finish your account for ${lockedEmail}.`} screen="discord-invite">
      <div className={shell.form}>
        <SigningRow>Opening Discord…</SigningRow>
        <p className={shell.fine}>By continuing you agree to the <a href={TERMS_URL}>Terms</a> and <a href={PRIVACY_URL}>Privacy Policy</a>.</p>
        <button type="button" className={`${shell.btn} ${shell["btn-alt"]}`} onClick={onUseEmail}>Use email instead</button>
      </div>
    </SignInStep>
  );
}
