// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthFlowState, AuthStep } from "@/lib/auth-flow";

vi.mock("next/font/local", () => ({
  default: ({ variable }: { variable: string }) => ({ variable, className: "font-class" }),
}));

const { signInFlow, signUpFlow, ssoFlow, redirect, hardNavigate, authState, routerReplace } = vi.hoisted(() => ({
  authState: { isLoaded: true, isSignedIn: false },
  routerReplace: vi.fn(),
  signInFlow: vi.fn(),
  signUpFlow: vi.fn(),
  ssoFlow: vi.fn(),
  redirect: vi.fn((to: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT", to }); }),
  hardNavigate: vi.fn(),
}));
vi.mock("@/hooks/use-sign-in-flow", () => ({ useSignInFlow: signInFlow }));
vi.mock("@/hooks/use-sign-up-flow", () => ({ useSignUpFlow: signUpFlow }));
vi.mock("@/hooks/use-sso-callback", () => ({ useSsoCallback: ssoFlow }));
vi.mock("next/navigation", () => ({ redirect, useRouter: () => ({ replace: routerReplace }) }));
vi.mock("@clerk/nextjs", () => ({ useAuth: () => authState }));
vi.mock("@/components/auth/navigate", () => ({ hardNavigate }));

import LoginPage from "../../../app/(auth)/login/page";
import SignInPage from "../../../app/(auth)/sign-in/[[...sign-in]]/page";
import SignUpPage from "../../../app/(auth)/sign-up/[[...sign-up]]/page";
import SsoCallbackPage from "../../../app/(auth)/sso-callback/page";
import AccessPage from "../../../app/(auth)/access/page";

const MARKETING = "https://marketing.example";
const stuck = { tone: "bad" as const, body: "Sign-in is having trouble. Try again in a moment.", code: "fetch_timeout" };

function state(step: AuthStep, extra: Partial<AuthFlowState> = {}): AuthFlowState {
  return {
    step, identifier: "sam@example.com", lockedEmail: null, codePurpose: null, fieldErrors: {}, banner: null,
    pending: false, resendAvailableAt: null, returnTo: "/dashboard", ...extra,
  };
}
const signInActions = () => ({
  submitIdentifier: vi.fn(), continueWithDiscord: vi.fn(), submitPassword: vi.fn(), forgotPassword: vi.fn(),
  submitCode: vi.fn(), resendCode: vi.fn(), submitNewPassword: vi.fn(), back: vi.fn(),
});
const signUpActions = () => ({ submitAccount: vi.fn(), continueWithDiscord: vi.fn(), submitCode: vi.fn(), resendCode: vi.fn() });

beforeEach(() => {
  authState.isLoaded = true;
  authState.isSignedIn = false;
  vi.stubEnv("MARKETING_URL", MARKETING);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const root = (container: HTMLElement) => container.firstElementChild as HTMLElement;
const screenOf = (container: HTMLElement) => container.querySelector("[data-screen]")?.getAttribute("data-screen");

async function renderSignIn(flowState: AuthFlowState, params: Record<string, string | string[]> = {}) {
  const actions = signInActions();
  signInFlow.mockReturnValue({ state: flowState, actions });
  const view = render(await SignInPage({ searchParams: Promise.resolve(params) }));
  return { ...view, actions };
}
async function renderSignUp(flowState: AuthFlowState, params: Record<string, string | string[]> = {}) {
  const actions = signUpActions();
  signUpFlow.mockReturnValue({ state: flowState, actions });
  const view = render(await SignUpPage({ searchParams: Promise.resolve(params) }));
  return { ...view, actions };
}
async function renderCallback(flowState: AuthFlowState) {
  const actions = signUpActions();
  ssoFlow.mockReturnValue({ state: flowState, resumeKind: "sign-up", actions });
  const view = render(await SsoCallbackPage());
  return { ...view, actions };
}

describe("sign-in page", () => {
  it.each([
    ["signin", "signin"], ["password", "password"], ["code", "code"], ["newpw", "newpw"], ["signing", "signing"], ["recovering", "recovering"],
    ["success", "success"], ["err-invite", "err-invite"], ["err-signup", "err-signup"], ["err-banned", "err-banned"],
  ] as const)("renders the %s step", async (step, screenName) => {
    const { container } = await renderSignIn(state(step, { codePurpose: "reset" }));
    expect(screenOf(container)).toBe(screenName);
  });

  it("shows the service banner on the identifier step", async () => {
    const { container } = await renderSignIn(state("signin", { banner: { tone: "bad", body: "Sign-in is having trouble.", code: "x" } }));
    expect(screenOf(container)).toBe("err-service");
    expect(screen.getByRole("alert")).toHaveTextContent("Sign-in is having trouble.");
  });

  it("shows banners on the password, code and new password steps", async () => {
    const banner = { tone: "bad" as const, body: "Sign-in is having trouble. Try again in a moment." };
    for (const step of ["password", "code", "newpw"] as const) {
      const { unmount } = await renderSignIn(state(step, { banner, codePurpose: "reset" }));
      expect(screen.getByRole("alert")).toHaveTextContent("Sign-in is having trouble.");
      unmount();
    }
  });

  it("opens the pack only on success and marks error steps as bad", async () => {
    for (const [step, pack, tone] of [
      ["signin", "sealed", "neutral"], ["password", "sealed", "neutral"], ["signing", "sealed", "neutral"], ["recovering", "sealed", "neutral"],
      ["success", "open", "neutral"], ["err-invite", "sealed", "bad"], ["err-signup", "sealed", "bad"], ["err-banned", "sealed", "bad"],
    ] as const) {
      const { container, unmount } = await renderSignIn(state(step, { codePurpose: "reset" }));
      expect(root(container)).toHaveAttribute("data-pack-state", pack);
      expect(root(container)).toHaveAttribute("data-tone", tone);
      unmount();
    }
  });

  it("passes the safe return path and marketing URL to the hook", async () => {
    await renderSignIn(state("signin"), { redirect_url: "/drafts/x?tab=1" });
    expect(signInFlow).toHaveBeenCalledWith({ returnTo: "/drafts/x?tab=1", marketingUrl: MARKETING });
  });

  it.each(["//evil.example", "https://evil.example", "/\\evil", "/sign-in", "/sso-callback?x=1"])("falls back to the dashboard for %s", async (bad) => {
    await renderSignIn(state("signin"), { redirect_url: bad });
    expect(signInFlow).toHaveBeenCalledWith({ returnTo: "/dashboard", marketingUrl: MARKETING });
  });

  it("uses the first value of a repeated redirect_url and the default marketing site when unset", async () => {
    vi.stubEnv("MARKETING_URL", "");
    await renderSignIn(state("signin"), { redirect_url: ["/cubes", "/other"] });
    expect(signInFlow).toHaveBeenCalledWith({ returnTo: "/cubes", marketingUrl: "https://duelingdomain.com" });
  });

  it("wires the step handlers to the flow actions", async () => {
    const user = userEvent.setup();
    const { actions } = await renderSignIn(state("signin", { identifier: null }));
    await user.click(screen.getByRole("button", { name: "Continue with Discord" }));
    expect(actions.continueWithDiscord).toHaveBeenCalledOnce();
    await user.type(screen.getByLabelText("Email address"), "sam@example.com");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(actions.submitIdentifier).toHaveBeenCalledWith("sam@example.com");
  });

  it("offers the waitlist join on the not-invited card and goes back through the hook", async () => {
    const user = userEvent.setup();
    const { actions } = await renderSignIn(state("err-invite"));
    expect(screen.getByRole("button", { name: "Join the waitlist" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Try a different email" }));
    expect(actions.back).toHaveBeenCalledOnce();
  });

  it("drops the error tone once the not-invited email is on the waitlist, and restores it on retry", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "joined" }), { status: 201 })));
    const { container, actions } = await renderSignIn(state("err-invite"));
    expect(root(container)).toHaveAttribute("data-tone", "bad");
    await user.click(screen.getByRole("button", { name: "Join the waitlist" }));
    const heading = await screen.findByRole("heading", { level: 1, name: "You’re on the list" });
    expect(heading).toHaveFocus();
    expect(root(container)).toHaveAttribute("data-tone", "neutral");
    await user.click(screen.getByRole("button", { name: "Use a different email" }));
    expect(actions.back).toHaveBeenCalledOnce();
  });

  it("restarts the page from the closed and unavailable cards", async () => {
    const user = userEvent.setup();
    await renderSignIn(state("err-signup", { returnTo: "/cubes" }));
    await user.click(screen.getByRole("button", { name: "Back to sign in" }));
    expect(hardNavigate).toHaveBeenCalledWith("/sign-in?redirect_url=/cubes");
    cleanup();
    await renderSignIn(state("err-banned"));
    await user.click(screen.getByRole("button", { name: "Back to sign in" }));
    expect(hardNavigate).toHaveBeenLastCalledWith("/sign-in");
  });

  it("shows the error and a retry instead of spinning when finalize fails on the signing card", async () => {
    const user = userEvent.setup();
    const { container } = await renderSignIn(state("signing", { banner: stuck, returnTo: "/cubes" }));
    expect(screenOf(container)).toBe("err-service");
    expect(screen.getByRole("alert")).toHaveTextContent("Sign-in is having trouble.");
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(root(container)).toHaveAttribute("data-tone", "bad");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(hardNavigate).toHaveBeenCalledWith("/sign-in?redirect_url=/cubes");
  });

  it("turns the tone bad for a banner or a field error on a non-error step", async () => {
    const withBanner = await renderSignIn(state("signin", { banner: stuck }));
    expect(root(withBanner.container)).toHaveAttribute("data-tone", "bad");
    withBanner.unmount();
    const withField = await renderSignIn(state("password", { fieldErrors: { password: "That password doesn’t match." } }));
    expect(root(withField.container)).toHaveAttribute("data-tone", "bad");
  });

  it("does not render a CAPTCHA mount", async () => {
    const { container } = await renderSignIn(state("signin"));
    expect(container.querySelector("#clerk-captcha")).toBeNull();
  });
});

describe("sign-up page", () => {
  it("passes the ticket and safe return path to the hook", async () => {
    await renderSignUp(state("invite", { lockedEmail: "sam@example.com" }), { __clerk_ticket: "tkt", redirect_url: "/drafts" });
    expect(signUpFlow).toHaveBeenCalledWith({ ticket: "tkt", returnTo: "/drafts" });
  });

  it("passes a null ticket and the default return path when the query is missing or unsafe", async () => {
    await renderSignUp(state("err-signup"), { redirect_url: "//evil.example" });
    expect(signUpFlow).toHaveBeenCalledWith({ ticket: null, returnTo: "/dashboard" });
  });

  it("renders the invite card with the locked email and no email query value", async () => {
    const { container } = await renderSignUp(state("invite", { lockedEmail: "sam@example.com" }), { __clerk_ticket: "x", email: "attacker@example.com" });
    expect(screenOf(container)).toBe("invite");
    const email = screen.getByLabelText("Email address");
    expect(email).toHaveAttribute("readonly");
    expect(email).toHaveValue("sam@example.com");
    expect(container).not.toHaveTextContent("attacker@example.com");
  });

  it("shows a checking card instead of an empty invite before the ticket resolves", async () => {
    const { container } = await renderSignUp(state("invite", { lockedEmail: null, identifier: null, pending: true }), { __clerk_ticket: "x" });
    expect(screenOf(container)).toBe("checking-invite");
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByLabelText("Email address")).toBeNull();
  });

  it("shows the error and a reload retry when the invite cannot be opened", async () => {
    const user = userEvent.setup();
    const { container } = await renderSignUp(state("invite", { lockedEmail: null, identifier: null, banner: stuck }), { __clerk_ticket: "x" });
    expect(screenOf(container)).toBe("err-service");
    expect(screen.getByRole("alert")).toHaveTextContent("Sign-in is having trouble.");
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelectorAll("#clerk-captcha")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(hardNavigate).toHaveBeenCalledWith(window.location.href);
  });

  it("renders code, signing, success and the error cards", async () => {
    for (const [flowState, expected] of [
      [state("code", { codePurpose: "signup", lockedEmail: "sam@example.com" }), "code"],
      [state("signing", { lockedEmail: "sam@example.com" }), "signing"],
      [state("success", { lockedEmail: "sam@example.com" }), "success"],
      [state("err-signup"), "err-signup"],
      [state("err-banned"), "err-banned"],
    ] as const) {
      const { container, unmount } = await renderSignUp(flowState, { __clerk_ticket: "x" });
      expect(screenOf(container)).toBe(expected);
      unmount();
    }
  });

  it("hides 'Use a different email' on the signup code card because the email is locked", async () => {
    await renderSignUp(state("code", { codePurpose: "signup", lockedEmail: "sam@example.com" }), { __clerk_ticket: "x" });
    expect(screen.queryByRole("button", { name: "Use a different email" })).toBeNull();
  });

  it("opens the pack on success and marks error steps as bad", async () => {
    const success = await renderSignUp(state("success", { lockedEmail: "a@b.co" }), { __clerk_ticket: "x" });
    expect(root(success.container)).toHaveAttribute("data-pack-state", "open");
    success.unmount();
    const bad = await renderSignUp(state("err-signup"));
    expect(root(bad.container)).toHaveAttribute("data-tone", "bad");
    expect(root(bad.container)).toHaveAttribute("data-pack-state", "sealed");
  });

  it("wires create-account to the flow actions", async () => {
    const user = userEvent.setup();
    const { actions } = await renderSignUp(state("invite", { lockedEmail: "sam@example.com" }), { __clerk_ticket: "x" });
    await user.type(screen.getByLabelText("Username"), "cardshark");
    await user.type(screen.getByLabelText("Create password"), "correct horse battery");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(actions.submitAccount).toHaveBeenCalledWith({ username: "cardshark", password: "correct horse battery", legalAccepted: true });
    await user.click(screen.getByRole("button", { name: "Continue with Discord" }));
    expect(actions.continueWithDiscord).toHaveBeenCalledWith({ username: "cardshark", legalAccepted: true });
  });

  it.each([
    ["checking", state("invite", { lockedEmail: null, pending: true })],
    ["invite", state("invite", { lockedEmail: "sam@example.com" })],
    ["signing", state("signing")],
    ["err-signup", state("err-signup")],
  ])("owns exactly one #clerk-captcha from the first render (%s)", async (_name, flowState) => {
    const { container } = await renderSignUp(flowState, { __clerk_ticket: "x" });
    expect(container.querySelectorAll("#clerk-captcha")).toHaveLength(1);
    expect(container.querySelector("#clerk-captcha")?.children).toHaveLength(0);
  });
});

