import { describe, expect, it } from "vitest";
import { mapClerkError } from "../src/lib/auth-errors";

describe("Clerk error mapping", () => {
  it.each([
    ["form_identifier_not_found", "identifier", { kind: "step", step: "err-invite" }],
    ...["sign_up_restricted_waitlist", "not_allowed_access", "sign_up_mode_restricted"].flatMap(code => (["signup", "sso"] as const).map(context => [code, context, { kind: "step", step: "err-signup" }] as const)),
    ["form_password_incorrect", "password", { kind: "field", field: "password", message: "That password doesn't match. Try again or reset it." }],
    ["form_username_exists", "signup", { kind: "field", field: "username", message: "That username is taken." }],
    ["form_identifier_exists", "signup", { kind: "field", field: "username", message: "That username is taken." }],
    ["form_username_invalid_characters", "signup", { kind: "field", field: "username", message: "Detailed explanation" }],
    ...["form_password_pwned", "form_password_length_too_short", "form_password_validation_failed"].flatMap(code => (["newpw", "signup"] as const).map(context => [code, context, { kind: "field", field: context === "newpw" ? "newPassword" : "password", message: "Detailed explanation" }] as const)),
    ["form_code_incorrect", "code", { kind: "field", field: "code", message: "That code isn't right." }],
    ...["verification_expired", "verification_failed"].map(code => [code, "code", { kind: "field", field: "code", message: "That code expired. Send a new one." }] as const),
    ...["user_locked", "user_banned", "user_deactivated"].flatMap(code => (["identifier", "password", "code", "newpw", "signup", "sso"] as const).map(context => [code, context, { kind: "step", step: "err-banned" }] as const)),
    ["legal_accepted", "signup", { kind: "field", field: "legal", message: "Accept the terms and privacy policy to continue." }],
  ] as const)("maps %s in %s", (code, context, expected) => {
    expect(mapClerkError({ errors: [{ code, message: "Short", longMessage: "Detailed explanation", meta: { paramName: "username" } }] }, context)).toEqual(expected);
  });
  it.each(["email_address", "identifier"])("targets invalid %s at the identifier", (paramName) => {
    expect(mapClerkError({ code: "form_param_format_invalid", meta: { paramName } }, "identifier")).toEqual({ kind: "field", field: "identifier", message: "Enter a valid email." });
  });
  it("maps missing legal consent and snake-case API metadata", () => {
    expect(mapClerkError({ errors: [{ code: "form_param_missing", meta: { param_name: "legal_accepted" } }] }, "signup")).toEqual({ kind: "field", field: "legal", message: "Accept the terms and privacy policy to continue." });
    expect(mapClerkError({ code: "form_password_pwned", long_message: "Use another password" }, "newpw")).toMatchObject({ field: "newPassword", message: "Use another password" });
  });
  it.each([null, {}, new Error("network"), { code: "unknown" }, { code: "form_identifier_not_found" }, { code: "form_param_format_invalid", meta: { paramName: "phone_number" } }])("keeps unknown/mismatched errors on a service banner", (error) => {
    expect(mapClerkError(error, "password")).toMatchObject({ kind: "banner", banner: { tone: "bad", body: "Sign-in is having trouble. Try again in a moment." } });
  });
  it("retains the unknown API code without exposing its message", () => {
    expect(mapClerkError({ code: "new_error", message: "private internals" }, "sso")).toEqual({ kind: "banner", banner: { tone: "bad", body: "Sign-in is having trouble. Try again in a moment.", code: "new_error" } });
  });
  it("unwraps signal method errors and does not confuse an existing email with a username", () => {
    expect(mapClerkError({ code: "api_response_error", cause: { errors: [{ code: "form_password_incorrect" }] } }, "password")).toMatchObject({ kind: "field", field: "password" });
    expect(mapClerkError({ code: "form_identifier_exists", meta: { paramName: "email_address" } }, "signup").kind).toBe("banner");
  });
  it("does not expose developer-only messages when no long message is supplied", () => {
    expect(mapClerkError({ code: "form_password_pwned", message: "private developer detail" }, "signup")).toMatchObject({ kind: "field", field: "password", message: "Check this field and try again." });
  });
});
