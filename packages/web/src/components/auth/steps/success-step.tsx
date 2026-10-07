import { DoneRow } from "../fields";
import { SignInStep } from "../sign-in-step";
import shell from "../sign-in-shell.module.css";

/** Render inside `<SignInShell packState="open">`: the shell opens the pack, this is the status region beside it. */
export function SuccessStep() {
  return (
    <SignInStep eyebrow="Signed in" title={<>You’re <em>in</em></>} lede="The pack is open. Loading your drafts." screen="success">
      <div className={shell.form}>
        <DoneRow title="Welcome in" subtitle="Opening Dueling Domain…" />
      </div>
    </SignInStep>
  );
}
