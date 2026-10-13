// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ createDuel: vi.fn(), getHostedWaitingTable: vi.fn(), cancelWaitingDuel: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: api.push }) }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/components/duel/api", async original => ({ ...await original<object>(), ...api }));
import { DuelCreator } from "@/components/duel/creator";
beforeEach(() => {
  vi.clearAllMocks();
  api.getHostedWaitingTable.mockResolvedValue({ table: { slug: "old", name: "My waiting table" } });
  api.cancelWaitingDuel.mockResolvedValue({});
});
afterEach(cleanup);

it("shows the existing table, the replacement notice, and a Cancel button", async () => {
  render(<DuelCreator />);
  expect(await screen.findByText(/You already have an open table:/)).toHaveTextContent("Creating a new game will close it.");
  expect(screen.getByRole("link", { name: "My waiting table" })).toHaveAttribute("href", "/duels/old");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(api.cancelWaitingDuel).toHaveBeenCalledWith("old"));
  await waitFor(() => expect(screen.queryByText(/You already have an open table:/)).toBeNull());
});

it("refreshes the notice when browser Back restores the creator", async () => {
  api.getHostedWaitingTable.mockResolvedValueOnce({ table: null });
  render(<DuelCreator />);
  await waitFor(() => expect(api.getHostedWaitingTable).toHaveBeenCalledTimes(1));
  fireEvent(window, new Event("pageshow"));
  expect(await screen.findByRole("link", { name: "My waiting table" })).toBeInTheDocument();
});

it("links a protected table and explains why it cannot be replaced", async () => {
  api.getHostedWaitingTable.mockResolvedValue({ table: { slug: "old", name: "My waiting table", canReplace: false } });
  render(<DuelCreator />);
  expect(await screen.findByRole("link", { name: "My waiting table" })).toHaveAttribute("href", "/duels/old");
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(screen.getByText(/Another player has joined or the game has started/)).toBeInTheDocument();
});

it("disables the button, blocks double submit, and keeps the request key for a network retry", async () => {
  let reject!: (cause: Error) => void;
  api.createDuel.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  const { container } = render(<DuelCreator />);
  await screen.findByRole("link", { name: "My waiting table" });
  fireEvent.submit(container.querySelector("form")!);
  fireEvent.submit(container.querySelector("form")!);
  expect(screen.getByRole("button", { name: "Creating game…" })).toBeDisabled();
  expect(api.createDuel).toHaveBeenCalledTimes(1);
  const key = api.createDuel.mock.calls[0][4].requestKey;
  expect(key).toEqual(expect.any(String));
  await act(async () => reject(new Error("Network failed")));
  api.createDuel.mockResolvedValueOnce({ session: { slug: "new" }, shareUrl: "https://app.example/duels/new" });
  fireEvent.click(screen.getByRole("button", { name: /Create game/ }));
  await waitFor(() => expect(api.push).toHaveBeenCalledWith("/duels/new"));
  expect(api.createDuel.mock.calls[1][4].requestKey).toBe(key);
});

it("allows a new request after browser Back returns from the created room", async () => {
  window.history.replaceState(null, "", "/duels/new");
  api.createDuel.mockResolvedValue({ session: { slug: "new" }, shareUrl: "https://app.example/duels/new" });
  render(<DuelCreator />);
  fireEvent.click(screen.getByRole("button", { name: /Create game/ }));
  await waitFor(() => expect(api.push).toHaveBeenCalledWith("/duels/new"));
  const firstKey = api.createDuel.mock.calls[0][4].requestKey;
  fireEvent(window, new PopStateEvent("popstate"));
  const button = screen.getByRole("button", { name: /Create game/ });
  expect(button).toBeEnabled();
  fireEvent.click(button);
  await waitFor(() => expect(api.createDuel).toHaveBeenCalledTimes(2));
  expect(api.createDuel.mock.calls[1][4].requestKey).not.toBe(firstKey);
});
