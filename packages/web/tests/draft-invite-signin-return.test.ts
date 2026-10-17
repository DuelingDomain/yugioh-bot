import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({
  clerkMiddleware: (handler: Function) => (request: NextRequest) => handler(state.auth, request),
  createRouteMatcher: (patterns: string[]) => (req: NextRequest) => patterns.some((p) => new RegExp(`^${p}$`).test(req.nextUrl.pathname)),
}));
import proxy from "../proxy";

beforeEach(() => {
  vi.stubEnv("E2E_AUTH", "0");
  vi.stubEnv("DUEL_FX_LAB", "0");
  state.auth.mockResolvedValue({ userId: null });
});

it("sends a signed-out invite visitor to sign in with the invite link as the return address", async () => {
  const res = await proxy(new NextRequest("https://example.com/draft/night?invite=AbC123_-x"), {} as never);
  const location = new URL(res!.headers.get("location")!);
  expect(location.pathname).toBe("/sign-in");
  expect(location.searchParams.get("redirect_url")).toBe("/draft/night?invite=AbC123_-x");
});

it("keeps the other parameters beside the invite", async () => {
  const res = await proxy(new NextRequest("https://example.com/draft/night?a=1&invite=Q"), {} as never);
  expect(new URL(res!.headers.get("location")!).searchParams.get("redirect_url")).toBe("/draft/night?a=1&invite=Q");
});

it("does not redirect a signed-in visitor on the invite address", async () => {
  state.auth.mockResolvedValue({ userId: "user_example" });
  expect((await proxy(new NextRequest("https://example.com/draft/night?invite=Q"), {} as never))?.status ?? 200).toBe(200);
});
