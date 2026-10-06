// @vitest-environment jsdom
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, check, redirect, notFound } = vi.hoisted(() => ({
  auth: vi.fn(),
  check: vi.fn(),
  redirect: vi.fn((to: string) => { throw new Error(`redirect:${to}`); }),
  notFound: vi.fn(() => { throw new Error("not-found"); }),
}));
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/discord-web-access", () => ({ checkDiscordWebAccess: check }));
vi.mock("next/navigation", () => ({ redirect, notFound }));
vi.mock("@/components/card-data/card-data-status-panel", () => ({ CardDataStatusPanel: () => <p>panel</p> }));

import CardDataStatusPage from "../app/(app)/settings/card-data/page";

beforeEach(() => {
  auth.mockReset(); check.mockReset(); redirect.mockClear(); notFound.mockClear();
  auth.mockResolvedValue({ user: { id: "u1" } });
  check.mockResolvedValue({ ok: true });
});

describe("card data status page guard", () => {
  it("sends a signed-out visitor to login before any admin check", async () => {
    auth.mockResolvedValue(null);
    await expect(CardDataStatusPage()).rejects.toThrow("redirect:/login");
    expect(check).not.toHaveBeenCalled();
  });

  it("returns not found for a member who is not an admin", async () => {
    check.mockResolvedValue({ ok: false, status: 403 });
    await expect(CardDataStatusPage()).rejects.toThrow("not-found");
    expect(check).toHaveBeenCalledWith("u1", "admin");
  });

  it("renders the page for an admin", async () => {
    const tree = await CardDataStatusPage();
    expect(JSON.stringify(tree)).toContain("Card data status");
    expect(notFound).not.toHaveBeenCalled();
  });

  it("still renders the panel when Discord cannot be asked", async () => {
    check.mockResolvedValue({ ok: false, status: 503 });
    const tree = await CardDataStatusPage();
    expect(tree).toBeTruthy();
    expect(notFound).not.toHaveBeenCalled();
  });
});
