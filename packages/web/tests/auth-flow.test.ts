import { describe, expect, it } from "vitest";
import { initialAuthState, reduceAuth, signInStatusEvent, signUpRequirementsEvent, type AuthStep } from "../src/lib/auth-flow";

const steps: AuthStep[] = ["signin", "password", "code", "newpw", "invite", "signing", "success", "err-invite", "err-signup", "err-banned"];
describe("auth reducer", () => {
  it("starts with a sanitized return and no account or errors", () => {
    expect(initialAuthState({ returnTo: "//evil.test" })).toEqual({ step: "signin", identifier: null, lockedEmail: null, codePurpose: null, fieldErrors: {}, banner: null, pending: false, resendAvailableAt: null, returnTo: "/dashboard" });
    expect(initialAuthState({ returnTo: "/drafts?x#y", step: "invite" })).toMatchObject({ step: "invite", returnTo: "/drafts?x#y" });
  });
  it.each(steps)("handles request and errors on %s without discarding the account", (step) => {
    const state = { ...initialAuthState({ returnTo: "/drafts", step }), identifier: "a@test.dev", lockedEmail: "a@test.dev" };
    const pending = reduceAuth(state, { type: "submit" });
    expect(pending).toMatchObject({ pending: true, fieldErrors: {}, banner: null });
    expect(reduceAuth(pending, { type: "settled" }).pending).toBe(false);
    const errored = reduceAuth(pending, { type: "error", view: { kind: "field", field: "code", message: "Wrong code" } });
    expect(errored).toMatchObject({ step, pending: false, identifier: "a@test.dev", lockedEmail: "a@test.dev", fieldErrors: { code: "Wrong code" } });
    expect(reduceAuth(pending, { type: "error", view: { kind: "banner", banner: { tone: "bad", body: "Retry" } } })).toMatchObject({ step, pending: false, banner: { tone: "bad", body: "Retry" } });
    expect(reduceAuth(pending, { type: "error", view: { kind: "step", step: "err-banned" } })).toMatchObject({ step: "err-banned", pending: false, identifier: "a@test.dev" });
  });
  it("identifies then requests a password", () => {
    const identified = reduceAuth(initialAuthState({ returnTo: "/" }), { type: "identified", identifier: "a@test.dev" });
    expect(reduceAuth(identified, { type: "needs-password" })).toMatchObject({ step: "password", identifier: "a@test.dev" });
  });
  it.each(["signup", "reset", "client-trust"] as const)("records %s code purpose and cooldown", (purpose) => {
    expect(reduceAuth(initialAuthState({ returnTo: "/" }), { type: "code-sent", purpose, now: 1000 })).toMatchObject({ step: "code", codePurpose: purpose, resendAvailableAt: 31000 });
  });
  it("moves reset to new password and locks the invitation email", () => {
    const state = initialAuthState({ returnTo: "/" });
    expect(reduceAuth(state, { type: "needs-new-password" }).step).toBe("newpw");
    expect(reduceAuth(state, { type: "invite-ready", lockedEmail: "invited@test.dev" })).toMatchObject({ step: "invite", identifier: "invited@test.dev", lockedEmail: "invited@test.dev" });
  });
  it.each(["password", "code", "newpw", "err-invite"] as const)("back from %s clears attempt display and errors", (step) => {
    const state = { ...initialAuthState({ returnTo: "/drafts", step }), identifier: "a@test.dev", codePurpose: "reset" as const, resendAvailableAt: 1, fieldErrors: { code: "Wrong" }, banner: { tone: "bad" as const, body: "Retry" } };
    expect(reduceAuth(state, { type: "back" })).toMatchObject({ step: "signin", identifier: null, codePurpose: null, resendAvailableAt: null, fieldErrors: {}, banner: null, returnTo: "/drafts" });
  });
  it("only finalizes from signing, and back cannot unlock an invitation", () => {
    const state = initialAuthState({ returnTo: "/" });
    expect(reduceAuth(state, { type: "finalized" }).step).toBe("signin");
    const signing = reduceAuth(state, { type: "complete" });
    expect(signing).toMatchObject({ step: "signing", pending: true });
    expect(reduceAuth(signing, { type: "finalized" })).toMatchObject({ step: "success", pending: false });
    const invite = reduceAuth(state, { type: "invite-ready", lockedEmail: "invite@test.dev" });
    expect(reduceAuth(invite, { type: "back" })).toEqual(invite);
  });
});

describe("Clerk status events", () => {
  it.each([["needs_identifier", "back"], ["needs_first_factor", "needs-password"], ["needs_new_password", "needs-new-password"], ["complete", "complete"], ["needs_protect_check", "error"], ["unexpected", "error"]])("maps sign-in %s to %s", (status, type) => {
    expect(signInStatusEvent(status).type).toBe(type);
  });
  it.each(["needs_client_trust", "needs_second_factor"])("maps %s to client trust", (status) => {
    expect(signInStatusEvent(status)).toMatchObject({ type: "code-sent", purpose: "client-trust", now: expect.any(Number) });
  });
  it("requires a Clerk email and username/consent before verification", () => {
    expect(signUpRequirementsEvent({ status: "missing_requirements", missingFields: ["username", "legal_accepted"], unverifiedFields: ["email_address"], emailAddress: "invite@test.dev" })).toEqual({ type: "invite-ready", lockedEmail: "invite@test.dev" });
    expect(signUpRequirementsEvent({ status: "missing_requirements", missingFields: [], unverifiedFields: ["email_address"], emailAddress: "invite@test.dev" })).toMatchObject({ type: "code-sent", purpose: "signup" });
    expect(signUpRequirementsEvent({ status: "complete", missingFields: [], unverifiedFields: [], emailAddress: "invite@test.dev" })).toEqual({ type: "complete" });
    expect(signUpRequirementsEvent({ status: "missing_requirements", missingFields: ["username"], unverifiedFields: [], emailAddress: null })).toEqual({ type: "error", view: { kind: "step", step: "err-signup" } });
  });
  it.each(["abandoned", "unknown"])("fails closed for signup status %s", (status) => {
    expect(signUpRequirementsEvent({ status, missingFields: [], unverifiedFields: [], emailAddress: "invite@test.dev" }).type).toBe("error");
  });
});
