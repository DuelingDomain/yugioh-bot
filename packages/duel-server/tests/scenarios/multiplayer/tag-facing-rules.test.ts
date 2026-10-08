import { afterEach, expect, vi } from "vitest";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { domainVariant } from "./domain-variants.js";
import { TAG_FACING_RULE_SCENARIOS } from "./tag-facing-rules.js";

// A Lua failure must not silently turn a geometry effect into an unavailable action.
const luaErrors = vi.hoisted(() => [] as string[]);
vi.mock("ocgcore-wasm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ocgcore-wasm")>();
  return { ...actual, default: async (options: Parameters<typeof actual.default>[0]) => {
    const core = await actual.default(options);
    const createDuel = core.createDuel.bind(core);
    core.createDuel = (options) => createDuel({ ...options, errorHandler: (type, text) => {
      if (type === actual.OcgLogType.ERROR || type === actual.OcgLogType.UNDEFINED) luaErrors.push(text);
      options.errorHandler?.(type, text);
    } });
    return core;
  } };
});
afterEach(() => expect(luaErrors.splice(0), "Tag geometry must have no Lua errors").toEqual([]));

describeWithCores("live Tag facing rules", liveNseat, () => {
  runScenarios("multiplayer/tag-facing-rules", TAG_FACING_RULE_SCENARIOS);
});
describeWithCores("live Domain Tag facing rules", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/tag-facing-rules-domain", TAG_FACING_RULE_SCENARIOS.map(domainVariant));
});
