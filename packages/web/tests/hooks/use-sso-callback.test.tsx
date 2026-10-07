// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSsoCallback } from "../../src/hooks/use-sso-callback";
import { useSignUpFlow } from "../../src/hooks/use-sign-up-flow";
import { useSignInFlow } from "../../src/hooks/use-sign-in-flow";

const mock = vi.hoisted(() => ({ signInSignal: {} as any, signUpSignal: {} as any, push: vi.fn() }));
vi.mock("@clerk/nextjs", () => ({ useSignIn: () => mock.signInSignal, useSignUp: () => mock.signUpSignal }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mock.push }) }));
const ok = () => Promise.resolve({ error: null });
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1000); mock.push.mockReset(); sessionStorage.clear();
  window.history.replaceState(null, "", "/sso-callback");
  mock.signInSignal = { fetchStatus: "idle", errors: { fields: {}, raw: null, global: null }, signIn: { id: "sia_existing", status: "needs_identifier", isTransferable: false, sso: vi.fn(ok), finalize: vi.fn(ok) } };
  mock.signUpSignal = { fetchStatus: "idle", errors: { fields: {}, raw: null, global: null }, signUp: {
    id: "sua_invited", status: "missing_requirements", emailAddress: "invited@test.dev", missingFields: ["username", "legal_accepted"], unverifiedFields: [], username: null, legalAcceptedAt: null,
    ticket: vi.fn(ok), update: vi.fn(ok), password: vi.fn(ok), sso: vi.fn(ok), finalize: vi.fn(ok), reset: vi.fn(ok), create: vi.fn(ok),
    verifications: { sendEmailCode: vi.fn(ok), verifyEmailCode: vi.fn(ok) },
  } };
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
const mount = async () => { const view = renderHook(() => useSsoCallback()); await act(async () => {}); return view; };

