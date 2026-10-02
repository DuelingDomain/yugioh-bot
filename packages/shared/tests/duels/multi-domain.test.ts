import { describe, expect, it } from "vitest";
import { MULTIPLAYER_TABLES_OFF_MESSAGE, multiplayerTablesBlockReason } from "../../src/duels/multiplayer-tables.js";
import { MULTI_DOMAIN_CORE_READY, MULTI_DOMAIN_UNAVAILABLE_MESSAGE, multiDomainBlockReason } from "../../src/duels/multi-domain.js";

describe("multiDomainBlockReason", () => {
  it("allows Standard at every table type", () => {
    for (const format of ["1v1", "tag", "ffa3", "ffa4"] as const) {
      expect(multiDomainBlockReason("normal", format, false)).toBeNull();
    }
  });

  it("allows Domain at a 1v1 table, and when the format is not known", () => {
    expect(multiDomainBlockReason("domain", "1v1", false)).toBeNull();
    expect(multiDomainBlockReason("domain", undefined, false)).toBeNull();
  });

  it("refuses Domain at Tag and free-for-all tables while the core is missing", () => {
    for (const format of ["tag", "ffa3", "ffa4"] as const) {
      expect(multiDomainBlockReason("domain", format, false)).toBe(MULTI_DOMAIN_UNAVAILABLE_MESSAGE);
    }
  });

  it("allows Domain at those tables when the core is there", () => {
    for (const format of ["ffa3", "ffa4", "tag"] as const) {
      expect(multiDomainBlockReason("domain", format, true)).toBeNull();
    }
  });

  it("keeps the gate closed until the host confirms the core", () => {
    expect(MULTI_DOMAIN_CORE_READY).toBe(false);
    expect(multiDomainBlockReason("domain", "ffa4")).toBe(MULTI_DOMAIN_UNAVAILABLE_MESSAGE);
  });
});

describe("multiplayerTablesBlockReason", () => {
  it("keeps 1v1 open when the flag is off", () => {
    expect(multiplayerTablesBlockReason("1v1", false)).toBeNull();
  });

  it.each(["ffa3", "ffa4", "tag"] as const)("requires the flag for %s", (format) => {
    expect(multiplayerTablesBlockReason(format, false)).toBe(MULTIPLAYER_TABLES_OFF_MESSAGE);
    expect(multiplayerTablesBlockReason(format, true)).toBeNull();
  });
});
