"use client";

import * as React from "react";
import { useClerk } from "@clerk/nextjs";
import { hardNavigate } from "@/components/auth/navigate";
import { DEFAULT_MARKETING_URL } from "@/components/auth/marketing-links";
import { StatusLine, SvButton } from "@/components/sheet";
import styles from "./delete-account-section.module.css";

export type DeleteAccountError = "mismatch" | "retry" | "server" | "signed_out";

const SUPPORT = "support@duelingdomain.com";

/** Whether what was typed confirms the deletion. Same rule as the server: trimmed, case-sensitive. */
export function confirmsUsername(typed: string, username: string): boolean {
  return username !== "" && typed.trim() === username;
}

export function errorForStatus(status: number): DeleteAccountError {
  if (status === 400) return "mismatch";
  if (status === 503) return "retry";
  if (status === 401) return "signed_out";
  return "server";
}

function ErrorText({ error }: { error: DeleteAccountError }) {
  if (error === "mismatch") return <>That doesn&apos;t match your username.</>;
  if (error === "retry") return <>We couldn&apos;t delete your account just now. Try again in a minute.</>;
  if (error === "signed_out") return <>Your session has ended. Sign in again, then try once more.</>;
  return <>Something went wrong. Email <a href={`mailto:${SUPPORT}`}>{SUPPORT}</a> and we&apos;ll finish it.</>;
}

export type DeleteAccountViewProps = {
  username: string;
  value: string;
  onValueChange: (value: string) => void;
  /** The request is in flight, or it succeeded and the sign-out is under way. */
  pending: boolean;
  error: DeleteAccountError | null;
  onSubmit: () => void;
};

/** The section with its state passed in, so every state can be rendered without a network or a Clerk provider. */
export function DeleteAccountView({ username, value, onValueChange, pending, error, onSubmit }: DeleteAccountViewProps) {
  const matches = confirmsUsername(value, username);
  return (
    <section className={`set-sec ${styles.zone}`} aria-labelledby="set-delete-account">
      <div className="set-intro">
        <h2 id="set-delete-account">Delete account</h2>
        <p id="set-delete-account-note">
          This removes your sign-in, email address and saved decks. Your matches, drafts, tournaments and cubes stay on
          the site as &ldquo;Deleted player&rdquo;, so other players keep their history. You can&apos;t undo this.
        </p>
      </div>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (matches && !pending) onSubmit();
        }}
      >
        <div className={styles.field}>
          <label className="label" htmlFor="delete-account-confirm">Type your username to confirm</label>
          <input
            className={`input${error === "mismatch" ? " bad" : ""}`}
            id="delete-account-confirm"
            type="text"
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            disabled={pending}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-describedby="delete-account-hint"
            aria-invalid={error === "mismatch" || undefined}
          />
          <p className={styles.hint} id="delete-account-hint">
            Your username is <code>{username}</code>
          </p>
        </div>
        <div className={styles.actions}>
          <SvButton variant="danger" type="submit" disabled={!matches || pending} aria-busy={pending || undefined}>
            {pending ? "Deleting…" : "Delete my account"}
          </SvButton>
        </div>
        <div role="alert" className={styles.error}>
          {error && (
            <StatusLine tone="block">
              <ErrorText error={error} />
            </StatusLine>
          )}
        </div>
      </form>
    </section>
  );
}

function Controller({ username, onDeleted }: { username: string; onDeleted: () => Promise<void> | void }) {
  const [value, setValue] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<DeleteAccountError | null>(null);

  const submit = async () => {
    if (pending || !confirmsUsername(value, username)) return;
    setError(null);
    setPending(true);
    let res: Response;
    try {
      res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: value.trim() }),
      });
    } catch {
      setError("server");
      setPending(false);
      return;
    }
    if (!res.ok) {
      setError(errorForStatus(res.status));
      setPending(false);
      return;
    }
    // Stay pending: the account is gone and the page is about to leave.
    await onDeleted();
  };

  return <DeleteAccountView username={username} value={value} onValueChange={setValue} pending={pending} error={error} onSubmit={() => void submit()} />;
}

/** Signs out through Clerk, which holds the browser session. Rendered only outside E2E mode, where the provider exists. */
function ClerkController({ username, marketingUrl }: { username: string; marketingUrl: string }) {
  const { signOut } = useClerk();
  const onDeleted = async () => {
    try {
      await signOut({ redirectUrl: marketingUrl });
    } catch {
      hardNavigate(marketingUrl);
    }
  };
  return <Controller username={username} onDeleted={onDeleted} />;
}

export type DeleteAccountSectionProps = {
  /** `users.username` of the signed-in person: the text they must type. */
  username: string;
  /** Offline E2E auth: no Clerk provider is mounted, so the section never touches Clerk. */
  e2eMode: boolean;
  /** Where Clerk sends the person after sign-out. Defaults to the marketing site. */
  marketingUrl?: string;
};

export function DeleteAccountSection({ username, e2eMode, marketingUrl = DEFAULT_MARKETING_URL }: DeleteAccountSectionProps) {
  if (e2eMode) return <Controller username={username} onDeleted={() => hardNavigate("/sign-in")} />;
  return <ClerkController username={username} marketingUrl={marketingUrl} />;
}
