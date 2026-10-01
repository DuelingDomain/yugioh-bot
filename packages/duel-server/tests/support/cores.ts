import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { currentEngineDataDirectory } from "../engine-data-dir.js";

/**
 * The one place that decides where a test finds a core and what happens when the core is missing.
 *
 * Without DUEL_REQUIRE_CORES=1 a test that needs a missing core is skipped, with a warning that names the file.
 * With DUEL_REQUIRE_CORES=1 (npm run test:engine) the same test FAILS with a message that names the file.
 * Never write `skipIf`, `runIf` or an `existsSync` guard for a core in a test: use describeWithCores, itWithCores,
 * itEachWithCores or failIfRequired from this file.
 *
 * Core kinds:
 *   standard      <data dir>/ocgcore.standard.wasm   stock rules (2 duelists)
 *   domain        <data dir>/ocgcore.domain.wasm     Domain rules (2 duelists)
 *   multi         MULTI_WASM, else the local tagged build, else the canonical build (see currentMultiWasm)
 *   domain-multi  DOMAIN_MULTI_WASM, else the local tagged build, else the canonical build
 *   native        any other build product or fixture file (differential pairs, corpus), named by the test
 *   live          an opt-in flag (NSEAT_LIVE): see needs.liveNseat
 *   local         a gitignored local file that is not a core (failure records, census output): a missing file
 *                 stays a SKIP, also with DUEL_REQUIRE_CORES=1
 */

/**
 * A developer's current local per-task build. It is used when the file exists and MULTI_WASM / DOMAIN_MULTI_WASM
 * are not set. A clean checkout and CI do not have it; they use the canonical build, which the documented build
 * (scripts/build-multi-core.sh, .github/workflows/test.yml) makes. Change the tags when the merged core is installed.
 * P59 is the production build of patches 0001 to 0059 (OUT_NAME=ocgcore.multi-P59.sync.wasm and ocgcore.multi-domain-P59.sync.wasm); it is the build
 * installed in data/duel-engine-next. The debug build for the Table test is ocgcore.multi-P59-trap.sync.wasm (see tests/multi-scripts-table.test.ts).
 */
export const CURRENT_MULTI_TAG = "P59";
export const CURRENT_DOMAIN_MULTI_TAG = "P59";

export type CoreKind = "standard" | "domain" | "multi" | "domain-multi" | "native" | "data" | "live" | "local";

/** One thing a test needs. `ok` is checked when the test file loads. */
export interface CoreNeed {
  kind: CoreKind;
  /** Short words for the failure message, for example "multi core". */
  label: string;
  /** Where the thing must be (a path, or a variable name for a flag). */
  where: string;
  ok: boolean;
  /** One line that tells how to get it. */
  hint?: string;
}

/** DUEL_REQUIRE_CORES=1: a missing core fails the test instead of skipping it. */
export function requireCores(): boolean {
  return process.env.DUEL_REQUIRE_CORES === "1";
}

const distPath = (name: string) => fileURLToPath(new URL(`../../domain-core/dist/${name}`, import.meta.url));

/** The first of `names` that exists in domain-core/dist; the last name when none exists (the failure message names it). */
function firstBuild(...names: string[]): string {
  const paths = names.map(distPath);
  return paths.find((path) => existsSync(path)) ?? paths[paths.length - 1];
}

/**
 * The multi-duelist core under test (3 and 4 seats, Tag): MULTI_WASM; else the local tagged build when it exists;
 * else the canonical ocgcore.multi.sync.wasm that CI builds.
 */
export function currentMultiWasm(): string {
  return resolve(process.env.MULTI_WASM ?? firstBuild(`ocgcore.multi-${CURRENT_MULTI_TAG}.sync.wasm`, "ocgcore.multi.sync.wasm"));
}

/** The multi-duelist Domain core under test: DOMAIN_MULTI_WASM; else the local tagged build; else the canonical build. */
export function currentDomainMultiWasm(): string {
  return resolve(process.env.DOMAIN_MULTI_WASM ?? firstBuild(`ocgcore.multi-domain-${CURRENT_DOMAIN_MULTI_TAG}.sync.wasm`, "ocgcore.multi-domain.sync.wasm"));
}

const exists = (path: string) => existsSync(path);
const BUILD_HINT = "Build or install it (see packages/duel-server/domain-core/patches/README.md and npm run prepare:data).";

