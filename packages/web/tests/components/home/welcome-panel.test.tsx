// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WelcomePanel } from "@/components/dashboard/welcome-panel";

afterEach(cleanup);

describe("WelcomePanel", () => {
  it("names no slash command or Discord and points to the in-app places", () => {
    const { container } = render(<WelcomePanel />);
    expect(container.querySelector("code")).toBeNull();
    expect(container.textContent).not.toMatch(/\/(event|draft|duel)\b|discord/i);
    expect(screen.getByText("Open one from Tournaments")).toBeTruthy();
    expect(screen.getByText("Pick one from Drafts")).toBeTruthy();
  });
});
