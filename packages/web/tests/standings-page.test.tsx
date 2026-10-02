import { describe, expect, it, vi } from "vitest";

const { redirect, redirectError } = vi.hoisted(() => {
  const redirectError = new Error("NEXT_REDIRECT");
  return { redirectError, redirect: vi.fn((_url: string): never => { throw redirectError; }) };
});
vi.mock("next/navigation", () => ({ redirect }));

import StandingsRedirect from "../app/(app)/tournament/[slug]/standings/page";

describe("standings route", () => {
  it("redirects to the live sheet's standings section after resolving params", async () => {
    await expect(StandingsRedirect({ params: Promise.resolve({ slug: "friday-night-12" }) })).rejects.toBe(redirectError);
    expect(redirect).toHaveBeenCalledWith("/tournament/friday-night-12?tab=standings");
  });
});
