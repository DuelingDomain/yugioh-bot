// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { resolve, redirect, notFound } = vi.hoisted(() => ({
  resolve: vi.fn(),
  redirect: vi.fn((to: string) => { throw new Error(`redirect:${to}`); }),
  notFound: vi.fn(() => { throw new Error("not-found"); }),
}));
vi.mock("@/lib/session-identity", () => ({ resolveSessionIdentity: resolve }));
vi.mock("next/navigation", () => ({ redirect, notFound }));
vi.mock("@/components/card-data/card-data-status-panel", () => ({ CardDataStatusPanel: () => <p>panel</p> }));

import CardDataStatusPage from "../app/(app)/settings/card-data/page";

const signedIn = (userId: number) => ({ ok: true, identity: { userId, clerkUserId: null, name: "U", email: null, image: null, discordUserId: null, conflict: null } });

beforeEach(() => {
  resolve.mockReset(); redirect.mockClear(); notFound.mockClear();
  resolve.mockResolvedValue(signedIn(7));
  vi.stubEnv("OWNER_USER_IDS", "7");
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("card data status page guard", () => {
  it("sends a signed-out visitor to sign-in", async () => {
    resolve.mockResolvedValue({ ok: false, status: 401 });
    await expect(CardDataStatusPage()).rejects.toThrow("redirect:/sign-in");
  });

  it("returns not found for a user not in OWNER_USER_IDS", async () => {
    resolve.mockResolvedValue(signedIn(8));
    await expect(CardDataStatusPage()).rejects.toThrow("not-found");
  });

  it("renders the page for an owner", async () => {
    const tree = await CardDataStatusPage();
    expect(JSON.stringify(tree)).toContain("Card data status");
    expect(notFound).not.toHaveBeenCalled();
  });

  it("still renders the panel when the session can't be read", async () => {
    resolve.mockResolvedValue({ ok: false, status: 503 });
    const tree = await CardDataStatusPage();
    expect(tree).toBeTruthy();
    expect(notFound).not.toHaveBeenCalled();
  });
});
