// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import WaitlistPage from "../app/(auth)/waitlist/page";

beforeAll(() => {
  // The shell reads matchMedia for pointer tilt; jsdom has none.
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
});
afterEach(cleanup);

// The page is an async server component: await it, then render the element it returns.
const open = async (s?: string | string[]) => render(await WaitlistPage({ searchParams: Promise.resolve({ s }) }));

describe("/waitlist page", () => {
  it.each(["form", "joined", "invited", "account", "retry", "unknown", undefined, ["joined", "form"]])("renders for ?s=%j without throwing", async s => {
    const { container } = await open(s);
    expect(container.querySelector("h1")).not.toBeNull();
  });

  it("offers Join with Discord above the email form", async () => {
    await open();
    expect(screen.getByRole("link", { name: "Join with Discord" }).getAttribute("href")).toBe("/api/auth/existing-player/start");
  });
});
