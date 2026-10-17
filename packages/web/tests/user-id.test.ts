import { expect, it } from "vitest";
import { parseUserId } from "../src/lib/user-id";

it.each(["1", "101", "9007199254740991"])("accepts canonical %s", (value) => {
  expect(parseUserId(value)).toBe(Number(value));
});

it.each([undefined, null, 101, NaN, Infinity, {}, [], "", "0", "00", "01", " 1", "1 ", "1\n", "+1", "1.0", "1e3", "-1", "9007199254740992", "196382527131222016"])("rejects %s", (value) => {
  expect(parseUserId(value)).toBeNull();
});