describe("SSO callback", () => {
  it("resumes missing username and consent with Clerk's locked email", async () => {
    const { result } = await mount();
    expect(result.current.resumeKind).toBe("sign-up");
    expect(result.current.state).toMatchObject({ step: "invite", lockedEmail: "invited@test.dev", identifier: "invited@test.dev" });
    expect(mock.signUpSignal.signUp.ticket).not.toHaveBeenCalled();
    expect(mock.signUpSignal.signUp.finalize).not.toHaveBeenCalled();
    expect(mock.push).not.toHaveBeenCalled();
  });
  it("sends verification for an otherwise complete signup and resumes code errors", async () => {
    mock.signUpSignal.signUp.missingFields = [];
    mock.signUpSignal.signUp.unverifiedFields = ["email_address"];
    const { result } = await mount();
    expect(result.current.state).toMatchObject({ step: "code", codePurpose: "signup", lockedEmail: "invited@test.dev" });
    expect(mock.signUpSignal.signUp.verifications.sendEmailCode).toHaveBeenCalledTimes(1);
    mock.signUpSignal.signUp.verifications.verifyEmailCode.mockResolvedValue({ error: { code: "verification_expired" } });
    await act(() => result.current.actions.submitCode("123456"));
    expect(result.current.state.fieldErrors.code).toBe("That code expired. Send a new one.");
  });
  it.each(["sign-in", "sign-up"] as const)("shows success after finalize clears the complete %s, then navigates", async (kind) => {
    const resource = kind === "sign-in" ? mock.signInSignal.signIn : mock.signUpSignal.signUp;
    resource.status = "complete";
    resource.finalize.mockImplementation(async () => { resource.status = null; return { error: null }; });
    const { result } = await mount();
    expect(result.current.resumeKind).toBe(kind);
    expect(resource.finalize).toHaveBeenCalledTimes(1);
    expect(result.current.state).toMatchObject({ step: "success", banner: null });
    expect(result.current.state.fieldErrors).toEqual({});
    expect(mock.push).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(900));
    expect(mock.push).toHaveBeenCalledWith("/dashboard");
  });
  it("preserves invitation and return context across the Discord callback", async () => {
    const invited = renderHook(() => useSignUpFlow({ ticket: "invitation", returnTo: "/drafts/a?join=1#seat" }));
    await act(async () => {});
    await act(() => invited.result.current.actions.continueWithDiscord({ username: "duelist", legalAccepted: true }));
    invited.unmount();
    const callback = await mount();
    expect(callback.result.current.state).toMatchObject({ step: "invite", lockedEmail: "invited@test.dev", returnTo: "/drafts/a?join=1#seat" });
    mock.signUpSignal.signUp.password.mockImplementation(async () => { mock.signUpSignal.signUp.status = "complete"; return { error: null }; });
    await act(() => callback.result.current.actions.submitAccount({ username: "duelist", password: "", legalAccepted: true }));
    expect(mock.signUpSignal.signUp.password).not.toHaveBeenCalled();
    expect(mock.signUpSignal.signUp.update).toHaveBeenCalledWith({ username: "duelist", legalAccepted: true });
  });
  it("finishes an OAuth account by updating missing fields without requiring a password", async () => {
    mock.signUpSignal.signUp.update.mockImplementation(async () => { mock.signUpSignal.signUp.status = "complete"; return { error: null }; });
    const { result } = await mount();
    await act(() => result.current.actions.submitAccount({ username: "duelist", password: "", legalAccepted: true }));
    expect(mock.signUpSignal.signUp.password).not.toHaveBeenCalled();
    expect(result.current.state.step).toBe("success");
  });
  it("rejects a sign-in transferred into signup under waitlist mode", async () => {
    const signin = renderHook(() => useSignInFlow({ returnTo: "/drafts", marketingUrl: null }));
    await act(() => signin.result.current.actions.continueWithDiscord()); signin.unmount();
    mock.signInSignal.signIn.isTransferable = true;
    const { result } = await mount();
    expect(result.current.state.step).toBe("err-signup");
    expect(mock.signUpSignal.signUp.finalize).not.toHaveBeenCalled();
  });
  it("rejects a callback without any usable attempt", async () => {
    mock.signUpSignal.signUp.emailAddress = null;
    const { result } = await mount();
    expect(result.current.state.step).toBe("err-signup");
    expect(mock.push).not.toHaveBeenCalled();
  });
  it("waits for signal loading, reports global errors, and never repeats finalize on rerender", async () => {
    mock.signInSignal.fetchStatus = "fetching";
    mock.signInSignal.signIn.status = "complete";
    const { result, rerender } = renderHook(() => useSsoCallback());
    expect(result.current.state.pending).toBe(true);
    expect(mock.signInSignal.signIn.finalize).not.toHaveBeenCalled();
    mock.signInSignal.fetchStatus = "idle";
    mock.signInSignal.signIn.finalize.mockResolvedValue({ error: { code: "service" } });
    rerender(); await act(async () => {});
    expect(result.current.state).toMatchObject({ step: "signing", banner: { tone: "bad", code: "service", body: "Sign-in is having trouble. Try again in a moment." } });
    rerender(); await act(async () => {});
    expect(mock.signInSignal.signIn.finalize).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(1000));
    expect(mock.push).not.toHaveBeenCalled();
  });
  it("waits for Clerk's pre-load proxy to expose an attempt before resuming", async () => {
    mock.signInSignal.signIn.id = undefined;
    mock.signUpSignal.signUp.id = undefined;
    mock.signUpSignal.signUp.emailAddress = null;
    const { result, rerender } = renderHook(() => useSsoCallback());
    await act(async () => {});
    expect(result.current.state).toMatchObject({ step: "signing", pending: true });
    mock.signUpSignal.signUp.id = "sua_invited";
    mock.signUpSignal.signUp.emailAddress = "invited@test.dev";
    rerender(); await act(async () => {});
    expect(result.current.state).toMatchObject({ step: "invite", lockedEmail: "invited@test.dev", pending: false });
  });
  it("sanitizes return query values and retains internal query/hash", async () => {
    window.history.replaceState(null, "", "/sso-callback?redirect_url=%2Fdrafts%3Fjoin%3D1%23seat");
    const first = await mount();
    expect(first.result.current.state.returnTo).toBe("/drafts?join=1#seat");
    first.unmount();
    window.history.replaceState(null, "", "/sso-callback?redirect_url=%2F%2Fevil.test");
    const second = await mount();
    expect(second.result.current.state.returnTo).toBe("/dashboard");
  });
  it("does not finalize a banned callback even if its attempt is complete", async () => {
    mock.signInSignal.signIn.status = "complete";
    mock.signInSignal.errors.global = [{ code: "user_banned" }];
    const { result } = await mount();
    expect(result.current.state.step).toBe("err-banned");
    expect(mock.signInSignal.signIn.finalize).not.toHaveBeenCalled();
  });
  it("waits for signup finalize to resolve and clear the resource before showing success or navigating", async () => {
    mock.signUpSignal.signUp.status = "complete";
    let resolve!: (value: { error: null }) => void;
    mock.signUpSignal.signUp.finalize.mockImplementation(async ({ navigate }: any) => {
      await navigate({ decorateUrl: (path: string) => path });
      await new Promise(r => { resolve = r; });
      mock.signUpSignal.signUp.status = null;
      return { error: null };
    });
    const { result } = renderHook(() => useSsoCallback());
    await act(async () => {});
    expect(result.current.state).toMatchObject({ step: "signing", pending: true });
    act(() => vi.advanceTimersByTime(1000));
    expect(mock.push).not.toHaveBeenCalled();
    await act(async () => { resolve({ error: null }); });
    expect(result.current.state).toMatchObject({ step: "success", banner: null });
    expect(result.current.state.fieldErrors).toEqual({});
    act(() => vi.advanceTimersByTime(900));
    expect(mock.push).toHaveBeenCalledWith("/dashboard");
  });
});
