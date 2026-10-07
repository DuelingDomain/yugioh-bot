// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountUnavailableStep } from "@/components/auth/steps/account-unavailable-step";
import { CodeStep } from "@/components/auth/steps/code-step";
import { CreateAccountStep } from "@/components/auth/steps/create-account-step";
import { IdentifierStep } from "@/components/auth/steps/identifier-step";
import { NewPasswordStep } from "@/components/auth/steps/new-password-step";
import { NotInvitedStep } from "@/components/auth/steps/not-invited-step";
import { PasswordStep } from "@/components/auth/steps/password-step";
import { SignupClosedStep } from "@/components/auth/steps/signup-closed-step";
import { SigningStep } from "@/components/auth/steps/signing-step";
import { SuccessStep } from "@/components/auth/steps/success-step";

afterEach(() => { cleanup(); vi.useRealTimers(); });

const PRIVACY = "https://duelingdomain.com/privacy";
const TERMS = "https://duelingdomain.com/terms";
const noop = () => {};

function title(name: string | RegExp) {
  return screen.getByRole("heading", { level: 1, name });
}

describe("IdentifierStep", () => {
  const base = { pending: false, onSubmit: noop, onDiscord: noop };

  it("renders the committed copy, Discord, email and the foot links", () => {
    const { container } = render(<IdentifierStep {...base} marketingUrl="https://duelingdomain.com" />);
    expect(title("Welcome back").querySelector("em")).toHaveTextContent("back");
    screen.getByText("Closed alpha");
    screen.getByText("Sign in to your drafts, decks and duels.");
    screen.getByRole("button", { name: "Continue with Discord" });
    expect(screen.getByLabelText("Email address")).toHaveAttribute("type", "email");
    screen.getByRole("button", { name: "Continue" });
    const foot = container.querySelector('[data-slot="foot"]') as HTMLElement;
    expect(within(foot).getByRole("link", { name: "Join the waitlist" })).toHaveAttribute("href", "https://duelingdomain.com/#join");
    expect(within(foot).getByRole("link", { name: "Terms" })).toHaveAttribute("href", TERMS);
    expect(within(foot).getByRole("link", { name: "Privacy" })).toHaveAttribute("href", PRIVACY);
  });

  it("submits the trimmed email and calls onDiscord", async () => {
    const onSubmit = vi.fn();
    const onDiscord = vi.fn();
    render(<IdentifierStep {...base} onSubmit={onSubmit} onDiscord={onDiscord} />);
    await userEvent.type(screen.getByLabelText("Email address"), "  sam@example.com ");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("sam@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Continue with Discord" }));
    expect(onDiscord).toHaveBeenCalledOnce();
  });

  it("disables both buttons and ignores submits while pending", async () => {
    const onSubmit = vi.fn();
    const { container } = render(<IdentifierStep {...base} pending onSubmit={onSubmit} />);
    expect(screen.getByRole("button", { name: "Continue with Discord" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(container.querySelector("form")).toHaveAttribute("aria-busy", "true");
    await userEvent.type(screen.getByLabelText("Email address"), "sam@example.com{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows a field error with aria-invalid and a bad banner as an alert", () => {
    const { container } = render(<IdentifierStep {...base} error="Enter a valid email." banner={{ tone: "bad", body: "Sign-in is having trouble.", code: "x" }} />);
    const input = screen.getByLabelText("Email address");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toBe("f-email-err");
    expect(screen.getByText("Enter a valid email.").closest("[role=alert]")).toHaveAttribute("id", "f-email-err");
    expect(screen.getByText(/Sign-in is having trouble/).closest("[role=alert]")).not.toBeNull();
    expect(container.querySelector('[data-screen="err-service"]')).not.toBeNull();
  });
});

describe("PasswordStep", () => {
  const base = { identifier: "sam@example.com", pending: false, onSubmit: noop, onForgot: noop, onBack: noop };

  it("shows the email row, a reveal toggle and forgot/change actions", async () => {
    const onBack = vi.fn();
    const onForgot = vi.fn();
    const onSubmit = vi.fn();
    render(<PasswordStep {...base} onBack={onBack} onForgot={onForgot} onSubmit={onSubmit} />);
    expect(title("Enter your password").querySelector("em")).toHaveTextContent("password");
    screen.getByText("Step 2 of 2");
    screen.getByText("sam@example.com");
    const input = screen.getByLabelText("Password");
    expect(input).toHaveAttribute("type", "password");
    const reveal = screen.getByRole("button", { name: "Show password" });
    expect(reveal).toHaveAttribute("aria-pressed", "false");
    await userEvent.type(input, "hunter22");
    await userEvent.click(reveal);
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveValue("hunter22");
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("hunter22");
    await userEvent.click(screen.getByRole("button", { name: "Forgot password?" }));
    await userEvent.click(screen.getByRole("button", { name: "Change email" }));
    expect(onForgot).toHaveBeenCalledOnce();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("marks a wrong password invalid with an alert and keeps the hint described", () => {
    render(<PasswordStep {...base} error="That password isn’t right. Check it and try again." />);
    const input = screen.getByLabelText("Password");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toBe("f-pw-err f-pw-hint");
    expect(screen.getByRole("alert")).toHaveTextContent("That password isn’t right.");
  });

  it("disables every action while pending", () => {
    render(<PasswordStep {...base} pending />);
    for (const name of ["Sign in", "Forgot password?", "Change email"]) expect(screen.getByRole("button", { name })).toBeDisabled();
  });
});

describe("CodeStep", () => {
  const base = { purpose: "signup" as const, identifier: "sam@example.com", pending: false, resendAvailableAt: null, onSubmit: noop, onResend: noop, onBack: noop };

  it("takes digits only into six cells and submits them", async () => {
    const onSubmit = vi.fn();
    const { container } = render(<CodeStep {...base} onSubmit={onSubmit} />);
    expect(title("Check your email").querySelector("em")).toHaveTextContent("email");
    screen.getByText("Verify");
    screen.getByText("sam@example.com");
    const input = screen.getByLabelText("6-digit code");
    expect(input).toHaveAttribute("autocomplete", "one-time-code");
    await userEvent.type(input, "48a2-9x1357");
    expect(input).toHaveValue("482913");
    expect(Array.from(container.querySelectorAll("[class*=cell]")).map((c) => c.textContent).join("")).toBe("482913");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("482913");
  });

  it("counts down to a resend link", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
    const at = Date.now() + 27_000;
    const onResend = vi.fn();
    const { rerender } = render(<CodeStep {...base} resendAvailableAt={at} onResend={onResend} />);
    expect(screen.getByText("0:27")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resend code" })).toBeNull();
    vi.setSystemTime(at + 1);
    rerender(<CodeStep {...base} resendAvailableAt={at - 1} onResend={onResend} />);
    screen.getByRole("button", { name: "Resend code" }).click();
    expect(onResend).toHaveBeenCalledOnce();
  });

  it("flags a bad code on the input and describes it", () => {
    render(<CodeStep {...base} error="That code isn’t right." />);
    const input = screen.getByLabelText("6-digit code");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toBe("f-code-err code-help");
    expect(screen.getByRole("alert")).toHaveTextContent("That code isn’t right.");
  });

  it("disables continue, resend and back while pending", () => {
    render(<CodeStep {...base} pending />);
    for (const name of ["Continue", "Resend code", "Use a different email"]) expect(screen.getByRole("button", { name })).toBeDisabled();
  });
});

describe("NewPasswordStep", () => {
  it("submits both values and shows per-field errors", async () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<NewPasswordStep errors={{}} pending={false} onSubmit={onSubmit} identifier="sam@example.com" />);
    expect(title("Set a new password").querySelector("em")).toHaveTextContent("password");
    screen.getByText("Reset");
    screen.getByText("sam@example.com");
    await userEvent.type(screen.getByLabelText("New password"), "correct-horse");
    await userEvent.type(screen.getByLabelText("Confirm password"), "correct-horsX");
    await userEvent.click(screen.getByRole("button", { name: "Save password" }));
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("correct-horse", "correct-horsX");
    rerender(<NewPasswordStep errors={{ confirm: "Passwords don’t match." }} pending={false} onSubmit={onSubmit} />);
    expect(screen.getByLabelText("Confirm password")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("New password")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByRole("alert")).toHaveTextContent("Passwords don’t match.");
  });

  it("disables save while pending", () => {
    render(<NewPasswordStep errors={{}} pending onSubmit={noop} />);
    expect(screen.getByRole("button", { name: "Save password" })).toBeDisabled();
  });
});

describe("CreateAccountStep", () => {
  const base = { lockedEmail: "sam@example.com", errors: {}, pending: false, onSubmit: noop, onDiscord: noop };

  it("locks the invitation email and leaves the single CAPTCHA mount to the page", () => {
    const { container } = render(<CreateAccountStep {...base} />);
    expect(title("You’re in the alpha").querySelector("em")).toHaveTextContent("alpha");
    screen.getByText("Invite accepted");
    screen.getByText("Finish your account to start drafting.");
    const email = screen.getByLabelText("Email address");
    expect(email).toHaveAttribute("readonly");
    expect(email).toHaveValue("sam@example.com");
    expect(container.querySelector("#clerk-captcha")).toBeNull();
    screen.getByRole("link", { name: "Sign in" });
  });

  it("draws the framed placeholder, carrying the one #clerk-captcha, only for the preview", () => {
    const { container } = render(<CreateAccountStep {...base} captchaPlaceholder />);
    expect(container.querySelectorAll("#clerk-captcha")).toHaveLength(1);
    screen.getByText("Bot check loads here");
  });

  it("links consent to the two constant legal URLs", () => {
    const { container } = render(<CreateAccountStep {...base} />);
    const consent = container.querySelector("label[class*=check]") as HTMLElement;
    expect(within(consent).getByRole("link", { name: "Terms" })).toHaveAttribute("href", TERMS);
    expect(within(consent).getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", PRIVACY);
  });

  it("submits username, password and consent, and sends only username and consent to Discord", async () => {
    const onSubmit = vi.fn();
    const onDiscord = vi.fn();
    render(<CreateAccountStep {...base} onSubmit={onSubmit} onDiscord={onDiscord} />);
    await userEvent.type(screen.getByLabelText("Username"), " cardshark ");
    await userEvent.type(screen.getByLabelText("Create password"), "correct-horse");
    await userEvent.click(screen.getByRole("button", { name: "Continue with Discord" }));
    expect(onDiscord).toHaveBeenCalledExactlyOnceWith({ username: "cardshark", legalAccepted: false });
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ username: "cardshark", password: "correct-horse", legalAccepted: true });
  });

  it("marks each errored field invalid and wires its alert", () => {
    render(<CreateAccountStep {...base} errors={{ username: "That username is taken. Try another.", password: "Too short.", legal: "Accept the terms and privacy policy to continue." }} />);
    const username = screen.getByLabelText("Username");
    expect(username).toHaveAttribute("aria-invalid", "true");
    expect(username.getAttribute("aria-describedby")).toBe("f-un-err");
    expect(screen.getByLabelText("Create password")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toEqual([
      "That username is taken. Try another.",
      "Too short.",
      "Accept the terms and privacy policy to continue.",
    ]);
    expect(screen.getByLabelText("Email address")).not.toHaveAttribute("aria-invalid");
  });

  it("disables both actions while pending", () => {
    render(<CreateAccountStep {...base} pending />);
    expect(screen.getByRole("button", { name: "Create account" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Continue with Discord" })).toBeDisabled();
  });

  it("asks only for username and consent when the password is optional", () => {
    render(<CreateAccountStep {...base} passwordOptional />);
    expect(screen.queryByLabelText("Create password")).toBeNull();
    expect(screen.queryByRole("button", { name: "Continue with Discord" })).toBeNull();
    screen.getByLabelText("Username");
    screen.getByRole("checkbox");
  });

  it("renders a banner above the form", () => {
    render(<CreateAccountStep {...base} banner={{ tone: "bad", body: "Sign-in is having trouble." }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Sign-in is having trouble.");
  });
});

describe("error cards", () => {
  it("NotInvitedStep shows the email, the waitlist link and a retry", async () => {
    const onRetry = vi.fn();
    render(<NotInvitedStep identifier="sam@example.com" waitlistUrl="https://duelingdomain.com/#join" onRetry={onRetry} />);
    expect(title("This email isn’t in the alpha yet").querySelector("em")).toHaveTextContent("alpha");
    screen.getByText("sam@example.com");
    expect(screen.getByRole("link", { name: "Join the waitlist" })).toHaveAttribute("href", "https://duelingdomain.com/#join");
    await userEvent.click(screen.getByRole("button", { name: "Try a different email" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("SignupClosedStep links to the waitlist and goes back to sign in", async () => {
    const onRetry = vi.fn();
    render(<SignupClosedStep waitlistUrl="https://duelingdomain.com/#join" onRetry={onRetry} />);
    expect(title("You’re not in the alpha yet").querySelector("em")).toHaveTextContent("alpha");
    expect(screen.getByRole("link", { name: "Join the waitlist" })).toHaveAttribute("href", "https://duelingdomain.com/#join");
    await userEvent.click(screen.getByRole("button", { name: "Back to sign in" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("AccountUnavailableStep has no emphasis in the title and a support link", async () => {
    const onBack = vi.fn();
    render(<AccountUnavailableStep onBack={onBack} />);
    expect(title("This account can’t sign in").querySelector("em")).toBeNull();
    expect(screen.getByRole("link", { name: "Contact support" })).toHaveAttribute("href", "mailto:support@duelingdomain.com");
    await userEvent.click(screen.getByRole("button", { name: "Back to sign in" }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});

describe("signing and success", () => {
  it("SigningStep is a polite status row with no controls", () => {
    const { container } = render(<SigningStep />);
    expect(title("Signing you in").querySelector("em")).toHaveTextContent("in");
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("Opening Dueling Domain…");
    expect(container.querySelectorAll("button, a, input")).toHaveLength(0);
  });

  it("SuccessStep is only a status region", () => {
    const { container } = render(<SuccessStep />);
    expect(title("You’re in").querySelector("em")).toHaveTextContent("in");
    screen.getByText("Signed in");
    screen.getByText("The pack is open. Loading your drafts.");
    expect(screen.getByRole("status")).toHaveTextContent("Welcome in");
    expect(container.querySelectorAll("button, a, input")).toHaveLength(0);
  });
});

describe("step modules", () => {
  it("import nothing from Clerk", () => {
    const dir = join(__dirname, "../../../src/components/auth");
    const files = [
      ...readdirSync(join(dir, "steps")).map((f) => join(dir, "steps", f)),
      join(dir, "fields.tsx"),
      join(dir, "sign-in-step.tsx"),
    ].filter((f) => /\.tsx?$/.test(f));
    expect(files.length).toBeGreaterThanOrEqual(12);
    for (const file of files) expect(readFileSync(file, "utf8"), file).not.toMatch(/@clerk/);
  });
});

describe("banners and the locked-email code step", () => {
  const banner = { tone: "bad" as const, body: "Sign-in is having trouble. Try again in a moment.", code: "network" };

  it("shows a service banner on the password, code and new password steps", () => {
    const { rerender } = render(<PasswordStep identifier="a@b.co" banner={banner} pending={false} onSubmit={noop} onForgot={noop} onBack={noop} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Sign-in is having trouble.");
    rerender(<CodeStep purpose="reset" identifier="a@b.co" banner={banner} pending={false} resendAvailableAt={null} onSubmit={noop} onResend={noop} onBack={noop} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Error: network");
    rerender(<NewPasswordStep errors={{}} banner={banner} pending={false} onSubmit={noop} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Sign-in is having trouble.");
  });

  it("hides the different-email link when the code step has no onBack", () => {
    const { rerender } = render(<CodeStep purpose="signup" identifier="a@b.co" pending={false} resendAvailableAt={null} onSubmit={noop} onResend={noop} />);
    expect(screen.queryByRole("button", { name: "Use a different email" })).toBeNull();
    rerender(<CodeStep purpose="reset" identifier="a@b.co" pending={false} resendAvailableAt={null} onSubmit={noop} onResend={noop} onBack={noop} />);
    screen.getByRole("button", { name: "Use a different email" });
  });
});
