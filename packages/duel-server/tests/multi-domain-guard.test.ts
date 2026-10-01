import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MULTI_DOMAIN_UNAVAILABLE_MESSAGE } from "@yugidraft/shared/duels";
import { MULTI_CORE_MISSING_MESSAGE, multiDomainCoreAvailable, multiDomainStartProblem, multiStartProblem } from "../src/multi-domain-guard.js";

const dirs: string[] = [];
function dataDir(files: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "multi-domain-guard-"));
  dirs.push(dir);
  for (const file of files) writeFileSync(join(dir, file), "wasm");
  return dir;
}
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("multiDomainStartProblem", () => {
  it("lets a 1v1 table of any mode and a Standard table of any format start", () => {
    const dir = dataDir([]);
    expect(multiDomainStartProblem("domain", "1v1", dir)).toBeNull();
    expect(multiDomainStartProblem("normal", "ffa3", dir)).toBeNull();
    expect(multiDomainStartProblem("normal", "tag", dir)).toBeNull();
  });

  it("refuses Domain at 3 or more seats with a clear message when the Domain core is missing", () => {
    // The Standard multi core alone is not enough for Domain.
    const dir = dataDir(["ocgcore.multi.wasm"]);
    expect(multiDomainCoreAvailable(dir)).toBe(false);
    for (const format of ["tag", "ffa3", "ffa4"] as const) {
      expect(multiDomainStartProblem("domain", format, dir)).toBe(MULTI_DOMAIN_UNAVAILABLE_MESSAGE);
    }
  });

  it("lets Domain at 3 or more seats start once the Domain core is installed", () => {
    const dir = dataDir(["ocgcore.multi.wasm", "ocgcore.multi-domain.wasm"]);
    expect(multiDomainStartProblem("domain", "ffa4", dir)).toBeNull();
  });
});

describe("multiStartProblem", () => {
  it("never blocks a 1v1 table, whatever the data directory holds", () => {
    const dir = dataDir([]);
    expect(multiStartProblem("normal", "1v1", dir)).toBeNull();
    expect(multiStartProblem("domain", "1v1", dir)).toBeNull();
  });

  it("refuses Tag and free-for-all tables of any mode with a clear message when the multi core is missing", () => {
    const dir = dataDir(["ocgcore.standard.wasm", "ocgcore.domain.wasm"]);
    for (const mode of ["normal", "domain"] as const) {
      for (const format of ["tag", "ffa3", "ffa4"] as const) {
        expect(multiStartProblem(mode, format, dir)).toBe(MULTI_CORE_MISSING_MESSAGE);
      }
    }
    // The message holds no file path.
    expect(MULTI_CORE_MISSING_MESSAGE).not.toMatch(/[/\\]|\.wasm/);
  });

  it("lets Standard at Tag and free-for-all tables start with the multi core alone", () => {
    const dir = dataDir(["ocgcore.multi.wasm"]);
    for (const format of ["tag", "ffa3", "ffa4"] as const) expect(multiStartProblem("normal", format, dir)).toBeNull();
  });

  it("keeps Domain at 3 or more seats closed until the Domain multi core exists", () => {
    const dir = dataDir(["ocgcore.multi.wasm"]);
    for (const format of ["tag", "ffa3", "ffa4"] as const) {
      expect(multiStartProblem("domain", format, dir)).toBe(MULTI_DOMAIN_UNAVAILABLE_MESSAGE);
    }
  });
});
