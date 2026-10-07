import { SignInShell } from "./sign-in-shell";
import { SignInFootLinks, SignInStep } from "./sign-in-step";
import { waitlistHref } from "./marketing-links";
import shell from "./sign-in-shell.module.css";

/**
 * `/access`: a plain explanation for someone who reached the app without an invite. It checks nothing and approves
 * nothing; Clerk's waitlist and invitations decide who gets in. No client code, no Clerk import.
 */
export function AccessContent({ marketingUrl }: { marketingUrl: string | null }) {
  return (
    <SignInShell marketingUrl={marketingUrl ?? undefined}>
      <SignInStep
        eyebrow="Closed alpha"
        title={<>Invite-only <em>for now</em></>}
        lede="Dueling Domain accounts are created from an invite. Join the waitlist and we’ll email you when your wave opens."
        screen="access"
        foot={<SignInFootLinks lead={<p>Invited? Use the link in your email.</p>} />}
      >
        <div className={shell.form}>
          <a className={`${shell.btn} ${shell["btn-primary"]}`} href={waitlistHref(marketingUrl)}>Join the waitlist</a>
          <a className={`${shell.btn} ${shell["btn-alt"]}`} href="/sign-in">Sign in</a>
          <p className={shell.fine}>Already have an account? Sign in with Discord or your email.</p>
        </div>
      </SignInStep>
    </SignInShell>
  );
}
