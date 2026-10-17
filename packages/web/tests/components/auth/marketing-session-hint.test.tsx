// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://app.duelingdomain.com/"}
import { cleanup, render } from "@testing-library/react";
import type { CookieJar } from "tough-cookie";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ isLoaded: true, isSignedIn: false }));
const environment = globalThis as typeof globalThis & {
  jsdom: { cookieJar: CookieJar; reconfigure(options: { url: string }): void };
};
vi.mock("@clerk/nextjs", () => ({ useAuth: () => auth }));
import { MarketingSessionHint } from "@/components/auth/marketing-session-hint";

beforeEach(() => {
  environment.jsdom.reconfigure({ url: "https://app.duelingdomain.com/" });
  auth.isLoaded = true;
  auth.isSignedIn = false;
  document.cookie = "dd_signed_in=; Domain=duelingdomain.com; Path=/; Max-Age=0";
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("shares a signed-in hint with the marketing apex without sharing credentials", () => {
  auth.isSignedIn = true;
  render(<MarketingSessionHint />);
  expect(document.cookie).toContain("dd_signed_in=1");

  const jar = environment.jsdom.cookieJar;
  expect(jar.getCookieStringSync("https://duelingdomain.com/")).toBe("dd_signed_in=1");
  expect(jar.getCookieStringSync("https://other.example/")).toBe("");
  const cookie = jar.getCookiesSync("https://duelingdomain.com/")[0];
  expect(cookie.secure).toBe(true);
  expect(cookie.httpOnly).toBe(false);
  expect(cookie.sameSite).toBe("lax");
  expect(cookie.maxAge).toBe(2592000);
});

it("clears the shared hint as soon as Clerk reports sign-out", () => {
  auth.isSignedIn = true;
  const view = render(<MarketingSessionHint />);
  expect(document.cookie).toContain("dd_signed_in=1");
  auth.isSignedIn = false;
  view.rerender(<MarketingSessionHint />);
  expect(document.cookie).not.toContain("dd_signed_in");
});

it("preserves the existing hint until Clerk finishes loading", () => {
  document.cookie = "dd_signed_in=1; Domain=duelingdomain.com; Path=/; Secure";
  auth.isLoaded = false;
  render(<MarketingSessionHint />);
  expect(document.cookie).toContain("dd_signed_in=1");
});

it.each(["https://staging.duelingdomain.com/", "http://localhost:3000/", "http://app.duelingdomain.com/"])("does not write a production hint from %s", (url) => {
  environment.jsdom.reconfigure({ url });
  const writes = vi.spyOn(document, "cookie", "set");
  auth.isSignedIn = true;
  render(<MarketingSessionHint />);
  expect(writes).not.toHaveBeenCalled();
});