export const needs = {
  /** cards.cdb of the engine data directory. */
  cards(dir: string = currentEngineDataDirectory()): CoreNeed {
    const where = join(dir, "cards.cdb");
    return { kind: "data", label: "card database", where, ok: exists(where), hint: "Set DUEL_DATA_DIR to an engine data directory." };
  },
  /** Card scripts of the engine data directory (one file, or the directory when `file` is empty). */
  scripts(dir: string = currentEngineDataDirectory(), file = ""): CoreNeed {
    const where = join(dir, "card-scripts", file);
    return { kind: "data", label: "card scripts", where, ok: exists(where), hint: "Set DUEL_DATA_DIR to an engine data directory." };
  },
  /** Domain rules script (card-scripts/domain.lua, or domain.lua in the data directory). */
  domainScript(dir: string = currentEngineDataDirectory()): CoreNeed {
    const inScripts = join(dir, "card-scripts", "domain.lua");
    const direct = join(dir, "domain.lua");
    return { kind: "data", label: "domain.lua script", where: inScripts, ok: exists(inScripts) || exists(direct), hint: "Set DUEL_DATA_DIR to an engine data directory." };
  },
  standard(dir: string = currentEngineDataDirectory()): CoreNeed {
    const where = join(dir, "ocgcore.standard.wasm");
    return { kind: "standard", label: "standard core", where, ok: exists(where), hint: "Run npm run prepare:data, or set DUEL_DATA_DIR." };
  },
  domain(dir: string = currentEngineDataDirectory()): CoreNeed {
    const where = join(dir, "ocgcore.domain.wasm");
    return { kind: "domain", label: "domain core", where, ok: exists(where), hint: "Run npm run prepare:data, or set DUEL_DATA_DIR." };
  },
  /** The multi core installed in the data directory (ocgcore.multi.wasm). */
  installedMulti(dir: string = currentEngineDataDirectory()): CoreNeed {
    const where = join(dir, "ocgcore.multi.wasm");
    return { kind: "multi", label: "installed multi core", where, ok: exists(where), hint: BUILD_HINT };
  },
  /** The current multi core build (3 and 4 seats). */
  multi(path: string = currentMultiWasm()): CoreNeed {
    return { kind: "multi", label: "multi core", where: path, ok: exists(path), hint: `${BUILD_HINT} MULTI_WASM names another build.` };
  },
  /** The current multi core build with Domain rules, plus the domain script. */
  domainMulti(dir: string = currentEngineDataDirectory(), path: string = currentDomainMultiWasm()): CoreNeed[] {
    return [
      { kind: "domain-multi", label: "domain multi core", where: path, ok: exists(path), hint: `${BUILD_HINT} DOMAIN_MULTI_WASM names another build.` },
      needs.domainScript(dir),
    ];
  },
  /** Any other build product or fixture that a test reads (differential pairs, script corpus, failure files). */
  file(label: string, path: string, hint = BUILD_HINT): CoreNeed {
    return { kind: "native", label, where: path, ok: exists(path), hint };
  },
  /** A gitignored local file that is not a core (failure record, census output). Missing stays a SKIP in require mode. */
  localFile(label: string, path: string, hint: string): CoreNeed {
    return { kind: "local", label, where: path, ok: exists(path), hint };
  },
  /**
   * The multi core answered the Debug.SetupDuelists probe (tests/support/session.ts probeSetupDuelists).
   * `probedPath` is the file that was probed; it is the file named in the message. Default: the N-seat core.
   */
  setupDuelists(probeOk: boolean, probedPath: string = currentNseatWasm()): CoreNeed {
    const where = probedPath;
    return { kind: "multi", label: "multi core with Debug.SetupDuelists", where, ok: exists(where) && probeOk, hint: `${BUILD_HINT} MULTI_WASM or NSEAT_WASM names another build.` };
  },
  /**
   * The live N-seat scenarios. They also need NSEAT_LIVE=1: the synchronous core cannot be stopped by a test timeout,
   * and the default core build can hang when seat 1 ends its turn. REMOVE this gate when the merged core is installed
   * (ADVISOR-4 item 3). Until then DUEL_REQUIRE_CORES=1 without NSEAT_LIVE=1 fails these tests, on purpose,
   * so a green run cannot hide them; `npm run test:engine` sets NSEAT_LIVE=1.
   */
  liveNseat(setupDuelistsAvailable: boolean): CoreNeed {
    const flag = process.env.NSEAT_LIVE === "1";
    return {
      kind: "live",
      label: flag ? "N-seat core with Debug.SetupDuelists" : "NSEAT_LIVE=1 (live N-seat gate, not removed yet)",
      where: flag ? currentNseatWasm() : "NSEAT_LIVE",
      ok: flag && setupDuelistsAvailable,
      hint: flag ? BUILD_HINT : "Set NSEAT_LIVE=1 to run the live N-seat scenarios; the gate goes away with the merged core.",
    };
  },
};

