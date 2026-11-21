import { describe, expect, it } from "vitest";
import type { RemoteActionProposal, RemoteRoom } from "@yugidraft/shared/remote";
import { createRoomMutationQueue } from "@/lib/remote/room-mutations";
import { boardWithPreviews, createPeerPreviewStore, publishPeerPreview, setPeerPreviewTransport, type PeerPreviewDiag } from "@/lib/remote/peer-preview";

const MAGICIAN = 46986414;
const room = { slug: "t", mySeat: 0, lastSeq: 1, events: [], state: { seats: [{ twin: [] }, { twin: [] }] } } as unknown as RemoteRoom;
const place = (slot: number, faceUp: boolean): RemoteActionProposal =>
  ({ type: "twin.place", actorSeat: 0, seat: 0, zone: "monster", card: { ref: `c${slot}`, cardId: MAGICIAN, name: "Dark Magician", faceUp, position: "attack", slot } }) as RemoteActionProposal;

/** My client queues a write while the server has not answered yet; every preview packet it sends goes to `wire`. */
function sender(wire: Uint8Array[]) {
  setPeerPreviewTransport(bytes => { wire.push(bytes); });
  let release: (room: RemoteRoom) => void = () => undefined;
  const pending = new Promise<RemoteRoom>(resolve => { release = resolve; });
  const keys: string[] = [];
  const queue0 = createRoomMutationQueue(() => room, async () => pending, undefined, undefined, (proposal, key) => { keys.push(key); publishPeerPreview(room, proposal, key); });
  /** Queue one write and let the queue run it up to the point where it waits for the server. */
  const queue = async (proposal: RemoteActionProposal) => { void queue0.transaction(async (_room, act) => { void act(proposal); }).catch(() => undefined); await new Promise(resolve => setTimeout(resolve, 0)); };
  return { queue, keys, release };
}

describe("peer preview", () => {
  it("shows my change at once, confirms it by key, rolls back without a confirm, hides face-down identity, ignores non-owners", async () => {
    let clock = 10_000;
    const log: PeerPreviewDiag[] = [];
    const watcher = createPeerPreviewStore({ now: () => clock, enabled: () => true, diag: d => log.push(d) });
    watcher.setMySeat(1);
    const wire: Uint8Array[] = [];
    const { queue, keys, release } = sender(wire);

    // 1. Queued, server silent: the opponent already shows the card face up, with its name, in monster zone 3.
    await queue(place(3, true));
    expect(wire).toHaveLength(1);
    expect(watcher.receive(wire[0], 0)).toBe(true);
    expect(watcher.cardsOf(0)).toMatchObject([{ zone: "monster", slot: 3, faceUp: true, cardId: MAGICIAN, name: "Dark Magician" }]);
    // The pending card replaces whatever the table held in that cell and is never a real twin.
    const board = boardWithPreviews([{ ref: "old", zone: "monster", slot: 3 }, { ref: "keep", zone: "monster", slot: 1 }], watcher.cardsOf(0));
    expect(board.base.map(card => card.ref)).toEqual(["keep"]);
    expect(board.ghosts[0].ref.startsWith("pv-")).toBe(true);
    // The server event with the same idempotency key confirms it: the preview is gone and the diag stage pairs both by key.
    clock += 120;
    watcher.confirm(keys[0], clock - 3000);
    expect(watcher.cardsOf(0)).toEqual([]);
    expect(log.map(entry => [entry.stage, entry.key])).toEqual([["previewReceived", keys[0]], ["serverEvent", keys[0]]]);

    // 2. A preview that no server event confirms rolls back by itself after about 3 s.
    wire.length = 0;
    await queue(place(4, true));
    expect(watcher.receive(wire[0], 0)).toBe(true);
    clock += 2900; watcher.sweep();
    expect(watcher.cardsOf(0)).toHaveLength(1);
    clock += 300; watcher.sweep();
    expect(watcher.cardsOf(0)).toEqual([]);
    expect(log.at(-1)?.stage).toBe("previewRolledBack");
    // A late confirm of that key does nothing, and a late duplicate of a confirmed preview is not shown again.
    watcher.confirm(keys[1]);
    expect(watcher.receive(wire[0], 0)).toBe(false);

    // 3. A face-down card: the packet carries no id, no name and no ref, so neither the opponent nor a spectator can learn it.
    wire.length = 0;
    await queue(place(2, false));
    const text = new TextDecoder().decode(wire[0]);
    expect(text).not.toContain(String(MAGICIAN));
    expect(text).not.toContain("Dark Magician");
    expect(text).not.toContain("c2");
    expect(watcher.receive(wire[0], 0)).toBe(true);
    expect(watcher.cardsOf(0)).toMatchObject([{ zone: "monster", slot: 2, faceUp: false }]);
    expect(watcher.cardsOf(0)[0]).not.toHaveProperty("cardId");

    // 4. Only the owner of a seat may preview on it: the same packet from another identity, or a forged seat in the payload, is ignored.
    const other = createPeerPreviewStore({ now: () => clock, enabled: () => true });
    expect(other.receive(wire[0], 1)).toBe(false);
    expect(other.receive(new TextEncoder().encode(JSON.stringify({ v: 1, seat: 1, seq: 1, zone: "M1", kind: "face-up", cardId: MAGICIAN })), 0)).toBe(false);
    expect(other.cardsOf(0)).toEqual([]);
    expect(other.cardsOf(1)).toEqual([]);
    // The kill switch turns the receiver off.
    expect(createPeerPreviewStore({ enabled: () => false }).receive(wire[0], 0)).toBe(false);

    release(room); setPeerPreviewTransport(() => undefined);
  });
});
