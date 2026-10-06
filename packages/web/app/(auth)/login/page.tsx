import type { Metadata } from "next";
import { SignInShell } from "@/components/auth/sign-in-shell";
import { SignInFootLinks, SignInStep } from "@/components/auth/sign-in-step";
import { SignInBanner, SignInErrorPanel } from "@/components/auth/sign-in-error";
import styles from "@/components/auth/sign-in-shell.module.css";
import { signInWithDiscord } from "./actions";
import { describeLoginError } from "./login-errors";
import { LoginButton } from "./login-button";

export const metadata: Metadata = {
  title: "Sign in | Dueling Domain",
  description: "Sign in to your drafts, decks and duels.",
};

interface LoginPageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error } = await searchParams;
  const message = describeLoginError(error);
  const marketingUrl = process.env.MARKETING_URL?.trim().replace(/\/+$/, "") || undefined;

  return (
    <SignInShell marketingUrl={marketingUrl} tone={message?.tone === "bad" ? "bad" : "neutral"}>
      {message?.presentation === "panel" ? (
        <SignInErrorPanel
          title={message.title}
          body={message.body}
          action={<>
            {marketingUrl && <a className={`${styles.btn} ${styles["btn-primary"]}`} href={`${marketingUrl}/#join`}>Join the waitlist</a>}
            <a className={`${styles.btn} ${styles["btn-alt"]}`} href="/login">Try a different account</a>
          </>}
          foot={<SignInFootLinks marketingUrl={marketingUrl} waitlist={false} />}
        />
      ) : (
        <SignInStep
          eyebrow="Closed alpha"
          title={<>Welcome <em>back</em></>}
          lede="Sign in to your drafts, decks and duels."
          screen={message ? "err-service" : "signin"}
          foot={<SignInFootLinks marketingUrl={marketingUrl} />}
        >
          <form className={styles.form} action={signInWithDiscord}>
            {message && <SignInBanner tone={message.tone} code={message.code}>{message.title}{" "}{message.body}</SignInBanner>}
            <LoginButton />
            <p className={styles.fine} id="fine-discord">Discord shares your name, avatar and email. We can’t read or send messages as you.</p>
          </form>
        </SignInStep>
      )}
    </SignInShell>
  );
}
