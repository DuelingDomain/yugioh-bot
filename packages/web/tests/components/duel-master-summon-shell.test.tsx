// @vitest-environment jsdom
import { StrictMode, useLayoutEffect, useRef } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DuelEvent, DuelSeatView } from "@yugidraft/shared/duels";
import { LOCATION_DMZONE, LOCATION_MZONE } from "../../src/components/duel/constants";
import { collectFreshEvents, maxEventId } from "../../src/components/duel/event-queue";
import { usePreviousSeats, withMasterSummonMoves } from "../../src/components/duel/master-summon-moves";

const CODE = 8240199;
const seatsOf = (inZone: boolean): DuelSeatView[] =>
  [{ seat: 1, deckMaster: { card: { code: CODE, name: "Master" }, inZone, returns: 0, nextCost: 0 } }] as unknown as DuelSeatView[];
const summon: DuelEvent = {
  id: 27, kind: "summon", text: "Player 2 Normal Summons Master", seat: 1, summonKind: "normal",
  card: { code: CODE, name: "Master" } as never, zone: { controller: 1, location: LOCATION_MZONE, sequence: 2 },
};

/**
 * What a shell does with the engine view: it keeps the seat views of the update before and gives the layers the events with
 * the Deck Master move added. The layer here reads fresh events like MoveFx does (a cursor) and counts the flights out of the zone.
 */
function Shell({ events, seats, flights }: { events: DuelEvent[]; seats: DuelSeatView[]; flights: DuelEvent[] }) {
  const previousSeats = usePreviousSeats(seats);
  const layerEvents = withMasterSummonMoves(events, previousSeats, seats);
  const cursor = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (cursor.current == null) { cursor.current = maxEventId(layerEvents) ?? 0; return; }
    const { nextCursor, fresh } = collectFreshEvents(layerEvents, cursor.current);
    cursor.current = nextCursor;
    flights.push(...fresh.filter((event) => event.kind === "move" && event.from?.location === LOCATION_DMZONE));
  });
  return null;
}

describe("a shell with two consecutive views", () => {
  afterEach(cleanup);

  for (const [name, strict] of [["plain", false], ["StrictMode", true]] as const) {
    it(`flies the Deck Master out of its zone exactly once (${name})`, () => {
      const flights: DuelEvent[] = [];
      const wrap = (node: React.ReactElement) => (strict ? <StrictMode>{node}</StrictMode> : node);
      const view = render(wrap(<Shell events={[]} seats={seatsOf(true)} flights={flights} />));
      // The update: the master is out of its zone, and its summon arrives alone.
      view.rerender(wrap(<Shell events={[summon]} seats={seatsOf(false)} flights={flights} />));
      expect(flights).toHaveLength(1);
      // Later updates that carry the same events (a poll, a new views array) add no second flight.
      view.rerender(wrap(<Shell events={[summon]} seats={seatsOf(false)} flights={flights} />));
      view.rerender(wrap(<Shell events={[summon]} seats={seatsOf(false)} flights={flights} />));
      expect(flights).toHaveLength(1);
    });
  }

  it("adds no flight on the first view a shell sees (a page opened after the summon)", () => {
    const flights: DuelEvent[] = [];
    const view = render(<Shell events={[summon]} seats={seatsOf(false)} flights={flights} />);
    view.rerender(<Shell events={[summon]} seats={seatsOf(false)} flights={flights} />);
    expect(flights).toHaveLength(0);
  });

  it("keeps two shells apart: each has its own previous views", () => {
    const first: DuelEvent[] = [];
    const second: DuelEvent[] = [];
    const a = render(<Shell events={[]} seats={seatsOf(true)} flights={first} />);
    const b = render(<Shell events={[summon]} seats={seatsOf(false)} flights={second} />);
    a.rerender(<Shell events={[summon]} seats={seatsOf(false)} flights={first} />);
    b.rerender(<Shell events={[summon]} seats={seatsOf(false)} flights={second} />);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });
});