describe("SSO callback page", () => {
  it("starts on the signing card", async () => {
    const { container } = await renderCallback(state("signing"));
    expect(screenOf(container)).toBe("signing");
  });

  it("asks only for username and consent when requirements are missing", async () => {
    const { container } = await renderCallback(state("invite", { lockedEmail: "sam@example.com" }));
    expect(screenOf(container)).toBe("invite");
    expect(screen.getByLabelText("Email address")).toHaveAttribute("readonly");
    expect(screen.queryByLabelText("Create password")).toBeNull();
    expect(screen.queryByRole("button", { name: "Continue with Discord" })).toBeNull();
  });

  it("shows the error and a retry instead of spinning when the callback cannot resume", async () => {
    const user = userEvent.setup();
    const { container } = await renderCallback(state("signing", { banner: stuck, returnTo: "/drafts" }));
    expect(screenOf(container)).toBe("err-service");
    expect(screen.getByRole("alert")).toHaveTextContent("Sign-in is having trouble.");
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelectorAll("#clerk-captcha")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(hardNavigate).toHaveBeenCalledWith("/sign-in?redirect_url=/drafts");
  });

  it("renders code, success and error cards", async () => {
    for (const [flowState, expected] of [
      [state("code", { codePurpose: "signup", lockedEmail: "sam@example.com" }), "code"],
      [state("success"), "success"],
      [state("err-signup"), "err-signup"],
      [state("err-banned"), "err-banned"],
    ] as const) {
      const { container, unmount } = await renderCallback(flowState);
      expect(screenOf(container)).toBe(expected);
      unmount();
    }
  });

  it("opens the pack on success and uses bad tone on errors", async () => {
    const ok = await renderCallback(state("success"));
    expect(root(ok.container)).toHaveAttribute("data-pack-state", "open");
    ok.unmount();
    const bad = await renderCallback(state("err-banned"));
    expect(root(bad.container)).toHaveAttribute("data-tone", "bad");
  });

  it.each([
    ["signing", state("signing")],
    ["invite", state("invite", { lockedEmail: "sam@example.com" })],
    ["err-signup", state("err-signup")],
  ])("owns exactly one #clerk-captcha from the first render (%s)", async (_name, flowState) => {
    const { container } = await renderCallback(flowState);
    expect(container.querySelectorAll("#clerk-captcha")).toHaveLength(1);
  });
});

