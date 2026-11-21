import { describe, expect, it, vi } from "vitest";
import type { RemoteActionProposal, RemoteRoom } from "@yugidraft/shared/remote";
import { correctionsFor } from "@/lib/remote/manual-corrections";
import { noteWriteLost, OUTAGE_BACKOFF_MS } from "@/lib/remote/outage";
import { createRoomMutationQueue } from "@/lib/remote/room-mutations";
import { boardWithPreviews, createPeerPreviewStore, previewDrafts, publishPeerPreview, releasePeerPreviewTransport, setPeerPreviewCardFacts, setPeerPreviewTransport, type PeerPreviewDiag } from "@/lib/remote/peer-preview";

const MAGICIAN = 46986414;
const FIELD_SPELL = 1234;
setPeerPreviewCardFacts(code => code === MAGICIAN ? { type: "Normal Monster" } : code === FIELD_SPELL ? { type: "Spell Card", race: "Field" } : undefined);

const room = { slug: "t", seats: [], mySeat: 0, lastSeq: 1, events: [], state: { seats: [{ seat: 0, twin: [] }, { seat: 1, twin: [] }] } } as unknown as RemoteRoom;
const place = (slot: number, faceUp: boolean): Extract<RemoteActionProposal, { type: "twin.place" }> =>
  ({ type: "twin.place", actorSeat: 0, seat: 0, zone: "monster", card: { ref: `c${slot}`, cardId: MAGICIAN, name: "Dark Magician", faceUp, position: "attack", slot } }) as Extract<RemoteActionProposal, { type: "twin.place" }>;
const packet = (seq: number, key?: string, zone = "M1", seat = 0) => new TextEncoder().encode(JSON.stringify({
  v: 1, seat, seq, zone, kind: "face-up", cardId: MAGICIAN, key,
}));
const event = (seq: number, action: RemoteActionProposal, idempotencyKey: string) =>
  ({ seq, action: { ...action, idempotencyKey } }) as RemoteRoom["events"][number];
const withTwin = (twin: RemoteRoom["state"]["seats"][number]["twin"]): RemoteRoom => ({
  ...room, state: { ...room.state, seats: [{ ...room.state.seats[0], twin }, room.state.seats[1]] },
});

/** Every preview goes to `wire`. Leave each POST pending until the test releases it. */
function sender(wire: Uint8Array[]) {
  const send = (bytes: Uint8Array) => { wire.push(bytes); };
  setPeerPreviewTransport(send);
  let release: (() => void) | undefined;
  let write: Promise<RemoteRoom | null> | undefined;
  const keys: string[] = [];
  const post = () => new Promise<RemoteRoom>(resolve => { release = () => resolve(room); });
  const mutations = createRoomMutationQueue(() => room, post, undefined, undefined, (proposal, key) => {
    keys.push(key);
    publishPeerPreview(room, proposal, key);
  });
  const queue = async (proposal: RemoteActionProposal) => {
    write = mutations.transaction((_room, act) => act(proposal));
    await new Promise(resolve => setTimeout(resolve, 0));
  };
  const finish = async () => { release?.(); await write; };
  const dispose = () => { release?.(); releasePeerPreviewTransport(send); };
  return { queue, keys, finish, dispose };
}

