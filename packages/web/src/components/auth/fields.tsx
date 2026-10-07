"use client";

import { useEffect, useState, type ReactNode } from "react";
import { PRIVACY_URL, TERMS_URL } from "./legal-links";
import shell from "./sign-in-shell.module.css";
import styles from "./steps.module.css";


const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");

const WARN_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M12 3 2.5 20h19Z" />
    <path d="M12 10v4.5M12 17.4v.1" />
  </svg>
);

/** Inline field error: `role="alert"` so a late error is announced. */
export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p className={styles.ferr} id={id} role="alert">
      {WARN_ICON}
      <span>{children}</span>
    </p>
  );
}

export interface FieldAria {
  "aria-invalid"?: true;
  "aria-describedby"?: string;
}

interface FieldProps {
  id: string;
  label: ReactNode;
  error?: string;
  hint?: ReactNode;
  children: (aria: FieldAria) => ReactNode;
}

/**
 * Label, control, error and hint in the mock's order. The error and hint ids are `${id}-err` and `${id}-hint`,
 * both wired into the control's aria-describedby (error first), and `aria-invalid` is set only with an error.
 */
export function Field({ id, label, error, hint, children }: FieldProps) {
  const describedBy = [error && `${id}-err`, hint && `${id}-hint`].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cx(styles.field, error && styles.invalid)}>
      <label htmlFor={id}>{label}</label>
      {children({ "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {error && <FieldError id={`${id}-err`}>{error}</FieldError>}
      {hint && <p className={styles.hint} id={`${id}-hint`}>{hint}</p>}
    </div>
  );
}

interface TextFieldProps {
  id: string;
  name: string;
  label: ReactNode;
  type?: "email" | "text";
  autoComplete?: string;
  inputMode?: "email" | "text";
  placeholder?: string;
  defaultValue?: string;
  error?: string;
  hint?: ReactNode;
  autoFocus?: boolean;
}

export function TextField({ id, name, label, type = "text", autoComplete, inputMode, placeholder, defaultValue, error, hint, autoFocus }: TextFieldProps) {
  return (
    <Field id={id} label={label} error={error} hint={hint}>
      {(aria) => (
        <div className={styles["input-wrap"]}>
          <input
            id={id}
            name={name}
            type={type}
            autoComplete={autoComplete}
            inputMode={inputMode}
            placeholder={placeholder}
            defaultValue={defaultValue}
            spellCheck={false}
            autoCapitalize="off"
            autoFocus={autoFocus}
            required
            {...aria}
          />
        </div>
      )}
    </Field>
  );
}

interface PasswordFieldProps {
  id: string;
  name: string;
  label: ReactNode;
  autoComplete: "current-password" | "new-password";
  error?: string;
  hint?: ReactNode;
  autoFocus?: boolean;
  required?: boolean;
}

/** Password input with the Show / Hide reveal button. The reveal flips the input type; the value is left to the DOM. */
export function PasswordField({ id, name, label, autoComplete, error, hint, autoFocus, required = true }: PasswordFieldProps) {
  const [shown, setShown] = useState(false);
  return (
    <Field id={id} label={label} error={error} hint={hint}>
      {(aria) => (
        <div className={cx(styles["input-wrap"], styles["has-btn"])}>
          <input id={id} name={name} type={shown ? "text" : "password"} autoComplete={autoComplete} autoFocus={autoFocus} required={required} {...aria} />
          <button type="button" className={styles.reveal} aria-pressed={shown} aria-controls={id} onClick={() => setShown((v) => !v)}>
            <span>{shown ? "Hide" : "Show"}</span>{" "}
            <span className={shell.sr}>password</span>
          </button>
        </div>
      )}
    </Field>
  );
}

/** Email from an invitation: read-only, dashed, with a lock. It is never editable. */
export function LockedInput({ id, name, label, value, hint }: { id: string; name: string; label: ReactNode; value: string; hint?: ReactNode }) {
  return (
    <Field id={id} label={label} hint={hint}>
      {(aria) => (
        <div className={cx(styles["input-wrap"], styles.locked)}>
          <input id={id} name={name} type="email" value={value} readOnly {...aria} />
          <span className={styles.lockic}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              <rect x="5" y="11" width="14" height="9" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
            <span className={shell.sr}>Locked</span>
          </span>
        </div>
      )}
    </Field>
  );
}

interface OtpInputProps {
  id: string;
  name: string;
  /** Id of the element that describes the code, for aria-describedby. */
  describedBy?: string;
  invalid?: boolean;
  defaultValue?: string;
  autoFocus?: boolean;
}

/** Six cells over one real input (paste, autofill and SMS suggestions work). Digits only. */
export function OtpInput({ id, name, describedBy, invalid, defaultValue = "", autoFocus }: OtpInputProps) {
  const [value, setValue] = useState(defaultValue.replace(/\D/g, "").slice(0, 6));
  const on = Math.min(value.length, 5);
  return (
    <div className={cx(styles.otp, invalid && styles.invalid)}>
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} className={cx(styles.cell, i === on && styles.on, i < value.length && styles.filled)} aria-hidden="true">
          {value[i] ?? ""}
        </span>
      ))}
      <input
        className={styles["otp-in"]}
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="one-time-code"
        maxLength={6}
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/\D/g, "").slice(0, 6))}
        aria-label="6-digit code"
        aria-describedby={describedBy}
        aria-invalid={invalid ? true : undefined}
        autoFocus={autoFocus}
        required
      />
    </div>
  );
}

