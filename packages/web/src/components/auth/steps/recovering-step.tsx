import { SigningRow } from "../fields";
import { SignInStep } from "../sign-in-step";
import shell from "../sign-in-shell.module.css";

/**
 * Between the two Discord trips of an existing player. Clerk refused the first (waitlist mode), so our server confirms the
 * Discord account itself. This card says so before the page leaves, so the second trip reads as intended. No actions.
 */
export function RecoveringStep() {
  return (
    <SignInStep eyebrow="Existing player?" title={<>Checking your <em>profile</em></>} lede="Discord will confirm it’s you once more, then you’re back in." screen="recovering">
      <div className={shell.form}>
        <SigningRow>Opening Discord…</SigningRow>
      </div>
    </SignInStep>
  );
}
