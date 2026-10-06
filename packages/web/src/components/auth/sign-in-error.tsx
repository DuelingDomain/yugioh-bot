import type { ReactNode } from "react";
import { SignInStep } from "./sign-in-step";
import styles from "./sign-in-shell.module.css";

interface SignInErrorPanelProps {
  title: ReactNode;
  body: ReactNode;
  action: ReactNode;
  foot?: ReactNode;
}

export function SignInErrorPanel({ title, body, action, foot }: SignInErrorPanelProps) {
  return (
    <SignInStep eyebrow="Closed alpha" title={title} lede={body} foot={foot} screen="err-invite">
      <div className={styles.form}>{action}</div>
    </SignInStep>
  );
}

interface SignInBannerProps {
  tone: "info" | "bad";
  children: ReactNode;
  code?: string;
}

export function SignInBanner({ tone, children, code }: SignInBannerProps) {
  return (
    <div className={styles.banner} data-tone={tone} role={tone === "bad" ? "alert" : "status"}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        {tone === "info" ? <>
          <circle cx="12" cy="12" r="9.5" />
          <path d="M12 11v5.5M12 7.6v.1" />
        </> : <>
          <path d="M12 3 2.5 20h19Z" />
          <path d="M12 10v4.5M12 17.4v.1" />
        </>}
      </svg>
      <span>{children}{code && <span className={styles.code}>Error: {code}</span>}</span>
    </div>
  );
}
