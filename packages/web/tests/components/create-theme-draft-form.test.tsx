// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateThemeDraftForm } from "../../src/components/draft/create-theme-draft-form";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

describe("CreateThemeDraftForm", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("offers player picking and random selection without host assignment", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ channels: [{ id: "channel-1", name: "drafts" }] })));
    render(<CreateThemeDraftForm />);

    await screen.findByRole("option", { name: "#drafts" });

    const selection = screen.getByLabelText(/theme selection/i);
    expect(within(selection).getByRole("option", { name: "Players pick" })).toBeInTheDocument();
    expect(within(selection).getByRole("option", { name: "Random" })).toBeInTheDocument();
    expect(within(selection).queryByRole("option", { name: /host assigned/i })).toBeNull();
    expect(selection).toHaveValue("player_pick");
  });

  it.each(["player_pick", "random"])("creates a draft using %s", async (themeSelection) => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/discord/channels") return Response.json({ channels: [] });
      if (String(input) === "/api/drafts" && init?.method === "POST") {
        return Response.json({ webSlug: "theme-night" }, { status: 201 });
      }
      return Response.json({}, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<CreateThemeDraftForm />);

    fireEvent.change(screen.getByLabelText(/draft name/i), { target: { value: "Theme Night" } });
    fireEvent.change(screen.getByLabelText(/theme selection/i), { target: { value: themeSelection } });
    fireEvent.click(screen.getByRole("button", { name: /create theme draft/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/draft/theme-night"));
    const postCall = fetchMock.mock.calls.find(([input, init]) => String(input) === "/api/drafts" && init?.method === "POST");
    expect(JSON.parse(String(postCall?.[1]?.body))).toMatchObject({
      name: "Theme Night",
      config: { mode: "theme", themeSelection },
    });
  });
});
