import type { ReactNode } from "react";
import { PRIVACY_URL, TERMS_URL } from "./legal-links";
import { waitlistHref } from "./marketing-links";
import styles from "./sign-in-shell.module.css";

interface SignInStepProps {
  eyebrow: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  children: ReactNode;
  foot?: ReactNode;
  screen?: string;
}

export function SignInStep({ eyebrow, title, lede, children, foot, screen = "signin" }: SignInStepProps) {
  return (
    <section className={styles.scr} data-screen={screen}>
      <p className={styles.eyebrow} data-slot="eyebrow">{eyebrow}</p>
      <h1 className={styles.ttl} data-slot="title">{title}</h1>
      {lede && <p className={styles.lede} data-slot="lede">{lede}</p>}
      <div data-slot="form">{children}</div>
      <div className={styles["foot-links"]} data-slot="foot">{foot}</div>
    </section>
  );
}

interface SignInFootLinksProps {
  marketingUrl?: string;
  waitlist?: boolean;
  /** Replaces the waitlist line, e.g. "Already have an account? Sign in". */
  lead?: ReactNode;
}

/** Foot of a step card. The legal links are fixed; the waitlist line needs the marketing URL. */
export function SignInFootLinks({ marketingUrl, waitlist = true, lead }: SignInFootLinksProps) {
  return (
    <>
      {lead ?? (waitlist && marketingUrl ? <p>Not in the alpha yet? <a href={waitlistHref(marketingUrl)}>Join the waitlist</a></p> : null)}
      <p className={styles.legal}>
        <a href={TERMS_URL}>Terms</a>
        <a href={PRIVACY_URL}>Privacy</a>
      </p>
    </>
  );
}
