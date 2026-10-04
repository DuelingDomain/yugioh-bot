import { describe, expect, it } from "vitest";
import { MSG_ATTACK_DUELIST, MSG_DUELIST_ELIMINATED, MSG_FIELD_DISABLED_N, parseDuelistMessages } from "../src/raw-messages.js";

/** A getMessage buffer entry: u32 length, then the bytes. */
function message(...bytes: number[]): number[] {
  return [bytes.length, 0, 0, 0, ...bytes];
}

function u32(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

describe("MSG_FIELD_DISABLED_N (202)", () => {
  it("reads count x (duelist, u32 mask)", () => {
    const buffer = Uint8Array.from([
      ...message(40, 1),
      ...message(MSG_FIELD_DISABLED_N, 3, 0, ...u32(0x0001), 1, ...u32(0x0500), 3, ...u32(0xdeadbeef)),
    ]);
    const parsed = parseDuelistMessages(buffer);
    expect(parsed.extras).toEqual([
      { type: MSG_FIELD_DISABLED_N, zones: [{ duelist: 0, mask: 1 }, { duelist: 1, mask: 0x500 }, { duelist: 3, mask: 0xdeadbeef }], after: 1 },
    ]);
  });

  it("accepts a count of zero", () => {
    const parsed = parseDuelistMessages(Uint8Array.from(message(MSG_FIELD_DISABLED_N, 0)));
    expect(parsed.extras).toEqual([{ type: MSG_FIELD_DISABLED_N, zones: [], after: 0 }]);
  });

  it("drops a truncated message whole", () => {
    const parsed = parseDuelistMessages(Uint8Array.from(message(MSG_FIELD_DISABLED_N, 2, 0, ...u32(1), 1, 0, 0)));
    expect(parsed.extras).toEqual([]);
  });

  it("keeps the order with 200 and 201", () => {
    const parsed = parseDuelistMessages(Uint8Array.from([
      ...message(MSG_ATTACK_DUELIST, 2),
      ...message(MSG_FIELD_DISABLED_N, 1, 2, ...u32(0x10)),
      ...message(MSG_DUELIST_ELIMINATED, 2, 1),
    ]));
    expect(parsed.extras.map((entry) => entry.type)).toEqual([MSG_ATTACK_DUELIST, MSG_FIELD_DISABLED_N, MSG_DUELIST_ELIMINATED]);
  });
});

it("reads surrender response closure 203 in order and drops a truncated payload", () => {
  const parsed = parseDuelistMessages(Uint8Array.from([
    ...message(MSG_DUELIST_ELIMINATED, 0, 0),
    ...message(203, 2),
    ...message(40, 1),
    ...message(203),
  ]));
  expect(parsed.extras).toEqual([
    { type: MSG_DUELIST_ELIMINATED, duelist: 0, reason: 0, after: 0 },
    { type: 203, duelist: 2, after: 0 },
  ]);
});
