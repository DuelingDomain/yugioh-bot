import { describe, expect, it } from "vitest";
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
    expect(multiDomainBlockReason("domain", "ffa3", true)).toBeNull();
  });

  it("is off by default until the core ships", () => {
    expect(MULTI_DOMAIN_CORE_READY).toBe(false);
    expect(multiDomainBlockReason("domain", "ffa4")).toBe(MULTI_DOMAIN_UNAVAILABLE_MESSAGE);
  });
});
