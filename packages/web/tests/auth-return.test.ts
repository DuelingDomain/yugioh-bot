import { describe, expect, it } from "vitest";
import { safeReturnPath } from "../src/lib/auth-return";

describe("safeReturnPath", () => {
  it.each(["/dashboard", "/drafts/a?join=1#seat", "/", "/settings/account"])("keeps internal destination %s", (path) => {
    expect(safeReturnPath(path)).toBe(path);
  });
  it.each([null, undefined, 12, {}, "", "dashboard", "https://evil.test", "javascript:alert(1)", "//evil.test", "/\\evil.test", "/a\\b", "/a\n", "/a\u0000b", "/a\u007fb", "/sign-in", "/sign-in/extra?x", "/sign-in-other", "/sign-up?x", "/sso-callback#x", "/a/../sign-in", "/%73ign-up", "/%2fevil.test", "/%5cevil.test", "/a%0db"])("defaults unsafe input %j", (path) => {
    expect(safeReturnPath(path)).toBe("/dashboard");
  });
  it("rejects a protocol-relative path exposed by dot-segment normalization", () => {
    expect(safeReturnPath("/a/..//evil.test")).toBe("/dashboard");
  });
});
