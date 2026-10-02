// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font-class", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

const { signIn, redirect, rethrow } = vi.hoisted(() => ({
  signIn: vi.fn(),
  redirect: vi.fn((to: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT", to }); }),
  rethrow: vi.fn((e: unknown) => { if ((e as { digest?: string })?.digest === "NEXT_REDIRECT") throw e; }),
}));
vi.mock("@/lib/auth", () => ({ signIn }));
vi.mock("next/navigation", () => ({ redirect, unstable_rethrow: rethrow }));
vi.mock("next/image", () => ({
  default: ({ alt, ...props }: { alt: string }) => <img alt={alt} {...props} />,
}));

let formStatus = { pending: false };
vi.mock("react-dom", async (orig) => ({ ...(await orig<typeof import("react-dom")>()), useFormStatus: () => formStatus }));

import { AuthError } from "next-auth";
import LoginPage from "../../../app/(auth)/login/page";
import { signInWithDiscord } from "../../../app/(auth)/login/actions";
import { describeLoginError } from "../../../app/(auth)/login/login-errors";
import { LoginButton } from "../../../app/(auth)/login/login-button";

afterEach(() => { cleanup(); vi.clearAllMocks(); formStatus = { pending: false }; });

describe("login error copy", () => {
  it("reads a cancel on Discord as a non-event, not a red error", () => {
    expect(describeLoginError("OAuthCallbackError")).toMatchObject({ tone: "info", title: "Sign-in didn't finish." });
  });
  it("blames our side for Configuration and carries the code", () => {
    expect(describeLoginError("Configuration")).toMatchObject({ tone: "bad", title: "Couldn't sign you in.", code: "Configuration" });
  });
  it("keeps the server-membership messages", () => {
    expect(describeLoginError("GuildMembershipRequired")?.body).toMatch(/member of the Discord server/);
    expect(describeLoginError("GuildMembershipUnavailable")?.tone).toBe("bad");
  });
  it("gives anything else one honest line and its code", () => {
    expect(describeLoginError("AccessDenied")).toMatchObject({ title: "Sign-in didn't work.", code: "AccessDenied" });
  });
  it("shows nothing without an error", () => {
    expect(describeLoginError(undefined)).toBeNull();
  });
});

describe("LoginPage", () => {
  it("names YugiDraft, says what Discord shares, and shows the code", async () => {
    render(await LoginPage({ searchParams: Promise.resolve({ error: "Configuration" }) }));
    screen.getByRole("heading", { level: 1, name: "YugiDraft" });
    screen.getByText(/Discord shares your name, avatar and email/);
    expect(screen.getByRole("alert")).toHaveTextContent("Error: Configuration");
    screen.getByRole("button", { name: "Sign in with Discord" });
  });
  it("announces a cancel politely", async () => {
    render(await LoginPage({ searchParams: Promise.resolve({ error: "OAuthCallbackError" }) }));
    expect(screen.getByRole("status")).toHaveTextContent("Sign-in didn't finish.");
  });
});

describe("LoginButton", () => {
  it("disables and says it is working while pending", () => {
    formStatus = { pending: true };
    render(<LoginButton />);
    const button = screen.getByRole("button", { name: "Opening Discord…" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });
});

describe("signInWithDiscord", () => {
  it("signs in to the dashboard", async () => {
    signIn.mockResolvedValue(undefined);
    await signInWithDiscord();
    expect(signIn).toHaveBeenCalledWith("discord", { redirectTo: "/dashboard" });
  });
  it("rethrows Next's own redirect untouched", async () => {
    const redirectError = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT" });
    signIn.mockRejectedValue(redirectError);
    await expect(signInWithDiscord()).rejects.toBe(redirectError);
    expect(rethrow).toHaveBeenCalledWith(redirectError);
    expect(redirect).not.toHaveBeenCalled();
  });
  it("sends an AuthError to Configuration", async () => {
    signIn.mockRejectedValue(new AuthError("boom"));
    await expect(signInWithDiscord()).rejects.toMatchObject({ to: "/login?error=Configuration" });
  });
});