describe("login redirect", () => {
  async function loginTo(params: Record<string, string | string[] | undefined>) {
    try {
      await LoginPage({ searchParams: Promise.resolve(params) });
    } catch (error) {
      return (error as { to?: string }).to;
    }
    throw new Error("expected a redirect");
  }

  it("sends /login to /sign-in", async () => {
    expect(await loginTo({})).toBe("/sign-in");
  });

  it("keeps a safe callbackUrl as redirect_url", async () => {
    expect(await loginTo({ callbackUrl: "/x" })).toBe("/sign-in?redirect_url=/x");
    expect(await loginTo({ callbackUrl: "/drafts/a?tab=1&b=2#c" })).toBe("/sign-in?redirect_url=/drafts/a%3Ftab%3D1%26b%3D2%23c");
  });

  it.each(["//evil.example", "https://evil.example/x", "/\\evil", "javascript:alert(1)", "/sign-in", "/sign-up?x=1", "/sso-callback"])("drops %s", async (bad) => {
    expect(await loginTo({ callbackUrl: bad })).toBe("/sign-in");
  });

  it("ignores the retired NextAuth error parameter", async () => {
    expect(await loginTo({ error: "Configuration" })).toBe("/sign-in");
  });
});

describe("access page", () => {
  it("explains the invite-only alpha with the waitlist, sign-in and legal links", async () => {
    const { container } = render(await AccessPage());
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/invite-only/i);
    expect(screen.getByRole("link", { name: "Join the waitlist" })).toHaveAttribute("href", `${MARKETING}/?home=1#join`);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
    expect(container).toHaveTextContent("Invited? Use the link in your email.");
    const foot = container.querySelector('[data-slot="foot"]') as HTMLElement;
    expect(within(foot).getByRole("link", { name: "Terms" })).toHaveAttribute("href", "https://duelingdomain.com/terms");
    expect(within(foot).getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "https://duelingdomain.com/privacy");
    expect(root(container)).toHaveAttribute("data-pack-state", "sealed");
  });

  it("falls back to the public marketing site when MARKETING_URL is unset", async () => {
    vi.stubEnv("MARKETING_URL", "");
    render(await AccessPage());
    expect(screen.getByRole("link", { name: "Join the waitlist" })).toHaveAttribute("href", "https://duelingdomain.com/?home=1#join");
  });

  it("imports nothing from Clerk and has no client code", () => {
    for (const file of ["app/(auth)/access/page.tsx", "src/components/auth/access-content.tsx"]) {
      const source = readFileSync(join(__dirname, "../../..", file), "utf8");
      expect(source).not.toMatch(/from\s+["'][^"']*clerk|require\(["'][^"']*clerk/i);
      expect(source).not.toMatch(/["']use client["']/);
    }
  });
});

describe("already signed in", () => {
  it("sends a signed-in visitor of /sign-in to their return path and never shows the form", async () => {
    authState.isSignedIn = true;
    const { container } = await renderSignIn(state("signin"), { redirect_url: "/drafts/x?tab=1" });
    expect(routerReplace).toHaveBeenCalledWith("/drafts/x?tab=1");
    expect(screenOf(container)).toBe("signing");
    expect(screen.queryByLabelText("Email address")).toBeNull();
  });

  it("falls back to the dashboard for an unsafe return path", async () => {
    authState.isSignedIn = true;
    await renderSignIn(state("signin"), { redirect_url: "https://evil.example" });
    expect(routerReplace).toHaveBeenCalledWith("/dashboard");
  });

  it("sends a signed-in visitor of /sign-up to their return path", async () => {
    authState.isSignedIn = true;
    await renderSignUp(state("signin"), { redirect_url: "/cubes" });
    expect(routerReplace).toHaveBeenCalledWith("/cubes");
  });

  it("waits for Clerk to load, and does nothing for a signed-out visitor", async () => {
    authState.isLoaded = false;
    authState.isSignedIn = true;
    await renderSignIn(state("signin"));
    expect(routerReplace).not.toHaveBeenCalled();
    cleanup();
    authState.isLoaded = true;
    authState.isSignedIn = false;
    const { container } = await renderSignIn(state("signin"));
    expect(routerReplace).not.toHaveBeenCalled();
    expect(screenOf(container)).toBe("signin");
  });

  it("does not redirect someone who signs in on the page itself", async () => {
    const actions = signInActions();
    signInFlow.mockReturnValue({ state: state("signin"), actions });
    const view = render(await SignInPage({ searchParams: Promise.resolve({}) }));
    authState.isSignedIn = true;
    signInFlow.mockReturnValue({ state: state("success"), actions });
    view.rerender(await SignInPage({ searchParams: Promise.resolve({}) }));
    expect(routerReplace).not.toHaveBeenCalled();
    expect(screenOf(view.container)).toBe("success");
  });

  it("leaves /sso-callback alone", async () => {
    authState.isSignedIn = true;
    await renderCallback(state("signing"));
    expect(routerReplace).not.toHaveBeenCalled();
  });
});
