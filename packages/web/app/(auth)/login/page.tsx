import type { CSSProperties } from "react";
import Image from "next/image";
import { FieldOutline, LightRule, SheetRoot, StatusLine, Zone } from "@/components/sheet";
import { signInWithDiscord } from "./actions";
import { describeLoginError } from "./login-errors";
import { LoginButton } from "./login-button";
import { BrandMark } from "./login-marks";
import styles from "./login.module.css";

/** One card in each half of the field, so the field reads as a duel set up for two. */
const CARDS = [
  { id: 46986418, alt: "Dark Magician", half: "top" },
  { id: 89631146, alt: "Blue-Eyes White Dragon", half: "bottom" },
] as const;

interface LoginPageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const message = describeLoginError(params.error);

  return (
    <SheetRoot>
      <main className={styles.page}>
        <div className={styles.stack}>
          <FieldOutline lit centreLine className={styles.field}>
            <div className={styles.slots} aria-hidden="true">
              {CARDS.map((card) => (
                <span key={card.id} className={styles.slot} data-half={card.half}>
                  <Zone state="dashed" className={styles.zone} style={{ "--zw": "84px" } as CSSProperties} />
                  <Image
                    className={styles.card}
                    src={`https://images.ygoprodeck.com/images/cards_small/${card.id}.jpg`}
                    alt=""
                    width={84}
                    height={123}
                  />
                </span>
              ))}
            </div>
          </FieldOutline>
          <div className={styles.copy}>
            <h1 className={styles.brand}>
              <BrandMark className={styles.mark} />
              YugiDraft
            </h1>
            <span className={styles.short}>
              <LightRule beam />
            </span>
            <p className={styles.sub}>
              Drafts, tournaments and duels for your Discord server. Sign in with the account you use there.
            </p>
            {message && (
              <div className={styles.msg} role={message.tone === "bad" ? "alert" : "status"}>
                <StatusLine tone={message.tone === "bad" ? "block" : "neutral"}>
                  <b className={styles.msgTitle}>{message.title}</b>{" "}{message.body}
                  {message.code && <span className={styles.code}>Error: {message.code}</span>}
                </StatusLine>
              </div>
            )}
            <form className={styles.form} action={signInWithDiscord}>
              <LoginButton />
            </form>
            <p className={styles.fine}>
              Discord shares your name, avatar and email. YugiDraft can&apos;t read or send messages as you.
            </p>
          </div>
        </div>
      </main>
    </SheetRoot>
  );
}
