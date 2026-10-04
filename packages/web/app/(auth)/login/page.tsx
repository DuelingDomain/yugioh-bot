import { LightRule, SheetRoot, StatusLine } from "@/components/sheet";
import { signInWithDiscord } from "./actions";
import { describeLoginError } from "./login-errors";
import { LoginButton } from "./login-button";
import { BrandMark } from "./login-marks";
import { LoginRing } from "./login-ring";
import { LoginWall } from "./login-wall";
import styles from "./login.module.css";

interface LoginPageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const message = describeLoginError(params.error);

  return (
    <SheetRoot>
      <main className={styles.page} data-message={message ? "" : undefined}>
        <LoginWall hasMessage={message !== null}>
          <div className={styles.stack}>
            <LoginRing />
            <div className={styles.copy}>
              <h1 className={`${styles.brand} ${styles.c1}`}>
                <BrandMark className={styles.mark} />
                Duelists Kingdom
              </h1>
              <span className={`${styles.short} ${styles.c2}`}>
                <LightRule beam />
              </span>
              <p className={`${styles.sub} ${styles.c3}`}>
                Drafts, tournaments and duels for your Discord server. Sign in with the account you use there.
              </p>
              {message && (
                <div className={`${styles.msg} ${styles.c3}`} role={message.tone === "bad" ? "alert" : "status"}>
                  <StatusLine tone={message.tone === "bad" ? "block" : "neutral"}>
                    <b className={styles.msgTitle}>{message.title}</b>{" "}{message.body}
                    {message.code && <span className={styles.code}>Error: {message.code}</span>}
                  </StatusLine>
                </div>
              )}
              <form className={`${styles.form} ${styles.c4}`} action={signInWithDiscord}>
                <LoginButton />
              </form>
              <p className={`${styles.fine} ${styles.c5}`}>
                Discord shares your name, avatar and email. Duelists Kingdom can&apos;t read or send messages as you.
              </p>
            </div>
          </div>
        </LoginWall>
      </main>
    </SheetRoot>
  );
}
