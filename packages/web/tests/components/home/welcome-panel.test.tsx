// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WelcomePanel } from "@/components/dashboard/welcome-panel";

afterEach(cleanup);

describe("WelcomePanel", () => {
  it.each([
    { command: "/event join", hint: "/event join or open one from Tournaments" },
    { command: "/draft join", hint: "/draft join or pick one from Drafts" },
    { command: "/duel", hint: "/duel with their name" },
  ])("keeps a space after the $command command", ({ command, hint }) => {
    render(<WelcomePanel />);
    expect(screen.getByText(command, { selector: "code" }).parentElement?.textContent).toBe(hint);
  });
});
