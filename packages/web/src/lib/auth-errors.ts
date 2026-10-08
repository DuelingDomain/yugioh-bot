import type { AuthBanner, FieldName } from "./auth-flow";

export type AuthErrorView =
  | { kind: "step"; step: "err-invite" | "err-signup" | "err-banned" }
  | { kind: "field"; field: FieldName; message: string }
  | { kind: "banner"; banner: AuthBanner };

type Context = "identifier" | "password" | "code" | "newpw" | "signup" | "sso" | "ticket";
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

export function isWaitlistRefusal(error: unknown): boolean {
  const outer = record(error);
  const cause = record(outer.cause);
  const errors = Array.isArray(outer.errors) ? outer.errors : Array.isArray(cause.errors) ? cause.errors : [outer];
  return errors.some(value => ["sign_up_restricted_waitlist", "not_allowed_access", "sign_up_mode_restricted"].includes(String(record(value).code)));
}

export function mapClerkError(error: unknown, context: Context): AuthErrorView {
  const outer = record(error);
  // Signal methods may wrap a ClerkAPIResponseError in ClerkError.cause.
  const cause = record(outer.cause);
  const source = Array.isArray(outer.errors) ? record(outer.errors[0])
    : Array.isArray(cause.errors) ? record(cause.errors[0]) : outer;
  const code = typeof source.code === "string" ? source.code : undefined;
  const meta = record(source.meta);
  const param = meta.paramName ?? meta.param_name;
  const longMessage = source.longMessage ?? source.long_message;
  const message = typeof longMessage === "string" && longMessage ? longMessage : "Check this field and try again.";
  const field = (name: FieldName, body: string): AuthErrorView => ({ kind: "field", field: name, message: body });
  if (["user_locked", "user_banned", "user_deactivated"].includes(code ?? "")) return { kind: "step", step: "err-banned" };
  if (context === "ticket" && ["ticket_invalid_code", "ticket_expired", "ticket_expired_code", "form_identifier_not_found"].includes(code ?? "")) return { kind: "step", step: "err-signup" };
  if (context === "identifier") {
    if (code === "form_identifier_not_found") return { kind: "step", step: "err-invite" };
    if (code === "form_param_format_invalid" && ["email_address", "identifier"].includes(String(param))) return field("identifier", "Enter a valid email.");
  }
  if ((context === "signup" || context === "sso" || context === "ticket") && ["sign_up_restricted_waitlist", "not_allowed_access", "sign_up_mode_restricted"].includes(code ?? "")) return { kind: "step", step: "err-signup" };
  if (context === "password" && code === "form_password_incorrect") return field("password", "That password doesn't match. Try again or reset it.");
  if (context === "signup") {
    if (code === "form_username_exists" || (code === "form_identifier_exists" && (param === "username" || param === undefined))) return field("username", "That username is taken.");
    if (code?.startsWith("form_username_invalid")) return field("username", message);
    if (code === "legal_accepted" || (code === "form_param_missing" && param === "legal_accepted")) return field("legal", "Accept the terms and privacy policy to continue.");
  }
  if ((context === "newpw" || context === "signup") && ["form_password_pwned", "form_password_length_too_short", "form_password_validation_failed"].includes(code ?? "")) return field(context === "newpw" ? "newPassword" : "password", message);
  if (context === "code") {
    if (code === "form_code_incorrect") return field("code", "That code isn't right.");
    if (code === "verification_expired" || code === "verification_failed") return field("code", "That code expired. Send a new one.");
  }
  return { kind: "banner", banner: { tone: "bad", body: "Sign-in is having trouble. Try again in a moment.", ...(code ? { code } : {}) } };
}
