import { SigningRow } from "../fields";
import { SignInStep } from "../sign-in-step";
import shell from "../sign-in-shell.module.css";

export function SigningStep() {
  return (
    <SignInStep eyebrow="One moment" title={<>Signing you <em>in</em></>} screen="signing">
      <div className={shell.form}>
        <SigningRow>Opening Dueling Domain…</SigningRow>
      </div>
    </SignInStep>
  );
}
