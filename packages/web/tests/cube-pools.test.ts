import { expect, it } from "vitest";
import { isExtraDeckCardClient } from "../src/lib/cube-pools";
it.each([["synchro_pendulum", "Synchro Pendulum Effect Monster"], ["xyz_pendulum", "XYZ Pendulum Effect Monster"]])("routes %s to Extra", (frameType, type) => {
  expect(isExtraDeckCardClient({ frameType, type })).toBe(true);
});
