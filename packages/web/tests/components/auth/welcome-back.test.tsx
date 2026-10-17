// @vitest-environment jsdom
import Database from "better-sqlite3";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createUserService } from "@yugidraft/shared/services";

const mock = vi.hoisted(() => ({ db: null as unknown as Database.Database, cookie: undefined as string | undefined, hardNavigate: vi.fn(), redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }) }));
vi.mock("next/font/local", () => ({ default: () => ({ variable: "font-class", className: "font-class" }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => mock.cookie ? { value: mock.cookie } : undefined }) }));
vi.mock("next/navigation", () => ({ redirect: mock.redirect }));
vi.mock("@/lib/db", () => ({ getDb: () => mock.db }));
vi.mock("@/components/auth/navigate", () => ({ hardNavigate: mock.hardNavigate }));
import WelcomeBackPage from "../../../app/(auth)/welcome-back/page";
import { sealCookie } from "../../../src/lib/existing-player";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WEB_URL", "https://app.test"); vi.stubEnv("CLERK_SECRET_KEY", "test-only-secret");
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  mock.db = new Database(":memory:"); migrate(mock.db);
  const user = createUserService(mock.db).ensureDiscord({ discordUserId: "900000000000000101", displayName: "Yugi" });
  mock.cookie = sealCookie("identity", { userId: user.id, discordId: user.discordUserId, email: "yugi@test.dev", discordUsername: "yugi" });
});
afterEach(() => { cleanup(); mock.db.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("greets the proven existing profile and requires the same legal consent without a waitlist option", async () => {
  const fetcher = vi.fn(async () => Response.json({ redirectTo: "/sign-in?existing_player=1" })); vi.stubGlobal("fetch", fetcher);
  render(await WelcomeBackPage());
  expect(screen.getByRole("heading", { name: "Welcome back, Yugi." })).toBeInTheDocument();
  expect(screen.getByText("Your Dueling Domain profile is ready.")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /waitlist/i })).toBeNull();
  expect(screen.getAllByRole("link", { name: "Terms" })[0]).toHaveAttribute("href", "https://duelingdomain.com/terms");
  expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "https://duelingdomain.com/privacy");
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Accept the terms"); expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox"));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Continue" })); });
  expect(fetcher).toHaveBeenCalledWith("/api/auth/existing-player/complete", expect.objectContaining({ method: "POST", body: JSON.stringify({ consent: true }) }));
  expect(mock.hardNavigate).toHaveBeenCalledWith("/sign-in?existing_player=1");
});
it("shows a support error without navigation or an account email", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Contact support@duelingdomain.com." }, { status: 409 })));
  render(await WelcomeBackPage()); fireEvent.click(screen.getByRole("checkbox"));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Continue" })); });
  expect(screen.getByRole("alert")).toHaveTextContent("support@duelingdomain.com");
  expect(document.body).not.toHaveTextContent("yugi@test.dev"); expect(mock.hardNavigate).not.toHaveBeenCalled();
});
it("rejects an expired/missing proof before rendering a profile", async () => {
  mock.cookie = undefined;
  await expect(WelcomeBackPage()).rejects.toThrow("redirect:/sign-in");
});
it("rechecks the Discord row rather than trusting stale cookie eligibility", async () => {
  mock.db.exec("update users set discord_user_id=null");
  await expect(WelcomeBackPage()).rejects.toThrow("redirect:/sign-in");
});
