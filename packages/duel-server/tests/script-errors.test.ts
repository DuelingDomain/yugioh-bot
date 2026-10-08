import { afterEach, describe, expect, it, vi } from "vitest";
import { OcgLogType } from "ocgcore-wasm";
import { classifyCardScriptError, createScriptErrorPolicy, scriptErrorModeFromEnv } from "../src/script-errors.js";

afterEach(() => vi.unstubAllEnvs());

describe("card script error classification", () => {
  const message = '[string "c3743515.lua"]:57: attempt to index a nil value (local \'a\')';
  it("recognizes runtime card failures with file and line", () => {
    expect(classifyCardScriptError(OcgLogType.ERROR, message, true)).toEqual({ code: 3743515, scriptFile: "c3743515.lua", line: 57, message });
  });
  it("attributes a shared-helper runtime failure using the immediately preceding traceback", () => {
    const text = '[string "utility.lua"]:42: bad argument #1 to \'GetCode\' (Card expected)';
    expect(classifyCardScriptError(OcgLogType.ERROR, text, true, 'stack traceback:\n\t[string "official/c3743515.lua"]:64: in function <[string "official/c3743515.lua"]:62>'))
      .toMatchObject({ code: 3743515, scriptFile: "utility.lua", line: 42 });
  });
  it.each([
    [OcgLogType.ERROR, message, false],
    [OcgLogType.UNDEFINED, message, true],
    [OcgLogType.ERROR, '[string "c3743515.lua"]:57: unexpected symbol near \'end\'', true],
    [OcgLogType.ERROR, '[string "c3743515.lua"]:57: stack overflow', true],
    [OcgLogType.ERROR, 'core panic: c3743515.lua:57: memory corruption', true],
    [OcgLogType.ERROR, 'Missing script c3743515.lua', true],
    [OcgLogType.ERROR, '[string "duel-startup.lua"]:1: bad argument #1', true],
  ])("keeps setup, syntax, undefined and core failures fatal (%s %s)", (type, text, running) => {
    expect(classifyCardScriptError(type as number, text as string, running as boolean)).toBeNull();
  });
});


describe("saved script error policy", () => {
  it("drops query callback errors even in strict mode, reporting each card privately once", () => {
    const reported = vi.fn();
    const policy = createScriptErrorPolicy({ mode: "normal", scriptErrorMode: "strict", onScriptError: reported });
    for (let i = 0; i < 3; i++) policy.query(() => policy.note(OcgLogType.ERROR, 'c3743515.lua:61: attempt to index a nil value'));
    expect(policy.errors).toEqual([]);
    expect(policy.drain()).toEqual([]);
    expect(reported).toHaveBeenCalledTimes(1);
    expect(reported).toHaveBeenCalledWith(expect.objectContaining({ code: 3743515, source: "query" }));
  });
  it("scopes a runtime helper load but keeps nested card loads fatal and private", () => {
    const policy = createScriptErrorPolicy({ mode: "normal" });
    policy.query(() => {
      policy.enterLoad();
      policy.note(OcgLogType.ERROR, 'c3743515.lua:61: attempt to index a nil value');
      policy.enterLoad();
      policy.note(OcgLogType.ERROR, 'c123.lua:1: attempt to index a nil value');
      policy.leaveLoad(); policy.leaveLoad();
    }, true);
    expect(policy.errors).toEqual(["Engine script error: the duel could not continue."]);
    expect(policy.drain()).toEqual([]);
    policy.note(OcgLogType.ERROR, 'c3743515.lua:1: unexpected symbol near end');
    expect(policy.errors.join()).not.toMatch(/3743515|c123|nil value|unexpected symbol/);
  });
  it("defaults to tolerant and accepts the strict operational override", () => {
    vi.stubEnv("DUEL_SCRIPT_ERRORS", undefined); expect(scriptErrorModeFromEnv()).toBe("tolerant");
    vi.stubEnv("DUEL_SCRIPT_ERRORS", "strict"); expect(scriptErrorModeFromEnv()).toBe("strict");
    const onScriptError = vi.fn();
    const policy = createScriptErrorPolicy({ mode: "normal", scriptErrorMode: "tolerant", onScriptError });
    policy.enterProcess(); policy.note(OcgLogType.ERROR, 'c3743515.lua:61: attempt to index a nil value');
    expect(onScriptError).toHaveBeenCalledWith(expect.objectContaining({ code: 3743515, index: 1 }));
    policy.leaveProcess();
    expect(policy.errors).toEqual([]);
    expect(policy.drain()).toEqual([expect.objectContaining({ index: 1, code: 3743515, scriptErrorMode: "tolerant" })]);
    expect(policy.drain()).toEqual([]);
  });
  it("refuses unknown environment policy values", () => {
    vi.stubEnv("DUEL_SCRIPT_ERRORS", "strcit");
    expect(scriptErrorModeFromEnv).toThrow("DUEL_SCRIPT_ERRORS must be tolerant or strict");
  });
});
