// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSignInFlow } from "../../src/hooks/use-sign-in-flow";

const mock = vi.hoisted(() => ({ signal: {} as any, push: vi.fn() }));
vi.mock("@clerk/nextjs", () => ({ useSignIn: () => mock.signal }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mock.push }) }));
const ok = () => Promise.resolve({ error: null });
const setup = () => renderHook(() => useSignInFlow({ returnTo: "/drafts?join=1#seat", marketingUrl: "https://duelingdomain.com" }));
const error = (code: string) => ({ error: { errors: [{ code }] } });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  mock.push.mockReset();
  sessionStorage.clear();
  mock.signal = { fetchStatus: "idle", errors: { fields: {}, raw: null, global: null }, signIn: {
    status: "needs_identifier", supportedSecondFactors: [{ strategy: "email_code" }], isTransferable: false,
    create: vi.fn(async () => { mock.signal.signIn.status = "needs_first_factor"; return { error: null }; }),
    password: vi.fn(ok), sso: vi.fn(ok), reset: vi.fn(ok), ticket: vi.fn(ok), finalize: vi.fn(ok),
    mfa: { sendEmailCode: vi.fn(ok), verifyEmailCode: vi.fn(ok) },
    resetPasswordEmailCode: { sendCode: vi.fn(ok), verifyCode: vi.fn(ok), submitPassword: vi.fn(ok) },
  } };
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("sign-in flow", () => {
  it("identifies the email then requests the password", async () => {
    const { result } = setup();
    await act(() => result.current.actions.submitIdentifier("a@test.dev"));
    expect(mock.signal.signIn.create).toHaveBeenCalledWith({ identifier: "a@test.dev" });
    expect(result.current.state).toMatchObject({ step: "password", identifier: "a@test.dev", pending: false });
  });
  it("retains a missing identifier on the invitation error step", async () => {
    mock.signal.signIn.create.mockResolvedValue(error("form_identifier_not_found"));
    const { result } = setup();
    await act(() => result.current.actions.submitIdentifier("a@test.dev"));
    expect(result.current.state).toMatchObject({ step: "err-invite", identifier: "a@test.dev" });
  });
  it("preserves the return path for Discord and uses the custom callback", async () => {
    const { result } = setup();
    await act(() => result.current.actions.continueWithDiscord());
    expect(mock.signal.signIn.sso).toHaveBeenCalledWith({ strategy: "oauth_discord", redirectUrl: "/drafts?join=1#seat", redirectCallbackUrl: "/sso-callback" });
    expect(mock.push).not.toHaveBeenCalled();
  });
  it("keeps wrong password errors on the password field", async () => {
    const { result } = setup();
    await act(() => result.current.actions.submitIdentifier("a@test.dev"));
    mock.signal.signIn.password.mockResolvedValue(error("form_password_incorrect"));
    await act(() => result.current.actions.submitPassword("wrong"));
    expect(result.current.state).toMatchObject({ step: "password", fieldErrors: { password: "That password doesn't match. Try again or reset it." } });
  });
  it("blocks duplicates and delays navigation until successful finalize plus the success frame", async () => {
    let finish!: (value: { error: null }) => void;
    mock.signal.signIn.password.mockImplementation(async () => { mock.signal.signIn.status = "complete"; return { error: null }; });
    mock.signal.signIn.finalize.mockImplementation(async ({ navigate }: any) => {
      await navigate({ decorateUrl: (path: string) => path });
      return new Promise(resolve => { finish = resolve; });
    });
    const { result } = setup();
    await act(() => result.current.actions.submitIdentifier("a@test.dev"));
    let request!: Promise<void>;
    act(() => { request = result.current.actions.submitPassword("secret"); });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.state).toMatchObject({ step: "signing", pending: true });
    await act(() => result.current.actions.submitPassword("secret"));
    expect(mock.signal.signIn.password).toHaveBeenCalledTimes(1);
    expect(mock.push).not.toHaveBeenCalled();
    await act(async () => { finish({ error: null }); await request; });
    expect(result.current.state.step).toBe("success");
    act(() => vi.advanceTimersByTime(899));
    expect(mock.push).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(mock.push).toHaveBeenCalledWith("/drafts?join=1#seat");
  });
  it("shows a service banner when finalize fails and never navigates", async () => {
    mock.signal.signIn.password.mockImplementation(async () => { mock.signal.signIn.status = "complete"; return { error: null }; });
    mock.signal.signIn.finalize.mockResolvedValue(error("service_unavailable"));
    const { result } = setup();
    await act(() => result.current.actions.submitIdentifier("a@test.dev"));
    await act(() => result.current.actions.submitPassword("secret"));
    expect(result.current.state).toMatchObject({ step: "signing", pending: false, banner: { tone: "bad" } });
    act(() => vi.advanceTimersByTime(2000));
    expect(mock.push).not.toHaveBeenCalled();
  });
  it.each(["needs_client_trust", "needs_second_factor"])("sends and verifies the email factor for %s", async (status) => {
    mock.signal.signIn.password.mockImplementation(async () => { mock.signal.signIn.status = status; return { error: null }; });
    const { result } = setup();
    await act(() => result.current.actions.submitIdentifier("a@test.dev"));
    await act(() => result.current.actions.submitPassword("secret"));
    expect(result.current.state).toMatchObject({ step: "code", codePurpose: "client-trust", resendAvailableAt: 31000 });
    expect(mock.signal.signIn.mfa.sendEmailCode).toHaveBeenCalledTimes(1);
    mock.signal.signIn.mfa.verifyEmailCode.mockResolvedValue(error("form_code_incorrect"));
    await act(() => result.current.actions.submitCode("123456"));
    expect(result.current.state.fieldErrors.code).toBe("That code isn't right.");
    expect(mock.signal.signIn.mfa.verifyEmailCode).toHaveBeenCalledWith({ code: "123456" });
    await act(() => result.current.actions.resendCode());
    expect(mock.signal.signIn.mfa.sendEmailCode).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(30000));
    await act(() => result.current.actions.resendCode());
    expect(mock.signal.signIn.mfa.sendEmailCode).toHaveBeenCalledTimes(2);
    expect(result.current.state.resendAvailableAt).toBe(61000);
  });
  it("does not attempt unsupported second factors", async () => {
    mock.signal.signIn.supportedSecondFactors = [{ strategy: "totp" }];
    mock.signal.signIn.password.mockImplementation(async () => { mock.signal.signIn.status = "needs_second_factor"; return { error: null }; });
    const { result } = setup();
    await act(() => result.current.actions.submitIdentifier("a@test.dev"));
    await act(() => result.current.actions.submitPassword("secret"));
    expect(mock.signal.signIn.mfa.sendEmailCode).not.toHaveBeenCalled();
    expect(result.current.state.banner?.tone).toBe("bad");
  });
  it("resets by code, rejects confirmation mismatch locally, then finalizes", async () => {
    const { result } = setup();
    await act(() => result.current.actions.submitIdentifier("a@test.dev"));
    await act(() => result.current.actions.forgotPassword());
    expect(result.current.state).toMatchObject({ step: "code", codePurpose: "reset" });
    await act(() => result.current.actions.resendCode());
    expect(mock.signal.signIn.resetPasswordEmailCode.sendCode).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(30000));
    await act(() => result.current.actions.resendCode());
    expect(mock.signal.signIn.resetPasswordEmailCode.sendCode).toHaveBeenCalledTimes(2);
    mock.signal.signIn.resetPasswordEmailCode.verifyCode.mockImplementation(async () => { mock.signal.signIn.status = "needs_new_password"; return { error: null }; });
    await act(() => result.current.actions.submitCode("123456"));
    expect(mock.signal.signIn.resetPasswordEmailCode.verifyCode).toHaveBeenCalledWith({ code: "123456" });
    expect(result.current.state.step).toBe("newpw");
    await act(() => result.current.actions.submitNewPassword("secret", "other"));
    expect(result.current.state.fieldErrors.confirm).toBeTruthy();
    expect(mock.signal.signIn.resetPasswordEmailCode.submitPassword).not.toHaveBeenCalled();
    mock.signal.signIn.resetPasswordEmailCode.submitPassword.mockImplementation(async () => { mock.signal.signIn.status = "complete"; return { error: null }; });
    await act(() => result.current.actions.submitNewPassword("secret", "secret"));
    expect(mock.signal.signIn.resetPasswordEmailCode.submitPassword).toHaveBeenCalledWith({ password: "secret" });
    expect(result.current.state.step).toBe("success");
  });
  it("resets the Clerk attempt on back and disallows requests from the wrong step", async () => {
    const { result } = setup();
    await act(() => result.current.actions.submitPassword("secret"));
    expect(mock.signal.signIn.password).not.toHaveBeenCalled();
    await act(() => result.current.actions.submitIdentifier("a@test.dev"));
    await act(async () => result.current.actions.back());
    expect(result.current.state).toMatchObject({ step: "signin", identifier: null });
    expect(mock.signal.signIn.reset).toHaveBeenCalledTimes(1);
  });
  it("honors fetchStatus and reports a stuck fetch", async () => {
    mock.signal.fetchStatus = "fetching";
    const { result } = setup();
    expect(result.current.state.pending).toBe(true);
    await act(() => result.current.actions.submitIdentifier("a@test.dev"));
    expect(mock.signal.signIn.create).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(30000));
    expect(result.current.state.banner?.tone).toBe("bad");
  });
  it("maps signal field errors and catches rejected network calls", async () => {
    const { result, rerender } = setup();
    await act(() => result.current.actions.submitIdentifier("a@test.dev"));
    mock.signal.errors.fields.password = { code: "form_password_incorrect", message: "Wrong" };
    rerender();
    expect(result.current.state.fieldErrors.password).toBeTruthy();
    mock.signal.errors = { fields: {}, raw: null, global: null };
    mock.signal.signIn.password.mockRejectedValue(new Error("offline"));
    await act(() => result.current.actions.submitPassword("secret"));
    expect(result.current.state).toMatchObject({ step: "password", pending: false, banner: { tone: "bad" } });
  });
  it("cancels delayed navigation when unmounted", async () => {
    mock.signal.signIn.password.mockImplementation(async () => { mock.signal.signIn.status = "complete"; return { error: null }; });
    const { result, unmount } = setup();
    await act(() => result.current.actions.submitIdentifier("a@test.dev"));
    await act(() => result.current.actions.submitPassword("secret"));
    unmount();
    act(() => vi.advanceTimersByTime(1000));
    expect(mock.push).not.toHaveBeenCalled();
  });
  it("handles global signal errors even when raw errors is an empty array", () => {
    mock.signal.errors = { fields: {}, raw: [], global: [{ code: "user_banned" }] };
    const { result } = setup();
    expect(result.current.state.step).toBe("err-banned");
  });
  it("reports a changed signal snapshot after a request, rather than advancing from stale status", async () => {
    const view = setup();
    const create = mock.signal.signIn.create;
    create.mockImplementation(async () => {
      mock.signal = { ...mock.signal, signIn: { ...mock.signal.signIn, status: "needs_first_factor" } };
      // Commit the signal notification before resolving the SDK method.
      flushSync(() => view.rerender());
      return { error: null };
    });
    await act(() => view.result.current.actions.submitIdentifier("a@test.dev"));
    expect(view.result.current.state.step).toBe("password");
  });
  it("does not finalize when the signal still reports a request error", async () => {
    const { result } = setup();
    await act(() => result.current.actions.submitIdentifier("a@test.dev"));
    mock.signal.signIn.password.mockImplementation(async () => {
      mock.signal.signIn.status = "complete";
      mock.signal.errors.fields.password = { code: "form_password_incorrect", message: "Wrong" };
      return { error: null };
    });
    await act(() => result.current.actions.submitPassword("secret"));
    expect(result.current.state).toMatchObject({ step: "password", fieldErrors: { password: "That password doesn't match. Try again or reset it." } });
    expect(mock.signal.signIn.finalize).not.toHaveBeenCalled();
    expect(mock.push).not.toHaveBeenCalled();
  });
});
