// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSignUpFlow } from "../../src/hooks/use-sign-up-flow";

const mock = vi.hoisted(() => ({ signal: {} as any, push: vi.fn() }));
vi.mock("@clerk/nextjs", () => ({ useSignUp: () => mock.signal }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mock.push }) }));
const ok = () => Promise.resolve({ error: null });
const account = { username: "duelist", password: "secret", legalAccepted: true };
const setup = (ticket: string | null = "invitation") => renderHook(() => useSignUpFlow({ ticket, returnTo: "/drafts?join=1#seat" }));
const mount = async () => { const view = setup(); await act(async () => {}); return view; };
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1000); mock.push.mockReset(); sessionStorage.clear();
  mock.signal = { fetchStatus: "idle", errors: { fields: {}, raw: null, global: null }, signUp: {
    id: "sua_invited", status: "missing_requirements", emailAddress: "invited@test.dev", username: null, legalAcceptedAt: null,
    missingFields: ["username", "password", "legal_accepted"], unverifiedFields: [],
    ticket: vi.fn(ok), update: vi.fn(ok), password: vi.fn(ok), sso: vi.fn(ok), finalize: vi.fn(ok), reset: vi.fn(ok), create: vi.fn(ok),
    verifications: { sendEmailCode: vi.fn(ok), verifyEmailCode: vi.fn(ok) },
  } };
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("invited sign-up flow", () => {
  it.each(["ticket_invalid_code", "ticket_expired", "ticket_expired_code", "sign_up_restricted_waitlist", "form_identifier_not_found"])("rejects the ticket for %s", async (code) => {
    mock.signal.signUp.ticket.mockResolvedValue({ error: { cause: { errors: [{ code }] } } });
    const { result } = await mount();
    expect(result.current.state).toMatchObject({ step: "err-signup", banner: null });
  });
  it.each(["service_unavailable", "network_error", "fetch_timeout"])("shows service trouble rather than rejecting the invitation for %s", async (code) => {
    mock.signal.signUp.ticket.mockResolvedValue({ error: { cause: { errors: [{ code }] } } });
    const { result } = await mount();
    expect(result.current.state).toMatchObject({ step: "invite", pending: false, banner: { tone: "bad", code } });
    expect(result.current.state.lockedEmail).toBeNull();
  });
  it.each(["ticket_invalid_code", "form_identifier_not_found", "network_error"])("maps ticket signal errors for %s", async (code) => {
    mock.signal.signUp.ticket.mockImplementation(async () => {
      mock.signal.errors = { fields: {}, raw: [], global: [{ code }] };
      return { result: undefined, error: null };
    });
    const { result } = await mount();
    if (code === "network_error") expect(result.current.state).toMatchObject({ step: "invite", banner: { tone: "bad", code } });
    else expect(result.current.state).toMatchObject({ step: "err-signup", banner: null });
  });
  it("keeps banned ticket errors on the unavailable step", async () => {
    mock.signal.signUp.ticket.mockResolvedValue({ error: { errors: [{ code: "user_banned" }] } });
    const { result } = await mount();
    expect(result.current.state.step).toBe("err-banned");
  });
  it.each([undefined, {}, { result: undefined, error: null }])("shows service trouble when the ticket makes no progress (%j)", async (response) => {
    mock.signal.signUp.emailAddress = null;
    mock.signal.signUp.ticket.mockResolvedValue(response);
    const { result } = await mount();
    expect(result.current.state).toMatchObject({ step: "invite", pending: false, banner: { tone: "bad", code: "network_error" } });
  });
  it.each(["result", "global"])("shows service trouble for Clerk's ticket network Error in %s", async (source) => {
    const network = Object.assign(new Error('Clerk: Network error at "https://example.clerk.accounts.dev/v1/client/sign_ups" - TypeError: Failed to fetch. Please try again.'), { isClerkAPIResponseError: () => false, isClerkRuntimeError: () => false });
    mock.signal.signUp.ticket.mockImplementation(async () => {
      if (source === "result") return { error: network };
      mock.signal.errors = { fields: { firstName: null, lastName: null, emailAddress: null, phoneNumber: null, password: null, username: null, code: null, captcha: null, legalAccepted: null }, raw: [network], global: [network] };
      return { result: undefined, error: null };
    });
    const { result } = await mount();
    expect(result.current.state).toMatchObject({ step: "invite", pending: false, banner: { tone: "bad" } });
  });
  it("shows service trouble when a sign-up password makes no progress", async () => {
    const { result } = await mount();
    mock.signal.signUp.password.mockResolvedValue({ result: undefined, error: null });
    await act(() => result.current.actions.submitAccount(account));
    expect(result.current.state).toMatchObject({ step: "invite", pending: false, banner: { tone: "bad", code: "network_error" } });
  });
  it("shows service trouble when sign-up code verification makes no progress", async () => {
    mock.signal.signUp.password.mockImplementation(async () => {
      mock.signal.signUp.missingFields = []; mock.signal.signUp.unverifiedFields = ["email_address"]; return { error: null };
    });
    const { result } = await mount();
    await act(() => result.current.actions.submitAccount(account));
    await act(() => result.current.actions.submitCode("123456"));
    expect(result.current.state).toMatchObject({ step: "code", pending: false, banner: { tone: "bad", code: "network_error" }, resendAvailableAt: 31000 });
  });
  it("consumes the ticket once and locks the Clerk email", async () => {
    const { result } = await mount();
    expect(mock.signal.signUp.ticket).toHaveBeenCalledExactlyOnceWith({ ticket: "invitation" });
    expect(result.current.state).toMatchObject({ step: "invite", identifier: "invited@test.dev", lockedEmail: "invited@test.dev", pending: false });
  });
  it("does not consume the ticket twice in StrictMode", async () => {
    renderHook(() => useSignUpFlow({ ticket: "invitation", returnTo: "/dashboard" }), { wrapper: StrictMode });
    await act(async () => {});
    expect(mock.signal.signUp.ticket).toHaveBeenCalledTimes(1);
  });
  it.each([null, ""])("rejects missing ticket %j even with a stale attempt", async (ticket) => {
    const { result } = setup(ticket); await act(async () => {});
    expect(result.current.state.step).toBe("err-signup");
    expect(mock.signal.signUp.ticket).not.toHaveBeenCalled();
    await act(() => result.current.actions.submitAccount(account));
    expect(mock.signal.signUp.update).not.toHaveBeenCalled();
  });
  it("rejects a failed ticket and never requests a password", async () => {
    mock.signal.signUp.ticket.mockResolvedValue({ error: { errors: [{ code: "ticket_invalid_code" }] } });
    const { result } = await mount();
    expect(result.current.state.step).toBe("err-signup");
    await act(() => result.current.actions.submitAccount(account));
    expect(mock.signal.signUp.password).not.toHaveBeenCalled();
  });
  it("waits for SDK fetch readiness before consuming the ticket", async () => {
    mock.signal.fetchStatus = "fetching";
    const { result, rerender } = setup();
    expect(result.current.state.pending).toBe(true);
    expect(mock.signal.signUp.ticket).not.toHaveBeenCalled();
    mock.signal.fetchStatus = "idle"; rerender(); await act(async () => {});
    expect(result.current.state.step).toBe("invite");
    expect(mock.signal.signUp.ticket).toHaveBeenCalledTimes(1);
  });
  it("requires legal consent locally for both signup methods", async () => {
    const { result } = await mount();
    await act(() => result.current.actions.submitAccount({ ...account, legalAccepted: false }));
    expect(result.current.state.fieldErrors.legal).toBeTruthy();
    await act(() => result.current.actions.continueWithDiscord({ username: "duelist", legalAccepted: false }));
    expect(mock.signal.signUp.update).not.toHaveBeenCalled();
    expect(mock.signal.signUp.password).not.toHaveBeenCalled();
    expect(mock.signal.signUp.sso).not.toHaveBeenCalled();
  });
  it("stores username and consent before password, verifies email, then shows success after finalize clears the sign-up", async () => {
    mock.signal.signUp.finalize.mockImplementation(async () => { mock.signal.signUp.status = null; return { error: null }; });
    mock.signal.signUp.password.mockImplementation(async () => {
      mock.signal.signUp.missingFields = []; mock.signal.signUp.unverifiedFields = ["email_address"]; return { error: null };
    });
    const { result } = await mount();
    await act(() => result.current.actions.submitAccount(account));
    expect(mock.signal.signUp.update).toHaveBeenCalledWith({ username: "duelist", legalAccepted: true });
    expect(mock.signal.signUp.password).toHaveBeenCalledWith({ password: "secret" });
    expect(mock.signal.signUp.update.mock.invocationCallOrder[0]).toBeLessThan(mock.signal.signUp.password.mock.invocationCallOrder[0]);
    expect(result.current.state).toMatchObject({ step: "code", codePurpose: "signup", lockedEmail: "invited@test.dev", resendAvailableAt: 31000 });
    expect(mock.signal.signUp.verifications.sendEmailCode).toHaveBeenCalledTimes(1);
    await act(() => result.current.actions.resendCode());
    expect(mock.signal.signUp.verifications.sendEmailCode).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(30000));
    await act(() => result.current.actions.resendCode());
    expect(mock.signal.signUp.verifications.sendEmailCode).toHaveBeenCalledTimes(2);
    mock.signal.signUp.verifications.verifyEmailCode.mockImplementation(async () => { mock.signal.signUp.status = "complete"; return { error: null }; });
    await act(() => result.current.actions.submitCode("123456"));
    expect(mock.signal.signUp.verifications.verifyEmailCode).toHaveBeenCalledWith({ code: "123456" });
    expect(result.current.state).toMatchObject({ step: "success", banner: null });
    expect(result.current.state.fieldErrors).toEqual({});
    expect(mock.push).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(900));
    expect(mock.push).toHaveBeenCalledWith("/drafts?join=1#seat");
  });
  it("keeps the ticket attempt for Discord and saves consent before redirect", async () => {
    const { result } = await mount();
    await act(() => result.current.actions.continueWithDiscord({ username: "duelist", legalAccepted: true }));
    expect(mock.signal.signUp.update).toHaveBeenCalledWith({ username: "duelist", legalAccepted: true });
    expect(mock.signal.signUp.sso).toHaveBeenCalledWith({ strategy: "oauth_discord", redirectUrl: "/drafts?join=1#seat", redirectCallbackUrl: "/sso-callback" });
    expect(mock.signal.signUp.update.mock.invocationCallOrder[0]).toBeLessThan(mock.signal.signUp.sso.mock.invocationCallOrder[0]);
    expect(mock.signal.signUp.ticket).toHaveBeenCalledTimes(1);
    expect(mock.signal.signUp.create).not.toHaveBeenCalled();
    expect(mock.signal.signUp.reset).not.toHaveBeenCalled();
    expect(result.current.state.lockedEmail).toBe("invited@test.dev");
  });
  it("keeps a taken username error and stops before password/SSO", async () => {
    mock.signal.signUp.update.mockResolvedValue({ error: { errors: [{ code: "form_username_exists" }] } });
    const { result } = await mount();
    await act(() => result.current.actions.submitAccount(account));
    expect(result.current.state).toMatchObject({ step: "invite", fieldErrors: { username: "That username is taken." } });
    expect(mock.signal.signUp.password).not.toHaveBeenCalled();
    await act(() => result.current.actions.continueWithDiscord({ username: "duelist", legalAccepted: true }));
    expect(mock.signal.signUp.sso).not.toHaveBeenCalled();
  });
  it("never finalizes missing requirements and blocks duplicate signup requests", async () => {
    let resolve!: (value: { error: null }) => void;
    mock.signal.signUp.update.mockImplementation(() => new Promise(r => { resolve = r; }));
    const { result } = await mount();
    let request!: Promise<void>;
    act(() => { request = result.current.actions.submitAccount(account); });
    expect(result.current.state.pending).toBe(true);
    await act(() => result.current.actions.submitAccount(account));
    await act(async () => { resolve({ error: null }); await request; });
    expect(mock.signal.signUp.update).toHaveBeenCalledTimes(1);
    expect(mock.signal.signUp.finalize).not.toHaveBeenCalled();
    expect(mock.push).not.toHaveBeenCalled();
  });
  it("keeps failed finalize on signing and maps network failures", async () => {
    mock.signal.signUp.password.mockImplementation(async () => { mock.signal.signUp.status = "complete"; return { error: null }; });
    mock.signal.signUp.finalize.mockResolvedValue({ error: { code: "service" } });
    const { result } = await mount();
    await act(() => result.current.actions.submitAccount(account));
    expect(result.current.state).toMatchObject({ step: "signing", pending: false, banner: { tone: "bad", code: "service", body: "Sign-in is having trouble. Try again in a moment." } });
    act(() => vi.advanceTimersByTime(2000));
    expect(mock.push).not.toHaveBeenCalled();
  });
  it("keeps the locked email when Clerk's attempt unexpectedly changes", async () => {
    const { result } = await mount();
    mock.signal.signUp.emailAddress = "other@test.dev";
    await act(() => result.current.actions.submitAccount(account));
    expect(result.current.state).toMatchObject({ step: "err-signup", lockedEmail: "invited@test.dev" });
    expect(mock.signal.signUp.update).not.toHaveBeenCalled();
  });
  it("blocks account actions during Clerk fetching and maps network failures", async () => {
    const { result, rerender } = await mount();
    mock.signal.fetchStatus = "fetching"; rerender();
    await act(() => result.current.actions.submitAccount(account));
    expect(mock.signal.signUp.update).not.toHaveBeenCalled();
    mock.signal.fetchStatus = "idle"; rerender();
    mock.signal.signUp.update.mockRejectedValue(new Error("offline"));
    await act(() => result.current.actions.submitAccount(account));
    expect(result.current.state).toMatchObject({ step: "invite", pending: false, banner: { tone: "bad" } });
  });
  it("handles global signal errors even when raw errors is an empty array", async () => {
    const { result, rerender } = await mount();
    mock.signal.errors = { fields: {}, raw: [], global: [{ code: "user_banned" }] }; rerender();
    expect(result.current.state.step).toBe("err-banned");
  });
  it("does not advance past a signal field error even when the method returns no error", async () => {
    const { result } = await mount();
    mock.signal.signUp.update.mockImplementation(async () => {
      mock.signal.errors.fields.username = { code: "form_username_exists", message: "Taken" };
      return { error: null };
    });
    await act(() => result.current.actions.submitAccount(account));
    expect(result.current.state).toMatchObject({ step: "invite", fieldErrors: { username: "That username is taken." } });
    expect(mock.signal.signUp.password).not.toHaveBeenCalled();
  });
});
