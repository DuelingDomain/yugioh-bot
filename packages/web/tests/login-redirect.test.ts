import { expect, it, vi } from "vitest";
const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect }));
import Login from "../app/(auth)/login/page";
it("preserves a local callback path and query", async () => { await Login({ searchParams: Promise.resolve({ callbackUrl: "/drafts?a=1" }) }); expect(redirect).toHaveBeenLastCalledWith("/sign-in?redirect_url=%2Fdrafts%3Fa%3D1"); });
it.each([undefined, ["/drafts"], "https://evil.example", "//evil.example", "/\\evil.example", "/%2fevil.example", "/%5cevil.example", "/%00evil", "/bad%", "/.//evil.example", "/%2e//evil.example", "/\tevil"])("rejects unsafe callback %s", async callbackUrl => { await Login({ searchParams: Promise.resolve({ callbackUrl }) }); expect(redirect).toHaveBeenLastCalledWith("/sign-in?redirect_url=%2Fdashboard"); });