describe("peer preview", () => {
  it("shows my change at once, confirms it by key, rolls back without a confirm, hides face-down identity, ignores non-owners", async () => {
    let clock = 10_000;
    const log: PeerPreviewDiag[] = [];
    const watcher = createPeerPreviewStore({ now: () => clock, enabled: () => true, diag: d => log.push(d) });
    watcher.setMySeat(1);
    const wire: Uint8Array[] = [];
    const { queue, keys, finish, dispose } = sender(wire);

    // 1. The POST is pending: the opponent already shows the face-up card in monster zone 3, with its public identity and no card back flip.
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
    watcher.confirmRoom({ ...room, lastSeq: 2, events: [{ ...event(2, place(3, true), keys[0]), at: clock - 3000 }] });
    expect(watcher.cardsOf(0)).toEqual([]);
    expect(log.map(entry => [entry.stage, entry.key])).toEqual([["previewReceived", keys[0]], ["serverEvent", keys[0]]]);
    await finish();

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
    watcher.confirmRoom({ ...room, lastSeq: 3, events: [event(3, place(4, true), keys[1])] });
    expect(watcher.receive(wire[0], 0)).toBe(false);
    await finish();

    // 3. A face-down card: the packet carries no id, no name and no ref, so neither the opponent nor a spectator can learn it.
    wire.length = 0;
    await queue(place(2, false));
    const sentDown = JSON.parse(new TextDecoder().decode(wire[0]));
    expect(sentDown).toMatchObject({ kind: "face-down", zone: "M2" });
    for (const field of ["ref", "cardId", "name"]) expect(sentDown).not.toHaveProperty(field);
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

    watcher.clear();
    dispose();
  });

  it("sends the identity of a face-up card on the field and nothing for a face-down or unknown one", () => {
    const up = { ref: "up", zone: "monster", slot: 1, faceUp: true, position: "attack", cardId: MAGICIAN, name: "Dark Magician" } as const;
    const set = { ref: "set", zone: "monster", slot: 2, faceUp: false, position: "defense", cardId: MAGICIAN, name: "Dark Magician" } as const;
    const held = withTwin([up, set]);
    const face = { cardId: MAGICIAN, name: "Dark Magician" };
    const draft = (proposal: RemoteActionProposal) => previewDrafts(held, proposal);
    // A face-up placement and a position change of a face-up card keep their identity, sideways when in Defense.
    expect(draft(place(3, true))).toEqual([{ zone: "M3", kind: "face-up", face }]);
    expect(draft({ ...place(3, true), card: { ...place(3, true).card, position: "defense" } } as RemoteActionProposal)).toEqual([{ zone: "M3", kind: "sideways-up", face }]);
    expect(draft({ type: "twin.move", actorSeat: 0, seat: 0, cardRef: "up", zone: "monster", position: "defense" })).toEqual([{ zone: "M1", kind: "sideways-up", face }]);
    // The camera saw a flip: the face is public.
    expect(draft({ type: "twin.flip", actorSeat: 0, seat: 0, cardRef: "set", faceUp: true, source: "auto" })).toEqual([{ zone: "M2", kind: "sideways-up", face }]);
    // Face down: no identity, whatever the sender knows. A hand click that reveals a hidden card stays anonymous too.
    expect(draft(place(3, false))).toEqual([{ zone: "M3", kind: "face-down" }]);
    expect(draft({ type: "twin.flip", actorSeat: 0, seat: 0, cardRef: "up", faceUp: false })).toEqual([{ zone: "M1", kind: "face-down" }]);
    expect(draft({ type: "twin.flip", actorSeat: 0, seat: 0, cardRef: "set", faceUp: true })).toEqual([{ zone: "M2", kind: "sideways-down" }]);
    expect(draft({ type: "twin.move", actorSeat: 0, seat: 0, cardRef: "set", zone: "monster", slot: 4 })).toEqual([{ zone: "M4", kind: "sideways-down" }, { zone: "M2", kind: "empty" }]);
    // A face that is not known to be up is anonymous, and a card that does not land on the field has no preview at all.
    const unknown = { ...place(3, true), card: { ...place(3, true).card, faceUp: undefined } } as unknown as RemoteActionProposal;
    expect(draft(unknown)).toEqual([{ zone: "M3", kind: "face-down" }]);
    expect(draft({ type: "twin.move", actorSeat: 0, seat: 0, cardRef: "up", zone: "graveyard" })).toEqual([]);
    // A packet for a face-down kind never carries identity even if a sender put one there (the receiver strips it).
    const watcher = createPeerPreviewStore();
    try {
      const forged = new TextEncoder().encode(JSON.stringify({ v: 1, seat: 0, seq: 1, zone: "M1", kind: "face-down", cardId: MAGICIAN, name: "Dark Magician", key: "k" }));
      expect(watcher.receive(forged, 0)).toBe(true);
      expect(watcher.cardsOf(0)[0]).toMatchObject({ faceUp: false });
      expect(watcher.cardsOf(0)[0]).not.toHaveProperty("cardId");
      expect(watcher.cardsOf(0)[0]).not.toHaveProperty("name");
    } finally { watcher.clear(); }
  });

  it("sends the previews of a burst of writes before any post finishes", async () => {
    const wire: Uint8Array[] = [];
    const send = (bytes: Uint8Array) => { wire.push(bytes); };
    setPeerPreviewTransport(send);
    const releases: (() => void)[] = [];
    const post = vi.fn(() => new Promise<RemoteRoom>(resolve => { releases.push(() => resolve(room)); }));
    const queue = createRoomMutationQueue(() => room, post, undefined, undefined, (proposal, key) => { publishPeerPreview(room, proposal, key); });
    try {
      const done = queue.transaction(async (_room, act) => { await Promise.all([1, 2, 3].map(slot => act(place(slot, true)))); });
      await new Promise(resolve => setTimeout(resolve, 0));
      // The gate has started post 1 only, yet all three previews are out, one per cell, each with its own key.
      expect(post).toHaveBeenCalledTimes(1);
      expect(wire).toHaveLength(3);
      const sent = wire.map(bytes => JSON.parse(new TextDecoder().decode(bytes)));
      expect(sent.map(item => item.zone)).toEqual(["M1", "M2", "M3"]);
      expect(new Set(sent.map(item => item.key)).size).toBe(3);
      for (let i = 0; i < 3; i++) { await vi.waitFor(() => expect(releases.length).toBeGreaterThan(i)); releases[i](); }
      await done;
      expect(wire).toHaveLength(3);
    } finally { releasePeerPreviewTransport(send); }
  });

  it("ignores packets without an action key", () => {
    const watcher = createPeerPreviewStore();
    try {
      expect(watcher.receive(packet(1), 0)).toBe(false);
      expect(watcher.snapshot()).toEqual([]);
    } finally { watcher.clear(); }
  });

  it("expires a cell from its first unconfirmed packet despite higher sequences and new keys", () => {
    let clock = 1000;
    const watcher = createPeerPreviewStore({ now: () => clock });
    try {
      expect(watcher.receive(packet(1, "first"), 0)).toBe(true);
      clock += 2999;
      expect(watcher.receive(packet(2, "second"), 0)).toBe(true);
      expect(watcher.receive(packet(3, "other-cell", "M2"), 0)).toBe(true);
      clock++;
      watcher.sweep();
      expect(watcher.cardsOf(0).map(card => card.slot)).toEqual([2]);
      expect(watcher.receive(packet(4, "third"), 0)).toBe(false);
      watcher.confirmRoom({ ...room, lastSeq: 2, events: [event(2, place(1, true), "second")] });
      expect(watcher.receive(packet(5, "new-chain"), 0)).toBe(true);
    } finally { watcher.clear(); }
  });

  it("sends no preview for a blocked or invalid write and no identity for a refused reveal", async () => {
    const held = withTwin([{ ref: "set", zone: "monster", slot: 1, faceUp: false, position: "attack", cardId: MAGICIAN, name: "Dark Magician" }]);
    const wire: Uint8Array[] = [];
    const send = (bytes: Uint8Array) => { wire.push(bytes); };
    const post = vi.fn(async () => null);
    const reveal = { type: "twin.flip", seat: 0, actorSeat: 0, cardRef: "set", faceUp: true, cardId: MAGICIAN, name: "Dark Magician" } as const;
    const publish = (proposal: RemoteActionProposal, key: string) => publishPeerPreview(held, proposal, key);
    const undoHold = correctionsFor(held, 0).begin("set", [{ zone: "monster", slot: 1 }]);
    setPeerPreviewTransport(send);
    try {
      const allowed = createRoomMutationQueue(() => held, post, undefined, () => true, publish);
      const invalid = createRoomMutationQueue(() => held, post, undefined, () => false, publish);
      await expect(allowed.action({ ...reveal, source: "auto" })).resolves.toBeNull();
      await expect(invalid.transaction((_room, act) => act(reveal))).resolves.toBeNull();
      expect(post).not.toHaveBeenCalled();
      expect(wire).toEqual([]);

      await expect(allowed.action(reveal)).resolves.toBeNull();
      expect(post).toHaveBeenCalledOnce();
      expect(wire).toHaveLength(1);
      const sent = JSON.parse(new TextDecoder().decode(wire[0]));
      expect(sent).toMatchObject({ kind: "face-down", zone: "M1" });
      expect(sent).not.toHaveProperty("cardId");
      expect(sent).not.toHaveProperty("name");
    } finally {
      releasePeerPreviewTransport(send);
      undoHold();
    }
  });

  it("does not publish again when a retry is skipped during an outage", async () => {
    vi.useFakeTimers();
    let valid = true;
    const post = vi.fn(async () => { noteWriteLost(); return null; });
    const onPost = vi.fn();
    const queue = createRoomMutationQueue(() => room, post, undefined, () => valid, onPost);
    try {
      const result = queue.action(place(1, true));
      await vi.advanceTimersByTimeAsync(0);
      expect(post).toHaveBeenCalledOnce();
      expect(onPost).toHaveBeenCalledOnce();
      valid = false;
      await vi.advanceTimersByTimeAsync(OUTAGE_BACKOFF_MS[0]);
      await expect(result).resolves.toBeNull();
      expect(post).toHaveBeenCalledOnce();
      expect(onPost).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  it("clears the cell a server event touches even with a different key", () => {
    const watcher = createPeerPreviewStore();
    try {
      watcher.confirmRoom(room);
      expect(watcher.receive(packet(1, "preview"), 0)).toBe(true);
      expect(watcher.receive(packet(2, "unrelated", "M2"), 0)).toBe(true);
      expect(watcher.receive(packet(1, "other-seat", "M1", 1), 1)).toBe(true);
      const otherSeat = watcher.cardsOf(1);
      const action = place(1, true);
      watcher.confirmRoom({ ...room, lastSeq: 2, events: [event(2, action, "server")] });
      expect(watcher.cardsOf(0).map(card => card.slot)).toEqual([2]);
      expect(watcher.cardsOf(1)).toBe(otherSeat);
      expect(watcher.receive(packet(1, "preview"), 0)).toBe(false);
      expect(watcher.receive(packet(3, "server"), 0)).toBe(false);
      expect(watcher.receive(packet(4, "next"), 0)).toBe(true);
    } finally { watcher.clear(); }
  });

  it("clears a spectator preview when a projected undo changes the cell", () => {
    const watcher = createPeerPreviewStore();
    const real = { ref: "released", zone: "monster", slot: 1, faceUp: true, position: "attack" } as const;
    try {
      watcher.confirmRoom({ ...room, spectator: true });
      expect(watcher.receive(packet(1, "before-undo"), 0)).toBe(true);
      watcher.confirmRoom({
        ...withTwin([real]), spectator: true, lastSeq: 2,
        events: [event(2, { type: "log.note", actorSeat: 0, text: "Undid an action" }, "server")],
      });
      expect(watcher.cardsOf(0)).toEqual([]);
    } finally { watcher.clear(); }
  });

  it("skips a move with an unknown destination cell", () => {
    const held = withTwin([{ ref: "card", zone: "monster", slot: 1, faceUp: true, position: "attack" }]);
    expect(previewDrafts(held, { type: "twin.move", actorSeat: 0, seat: 0, cardRef: "card", zone: "spell-trap" })).toEqual([]);
  });

  it("previews an automatic Field Spell move in the Field Zone", () => {
    const held = withTwin([{ ref: "field-spell", cardId: FIELD_SPELL, zone: "spell-trap", slot: 1, faceUp: true, position: "attack" }]);
    expect(previewDrafts(held, { type: "twin.move", actorSeat: 0, seat: 0, cardRef: "field-spell", zone: "spell-trap", slot: 2, source: "auto" })).toEqual([
      { zone: "FIELD", kind: "face-up", face: { cardId: FIELD_SPELL } }, { zone: "S1", kind: "empty" },
    ]);
  });
});
