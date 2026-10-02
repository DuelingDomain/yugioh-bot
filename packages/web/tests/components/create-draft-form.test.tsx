// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateDraftForm } from "../../src/components/draft/create-draft-form";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

describe("CreateDraftForm", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("creates a draft from custom card ids without requiring a selected set", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/discord/channels") {
        return Response.json({ channels: [] });
      }

      if (String(input) === "/api/drafts" && init?.method === "POST") {
        return Response.json({ webSlug: "custom-pool" }, { status: 201 });
      }

      return Response.json({}, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CreateDraftForm />);

    fireEvent.change(screen.getByLabelText(/draft name/i), { target: { value: "Custom Pool Draft" } });
    fireEvent.change(screen.getByLabelText(/custom card ids/i), {
      target: { value: "46986414\n83764718, 46986414" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create draft/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/draft/custom-pool"));

    const postCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input) === "/api/drafts" && init?.method === "POST",
    );
    expect(JSON.parse(String(postCall?.[1]?.body))).toMatchObject({
      name: "Custom Pool Draft",
      config: {
        setNames: [],
        customCardIds: [46986414, 83764718, 46986414],
      },
    });
  });

  it("loads a saved pool's sets and custom IDs without touching the numeric options", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/discord/channels") {
        return Response.json({ channels: [] });
      }

      if (String(input) === "/api/cubes") {
        return Response.json({
          cubes: [
            {
              id: 1,
              name: "Goat Cube",
              setNames: ["Metal Raiders"],
              customCardIds: [46986414, 83764718],
            },
          ],
        });
      }

      return Response.json({}, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CreateDraftForm />);

    const templateSelect = await screen.findByLabelText(/saved pool/i);
    fireEvent.change(templateSelect, { target: { value: "Goat Cube" } });

    expect(screen.getByText("Metal Raiders")).toBeInTheDocument();
    expect(screen.getByLabelText(/custom card ids/i)).toHaveValue("46986414\n83764718");
    // Numeric options should remain at their defaults, NOT overwritten by the pool
    expect(screen.getByLabelText(/cards drafted per player/i)).toHaveValue(40);
    expect(screen.getByLabelText(/size of each pack/i)).toHaveValue(15);
    expect(screen.getByLabelText(/pick duration/i)).toHaveValue(45);
    expect(screen.queryByLabelText(/alternate pass/i)).toBeNull();
    expect(screen.queryByLabelText(/randomize seats/i)).toBeNull();
  });

  it("submits cardsPerPlayer, packSize, derived packsPerPlayer, and randomized seats", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/discord/channels") return Response.json({ channels: [] });
      if (String(input) === "/api/cubes" && !init) return Response.json({ cubes: [] });
      if (String(input) === "/api/drafts" && init?.method === "POST") {
        return Response.json({ webSlug: "cube" }, { status: 201 });
      }
      return Response.json({}, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CreateDraftForm />);

    fireEvent.change(screen.getByLabelText(/draft name/i), { target: { value: "Cube" } });
    fireEvent.change(screen.getByLabelText(/custom card ids/i), { target: { value: "46986414" } });
    fireEvent.change(screen.getByLabelText(/cards drafted per player/i), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText(/size of each pack/i), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: /create draft/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/draft/cube"));

    const postCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input) === "/api/drafts" && init?.method === "POST",
    );
    const body = JSON.parse(String(postCall?.[1]?.body));
    expect(body.config).toMatchObject({
      cardsPerPlayer: 40,
      packSize: 15,
      packsPerPlayer: 3,
      randomizeSeats: true,
      alternatePassDirection: true,
    });
  });

  it("rejects a pack size larger than cards per player", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/discord/channels") return Response.json({ channels: [] });
      return Response.json({}, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CreateDraftForm />);

    fireEvent.change(screen.getByLabelText(/draft name/i), { target: { value: "Cube" } });
    fireEvent.change(screen.getByLabelText(/custom card ids/i), { target: { value: "46986414" } });
    fireEvent.change(screen.getByLabelText(/size of each pack/i), { target: { value: "99" } });
    fireEvent.click(screen.getByRole("button", { name: /create draft/i }));

    expect(await screen.findByText(/pack size cannot exceed/i)).toBeInTheDocument();
  });

  it("saves the current pool as a reusable template", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/discord/channels") {
        return Response.json({ channels: [] });
      }

      if (String(input) === "/api/cubes" && !init) {
        return Response.json({ cubes: [] });
      }

      if (String(input) === "/api/cubes" && init?.method === "POST") {
        return Response.json({ cube: { id: 1, name: "Goat Cube", config: { setNames: [], customCardIds: [46986414, 83764718] } } }, { status: 201 });
      }

      return Response.json({}, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CreateDraftForm />);

    fireEvent.change(await screen.findByLabelText(/save this pool as/i), { target: { value: "Goat Cube" } });
    fireEvent.change(screen.getByLabelText(/custom card ids/i), { target: { value: "46986414\n83764718" } });
    fireEvent.click(screen.getByRole("button", { name: /save pool/i }));

    await waitFor(() => expect(screen.getByText(/saved goat cube/i)).toBeInTheDocument());

    const postCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input) === "/api/cubes" && init?.method === "POST",
    );
    const body = JSON.parse(String(postCall?.[1]?.body));
    expect(body).toMatchObject({
      name: "Goat Cube",
      config: {
        setNames: [],
        customCardIds: [46986414, 83764718],
      },
    });
    expect(body.config).not.toHaveProperty("packSize");
    expect(body.config).not.toHaveProperty("packsPerPlayer");
    expect(body.config).not.toHaveProperty("pickSeconds");
  });

  it("keeps the summary in step with the fields and explains the pack sentence", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/discord/channels") return Response.json({ channels: [] });
      if (String(input) === "/api/cubes") return Response.json({ cubes: [] });
      return Response.json({}, { status: 404 });
    }));
    render(<CreateDraftForm />);

    const summary = screen.getByRole("complementary", { name: /draft summary/i });
    expect(screen.getByLabelText(/draft name/i)).toHaveAttribute("placeholder", "Friday cube night");
    expect(screen.getByLabelText(/draft name/i).closest(".mk-secs")?.className).toMatch(/sections/);
    expect(screen.getByRole("list", { name: "What happens next" }).className).toMatch(/next_/);
    expect(screen.getByText("/draft join")).toHaveClass("cmd");
    expect(summary).toHaveTextContent("Nothing yet");
    expect(summary).toHaveTextContent("Shuffled at the start");
    expect(summary).toHaveTextContent(/3 of 15/);
    expect(summary).toHaveTextContent(/45 s/);
    expect(screen.getByText(/the last 5 cards of pack 3 aren't picked/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/draft name/i), { target: { value: "Goat cube" } });
    fireEvent.change(screen.getByLabelText(/custom card ids/i), { target: { value: "46986414\n83764718" } });
    fireEvent.change(screen.getByLabelText(/cards drafted per player/i), { target: { value: "45" } });
    expect(summary).toHaveTextContent("Goat cube");
    expect(summary).toHaveTextContent("2 passcodes");
    expect(summary).toHaveTextContent(/45 cards/);
    expect(screen.queryByText(/aren't picked/i)).toBeNull();
    expect(screen.getByText(/2 cards\./)).toBeInTheDocument();
  });

  it("shows the name problem at the top of the form and creates nothing", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input) === "/api/discord/channels") return Response.json({ channels: [] });
      return Response.json({}, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<CreateDraftForm />);

    fireEvent.click(screen.getByRole("button", { name: /create draft/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Draft name is required");
    expect(screen.getByLabelText(/draft name/i)).toHaveAttribute("aria-invalid", "true");

    fireEvent.change(screen.getByLabelText(/draft name/i), { target: { value: "Cube" } });
    fireEvent.click(screen.getByRole("button", { name: /create draft/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Select at least one set or paste custom card IDs");
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toBe(false);
  });

  it("says what a loaded saved pool holds and offers named controls for the set list", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/discord/channels") return Response.json({ channels: [] });
      if (String(input) === "/api/cubes") {
        return Response.json({ cubes: [{ id: 1, name: "Goat", setNames: ["Metal Raiders"], customCardIds: [46986414, 83764718] }] });
      }
      return Response.json({}, { status: 404 });
    }));
    render(<CreateDraftForm />);

    fireEvent.change(await screen.findByLabelText(/saved pool/i), { target: { value: "Goat" } });
    expect(screen.getByText(/loaded goat: 1 set, 2 passcodes/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Metal Raiders" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh the set list" })).toBeInTheDocument();
    expect(screen.getByLabelText("Sets")).toBeInTheDocument();
  });
});
