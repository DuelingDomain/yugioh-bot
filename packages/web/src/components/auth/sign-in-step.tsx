import type { ReactNode } from "react";
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

export function SignInFootLinks({ marketingUrl, waitlist = true }: { marketingUrl?: string; waitlist?: boolean }) {
  if (!marketingUrl) return null;
  return (
    <>
      {waitlist && <p>Not in the alpha yet? <a href={`${marketingUrl}/#join`}>Join the waitlist</a></p>}
      <p className={styles.legal}><a href={`${marketingUrl}/privacy`}>Privacy</a></p>
    </>
  );
}
