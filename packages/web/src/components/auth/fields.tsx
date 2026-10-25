"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { HEARD_FROM, HEARD_FROM_DETAIL_MAX, HEARD_FROM_LABELS, type HeardFrom } from "@yugidraft/shared/util/heard-from";
import { DiscordGlyph } from "./discord-glyph";
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

/** "Continue with Discord" plus the data-sharing line under it. `fineId` keeps the two cards' ids distinct. */
export function DiscordButton({ onClick, pending, fineId }: { onClick: () => void; pending: boolean; fineId: string }) {
  return (
    <>
      <button type="button" className={`${shell.btn} ${shell["btn-alt"]}`} data-clerk="oauth-discord" aria-describedby={fineId} disabled={pending} onClick={onClick}>
        <DiscordGlyph />
        <span>Continue with Discord</span>
      </button>
      <p className={shell.fine} id={fineId}>Authorize on discord.com. Discord shares your name, avatar and email. We can’t read or send messages as you.</p>
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

/* ---------- "How did you hear about us?" ---------- */

/** The answers a person may pick. "creator" is set by a creator invite, never chosen. */
export const HEARD_FROM_CHOICES = HEARD_FROM.filter((value): value is Exclude<HeardFrom, "creator"> => value !== "creator");

export interface HeardFromValue {
  heardFrom?: string;
  heardFromDetail?: string;
}

/** The chosen answer from a form, or an empty object when nothing was chosen (the field is optional). */
export function readHeardFrom(data: FormData): HeardFromValue {
  const heardFrom = String(data.get("heardFrom") ?? "").trim();
  if (!heardFrom) return {};
  const detail = heardFrom === "other" ? String(data.get("heardFromDetail") ?? "").trim().slice(0, HEARD_FROM_DETAIL_MAX) : "";
  return detail ? { heardFrom, heardFromDetail: detail } : { heardFrom };
}

// steps.module.css styles text inputs only, so the select carries the same look inline.
const SELECT_STYLE: CSSProperties = {
  width: "100%", height: 52, padding: "0 44px 0 14px", borderRadius: 10, border: "1px solid var(--border)",
  background: "var(--field)", color: "var(--text)", fontSize: 17, outline: 0, appearance: "none", WebkitAppearance: "none",
  colorScheme: "dark", cursor: "pointer", boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, .02)",
  transition: "border-color .2s var(--ease), box-shadow .25s var(--ease)",
};
const SELECT_FOCUS: CSSProperties = { borderColor: "rgba(167, 139, 250, .75)", boxShadow: "0 0 0 4px rgba(124, 58, 237, .2)" };
const CHEVRON: CSSProperties = { position: "absolute", right: 14, top: 0, height: 52, width: 18, display: "grid", placeItems: "center", color: "var(--text-3)", pointerEvents: "none" };

/**
 * Optional "How did you hear about us?" select, plus a short text box when the answer is "Other". Never required.
 * Names `heardFrom` and `heardFromDetail`, so `readHeardFrom(new FormData(form))` reads it; `onChange` serves cards with no form.
 */
export function HeardFromSelect({ id = "f-heard", onChange }: { id?: string; onChange?(value: HeardFromValue): void }) {
  const [value, setValue] = useState("");
  const [detail, setDetail] = useState("");
  const [focused, setFocused] = useState(false);
  const emit = (next: string, nextDetail: string) => {
    const text = next === "other" ? nextDetail.trim() : "";
    onChange?.(!next ? {} : text ? { heardFrom: next, heardFromDetail: text } : { heardFrom: next });
  };
  return (
    <>
      <Field id={id} label={<>How did you hear about us? <span style={{ fontWeight: 400, color: "var(--text-3)", letterSpacing: 0 }}>(optional)</span></>}>
        {(aria) => (
          <div className={styles["input-wrap"]}>
            <select
              id={id}
              name="heardFrom"
              value={value}
              style={focused ? { ...SELECT_STYLE, ...SELECT_FOCUS } : SELECT_STYLE}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onChange={(e) => { setValue(e.target.value); emit(e.target.value, detail); }}
              {...aria}
            >
              <option value="">Choose one</option>
              {HEARD_FROM_CHOICES.map((choice) => <option key={choice} value={choice}>{HEARD_FROM_LABELS[choice]}</option>)}
            </select>
            <span style={CHEVRON} aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" focusable="false"><path d="m6 9 6 6 6-6" /></svg>
            </span>
          </div>
        )}
      </Field>
      {value === "other" && (
        <Field id={`${id}-detail`} label={<>Where? <span style={{ fontWeight: 400, color: "var(--text-3)", letterSpacing: 0 }}>(optional)</span></>}>
          {(aria) => (
            <div className={styles["input-wrap"]}>
              <input
                id={`${id}-detail`}
                name="heardFromDetail"
                type="text"
                maxLength={HEARD_FROM_DETAIL_MAX}
                autoComplete="off"
                placeholder="A website, an event, a server"
                value={detail}
                onChange={(e) => { setDetail(e.target.value); emit(value, e.target.value); }}
                {...aria}
              />
            </div>
          )}
        </Field>
      )}
    </>
  );
}
