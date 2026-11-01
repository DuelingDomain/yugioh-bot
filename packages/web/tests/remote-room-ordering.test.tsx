// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { ygoModule, type RemoteRoom, type RemoteSnapshot } from "@yugidraft/shared/remote";
import { RemoteTableRoom } from "../src/components/remote/remote-workbench";

const socket = vi.hoisted(() => ({ handlers: {} as Record<string, (value: RemoteSnapshot) => void> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("socket.io-client", () => ({ io: () => ({ on: (event: string, callback: (value: RemoteSnapshot) => void) => { socket.handlers[event] = callback; }, connect: vi.fn(), emit: vi.fn(), disconnect: vi.fn() }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("keeps a newer realtime position when a delayed action response arrives", async () => {
  const initial: RemoteRoom = { slug: "solo", guildId: "g", gameId: "ygo", solo: true, seatCount: 2, createdBy: 1, status: "active", mySeat: 0,
    createdAt: 1, startedAt: 1, endedAt: null, lastEventAt: 1, lastSeq: 4, endReason: null, idleWarningAt: null, events: [],
    seats: [{ seat: 0, userId: 1, bot: false, displayName: "Owner", ready: true }, { seat: 1, userId: null, bot: true, displayName: "Test Bot 1", ready: true }],
    state: ygoModule.initialState({ seatCount: 2 }) };
  const older = structuredClone(initial); older.lastSeq = 5; older.state.phase = "standby";
  const newer = structuredClone(older); newer.lastSeq = 6; newer.state.phase = "main1";
  let resolve!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn((path: string) => path.endsWith("/actions") ? new Promise<Response>(done => { resolve = done; }) : Promise.resolve(Response.json(initial))));
  render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><RemoteTableRoom slug="solo" /></SWRConfig>);
  fireEvent.click(await screen.findByRole("button", { name: "Next phase" }));
  await waitFor(() => expect(resolve).toBeTypeOf("function"));
  await act(async () => { socket.handlers["remote:changed"]({ table: newer, state: newer.state, events: [] }); });
  await act(async () => { resolve(Response.json(older)); });
  await waitFor(() => expect(screen.getByRole("button", { name: "Next phase" })).not.toBeDisabled());
  expect(screen.getByText(/Turn 1 · Owner · Main 1/)).toBeTruthy();
});