interface ConsentCheckboxProps {
  name: string;
  error?: string;
  errorId?: string;
}

/** Terms and privacy consent. The two links are the constant marketing URLs. */
export function ConsentCheckbox({ name, error, errorId = "f-legal-err" }: ConsentCheckboxProps) {
  return (
    <div className={cx(styles["check-group"], error && styles.invalid)}>
      <label className={styles.check}>
        <input type="checkbox" name={name} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} />
        <span className={styles.box}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="M5 12.5 10 17.5 19 7" />
          </svg>
        </span>
        <span>
          I agree to the <a href={TERMS_URL}>Terms</a> and <a href={PRIVACY_URL}>Privacy Policy</a>
        </span>
      </label>
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
}

/**
 * Where Clerk mounts its bot check. Clerk looks the element up by this id when `signUp.ticket()` or an OAuth transfer
 * runs, which is on mount. The page therefore owns exactly one of these from its first render (see `AuthFlowShell`);
 * no step renders it. It is empty, and takes no space, until Clerk fills it.
 */
export function CaptchaMount() {
  return <div id="clerk-captcha" data-clerk="captcha" className={styles["captcha-mount"]} />;
}

/**
 * The mock's framed "Bot check loads here" box, for the preview page only. It carries the id because the preview has no
 * page-level mount; never render it next to `CaptchaMount`.
 */
export function CaptchaPlaceholder() {
  return (
    <div id="clerk-captcha" data-clerk="captcha" className={styles["captcha-slot"]}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6Z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
      <span>Bot check loads here</span>
    </div>
  );
}

/** Email on the invite or not-invited cards. */
export function NoteBox({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className={styles["note-box"]}>
      <span className={styles.k}>{label}</span>
      <span className={styles.v}>{children}</span>
    </div>
  );
}

/** Spinner and status text. A live region, so it is announced once. */
export function SigningRow({ children }: { children: ReactNode }) {
  return (
    <div className={styles.signing} role="status" aria-live="polite">
      <span className={shell.spinner} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

/** The success row: gold tick, title and subtitle. */
export function DoneRow({ title, subtitle }: { title: ReactNode; subtitle: ReactNode }) {
  return (
    <div className={shell["done-row"]} role="status">
      <span className={shell["done-gem"]}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M5 12.5 10 17.5 19 7" />
        </svg>
      </span>
      <div>
        <p className={shell["done-t"]}>{title}</p>
        <p className={shell["done-s"]}>{subtitle}</p>
      </div>
    </div>
  );
}

const DISCORD_PATH =
  "M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z";

/** "Continue with Discord" plus the data-sharing line under it. `fineId` keeps the two cards' ids distinct. */
export function DiscordButton({ onClick, pending, fineId }: { onClick: () => void; pending: boolean; fineId: string }) {
  return (
    <>
      <button type="button" className={`${shell.btn} ${shell["btn-alt"]}`} data-clerk="oauth-discord" aria-describedby={fineId} disabled={pending} onClick={onClick}>
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
          <path d={DISCORD_PATH} />
        </svg>
        <span>Continue with Discord</span>
      </button>
      <p className={shell.fine} id={fineId}>Discord shares your name, avatar and email. We can’t read or send messages as you.</p>
    </>
  );
}

/** The divider with "or" between the two ways in. */
export function OrDivider() {
  return (
    <div className={shell.or} aria-hidden="true">
      <span>or</span>
    </div>
  );
}

/** `.link`-styled button (Change, Forgot password, back links). */
export function LinkButton({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" className={shell.link} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

/** Whole seconds left until `at` (epoch ms), ticking each second; null when there is no deadline. */
export function useSecondsUntil(at: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (at === null) return;
    setNow(Date.now());
    const timer = setInterval(() => {
      const next = Date.now();
      setNow(next);
      if (next >= at) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [at]);
  if (at === null) return null;
  return Math.max(0, Math.ceil((at - now) / 1000));
}
