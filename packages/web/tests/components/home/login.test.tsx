// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/local", () => ({
  default: ({ variable }: { variable: string }) => ({ variable, className: "font-class" }),
}));

const { signIn, redirect, rethrow } = vi.hoisted(() => ({
  signIn: vi.fn(),
  redirect: vi.fn((to: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT", to }); }),
  rethrow: vi.fn((e: unknown) => { if ((e as { digest?: string })?.digest === "NEXT_REDIRECT") throw e; }),
}));
vi.mock("@/lib/auth", () => ({ signIn }));
vi.mock("next/navigation", () => ({ redirect, unstable_rethrow: rethrow }));

let formStatus = { pending: false };
vi.mock("react-dom", async (orig) => ({ ...(await orig<typeof import("react-dom")>()), useFormStatus: () => formStatus }));

import { AuthError } from "next-auth";
import LoginPage, { metadata } from "../../../app/(auth)/login/page";
import { signInWithDiscord } from "../../../app/(auth)/login/actions";
import { describeLoginError } from "../../../app/(auth)/login/login-errors";
import { LoginButton } from "../../../app/(auth)/login/login-button";

beforeEach(() => {
  vi.stubEnv("MARKETING_URL", "");
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  formStatus = { pending: false };
});

async function renderPage(error?: string) {
  return render(await LoginPage({ searchParams: Promise.resolve({ error }) }));
}

const banners = [
  {
    error: "OAuthCallbackError", tone: "info", role: "status",
    copy: "Sign-in didn’t finish. If you pressed Cancel on Discord, that’s all this is. Try again when you’re ready.",
  },
  {
    error: "Configuration", tone: "bad", role: "alert",
    copy: "Couldn’t sign you in. The problem is on our side, not your Discord account. Try again in a minute.",
  },
  {
    error: "GuildMembershipUnavailable", tone: "bad", role: "alert",
    copy: "Couldn’t check your access just now. Try again in a minute.",
  },
];

describe("LoginPage", () => {
  it("renders the Discord-only step with the mock's title, fine print, and skip link", async () => {
    const { container } = await renderPage();
    const title = screen.getByRole("heading", { level: 1, name: "Welcome back" });
    expect(title.querySelector("em")).toHaveTextContent("back");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(container.querySelector('[data-slot="eyebrow"]')).toHaveTextContent("Closed alpha");
    screen.getByText("Sign in to your drafts, decks and duels.");
    const button = screen.getByRole("button", { name: "Continue with Discord" });
    expect(button).toHaveAttribute("type", "submit");
    expect(button).not.toBeDisabled();
    expect(button.className).toContain("btn-alt");
    expect(button.className).not.toContain("btn-primary");
    expect(button).toHaveAttribute("aria-describedby", "fine-discord");
    expect(button).toHaveAccessibleDescription("Discord shares your name, avatar and email. We can’t read or send messages as you.");
    expect(button.closest("form")).toContainElement(document.getElementById("fine-discord"));
    expect(container.querySelectorAll("input")).toHaveLength(0);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("link", { name: "Skip to the sign-in form" })).toHaveAttribute("href", "#form-zone");
    expect(document.getElementById("form-zone")).toHaveAttribute("tabindex", "-1");
    expect(metadata).toMatchObject({ title: "Sign in | Dueling Domain", description: "Sign in to your drafts, decks and duels." });
  });

  it.each(banners)("maps $error to a $tone banner", async ({ error, tone, role, copy }) => {
    const { container } = await renderPage(error);
    const banner = screen.getByRole(role);
    expect(banner).toHaveAttribute("data-tone", tone);
    expect(banner).toHaveTextContent(copy);
    if (error === "Configuration") expect(banner).toHaveTextContent("Error: Configuration");
    else expect(banner).not.toHaveTextContent("Error:");
    if (tone === "info") expect(screen.queryByRole("alert")).toBeNull();
    screen.getByRole("heading", { level: 1, name: "Welcome back" });
    screen.getByRole("button", { name: "Continue with Discord" });
    expect(container.querySelector('[data-screen="err-service"]')).toContainElement(banner);
  });

  it("maps GuildMembershipRequired to the full access panel with neutral emphasis", async () => {
    vi.stubEnv("MARKETING_URL", "https://marketing.example");
    const { container } = await renderPage("GuildMembershipRequired");
    const title = screen.getByRole("heading", { level: 1, name: "Not in the alpha yet" });
    expect(title.querySelector("em")).toHaveTextContent(/^alpha$/);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(container.querySelector('[data-screen="err-invite"]')).toContainElement(title);
    screen.getByText("Access opens in waves, and this Discord account isn’t in one yet. Join the waitlist and we’ll email you when it’s your turn.");
    const waitlist = screen.getByRole("link", { name: "Join the waitlist" });
    expect(waitlist).toHaveAttribute("href", "https://marketing.example/#join");
    expect(waitlist.className).toContain("btn-primary");
    expect(screen.getByRole("link", { name: "Try a different account" })).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("button", { name: /Discord/ })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the retry and diagnostic code for unknown errors", async () => {
    await renderPage("AccessDenied");
    expect(screen.getByRole("alert")).toHaveTextContent("Sign-in didn’t work. Try again when you’re ready.");
    expect(screen.getByRole("alert")).toHaveTextContent("Error: AccessDenied");
    screen.getByRole("button", { name: "Continue with Discord" });
  });

  it.each(["https://marketing.example", "https://marketing.example/"])("uses MARKETING_URL %s for all external links", async (url) => {
    vi.stubEnv("MARKETING_URL", url);
    await renderPage();
    expect(screen.getByRole("link", { name: "Dueling Domain, home" })).toHaveAttribute("href", "https://marketing.example");
    expect(screen.getByRole("link", { name: "Back to site" })).toHaveAttribute("href", "https://marketing.example");
    expect(screen.getByRole("link", { name: "Join the waitlist" })).toHaveAttribute("href", "https://marketing.example/#join");
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "https://marketing.example/privacy");
  });

  it.each([undefined, "GuildMembershipRequired"])("omits external links when MARKETING_URL is unset (%s)", async (error) => {
    vi.stubEnv("MARKETING_URL", undefined);
    const { container } = await renderPage(error);
    expect(screen.getByRole("img", { name: "Dueling Domain" }).closest("a")).toBeNull();
    expect(screen.queryByRole("link", { name: "Dueling Domain, home" })).toBeNull();
    for (const name of ["Back to site", "Join the waitlist", "Privacy"]) expect(screen.queryByRole("link", { name })).toBeNull();
    expect(container.querySelectorAll('a[href^="http"]')).toHaveLength(0);
    if (error) {
      screen.getByText("Access opens in waves, and this Discord account isn’t in one yet.");
      expect(screen.queryByText(/Join the waitlist/)).toBeNull();
      expect(screen.getByRole("link", { name: "Try a different account" })).toHaveAttribute("href", "/login");
    }
  });

  it.each([undefined, ...banners.map(({ error }) => error), "GuildMembershipRequired", "AccessDenied"])("contains no retired or prohibited vocabulary (%s)", async (error) => {
    const { container } = await renderPage(error);
    // Encoded to keep the prohibited vocabulary out of source text too.
    const prohibited = JSON.parse(atob("WyJ5dS1naS1vaCIsICJrb25hbWkiLCAia2luZ2RvbSIsICJkdWVsIG1vbnN0ZXJzIiwgImNyb3duIiwgImNhc3RsZSIsICJweXJhbWlkIiwgIm1pbGxlbm5pdW0iLCAieXVnaWRyYWZ0IiwgInRoZSBib3QiXQ==")) as string[];
    const output = `${container.innerHTML} ${JSON.stringify(metadata)}`.toLowerCase();
    for (const word of prohibited) expect(output).not.toContain(word);
  });
});

describe("LoginButton", () => {
  it("disables and says it is working while pending", () => {
    formStatus = { pending: true };
    render(<LoginButton />);
    const button = screen.getByRole("button", { name: "Opening Discord…" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("aria-describedby", "fine-discord");
  });
});

describe("describeLoginError", () => {
  it("shows nothing without an error", () => {
    expect(describeLoginError(undefined)).toBeNull();
    expect(describeLoginError("")).toBeNull();
  });

  it("returns the access message and optional waitlist note without a marketing URL", () => {
    expect(describeLoginError("GuildMembershipRequired")).toMatchObject({
      body: "Access opens in waves, and this Discord account isn’t in one yet.",
      waitlistNote: "Join the waitlist and we’ll email you when it’s your turn.",
    });
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