/** Core of the live N-seat scenarios: NSEAT_WASM, else the current multi core. */
export function currentNseatWasm(): string {
  return resolve(process.env.NSEAT_WASM ?? currentMultiWasm());
}

type Needs = CoreNeed | CoreNeed[] | Array<CoreNeed | CoreNeed[]>;
const flat = (list: Needs): CoreNeed[] => (Array.isArray(list) ? (list as Array<CoreNeed | CoreNeed[]>).flat() : [list]);

export function missingNeeds(list: Needs): CoreNeed[] {
  return flat(list).filter((need) => !need.ok);
}

/** Missing needs that fail a test in require mode. A "local" file (not a core) never does. */
function fatalNeeds(missing: CoreNeed[]): CoreNeed[] {
  return missing.filter((need) => need.kind !== "local");
}

export function coresReady(list: Needs): boolean {
  return missingNeeds(list).length === 0;
}

function describeMissing(missing: CoreNeed[]): string {
  return missing.map((need) => `${need.label} at ${need.where}${need.hint ? ` (${need.hint})` : ""}`).join("; ");
}

export function missingCoreMessage(name: string, missing: CoreNeed[]): string {
  return `DUEL_REQUIRE_CORES=1: "${name}" needs ${describeMissing(missing)}, but it is missing. Install it, or unset DUEL_REQUIRE_CORES to skip this test.`;
}

const warned = new Set<string>();
function warnSkipped(name: string, missing: CoreNeed[]): void {
  if (warned.has(name)) return;
  warned.add(name);
  console.warn(`SKIPPED "${name}": needs ${describeMissing(missing)}. Set DUEL_REQUIRE_CORES=1 to make this a failure.`);
}

/** For a check inside a test body: throws when DUEL_REQUIRE_CORES=1, else the caller skips its part. */
export function failIfRequired(what: string, list: Needs): void {
  const fatal = fatalNeeds(missingNeeds(list));
  if (fatal.length > 0 && requireCores()) throw new Error(missingCoreMessage(what, fatal));
}

/** `describe` for a suite that needs cores: runs, skips with a warning, or (DUEL_REQUIRE_CORES=1) fails. */
export function describeWithCores(name: string, list: Needs, body: () => void): void {
  const missing = missingNeeds(list);
  if (missing.length === 0) {
    describe(name, body);
    return;
  }
  const fatal = fatalNeeds(missing);
  if (requireCores() && fatal.length > 0) {
    describe(name, () => {
      it("has the cores it needs", () => {
        throw new Error(missingCoreMessage(name, fatal));
      });
    });
    return;
  }
  warnSkipped(name, missing);
  describe.skipIf(true)(name, body);
}

/** `it` for a test that needs cores. */
export function itWithCores(name: string, list: Needs, body: () => void | Promise<void>, timeout?: number): void {
  const missing = missingNeeds(list);
  if (missing.length === 0) return void it(name, body, timeout);
  const fatal = fatalNeeds(missing);
  if (requireCores() && fatal.length > 0) {
    return void it(name, () => {
      throw new Error(missingCoreMessage(name, fatal));
    });
  }
  warnSkipped(name, missing);
  it.skipIf(true)(name, body, timeout);
}

/** `it.each(table)(name, body)` for tests that need cores. The failure case is one test with the plain name. */
export function itEachWithCores<T extends unknown[]>(
  list: Needs,
  table: readonly T[],
  name: string,
  body: (...args: T) => void | Promise<void>,
  timeout?: number,
): void {
  const missing = missingNeeds(list);
  type Each = (rows: readonly T[]) => (n: string, fn: (...args: T) => void | Promise<void>, t?: number) => void;
  // Call `each` as a method: a detached `it.each` loses its `this` and throws.
  if (missing.length === 0) return (it.each as unknown as Each).call(it, table)(name, body, timeout);
  const fatal = fatalNeeds(missing);
  if (requireCores() && fatal.length > 0) {
    return void it(name, () => {
      throw new Error(missingCoreMessage(name, fatal));
    });
  }
  warnSkipped(name, missing);
  const skipped = it.skipIf(true);
  (skipped.each as unknown as Each).call(skipped, table)(name, body, timeout);
}
