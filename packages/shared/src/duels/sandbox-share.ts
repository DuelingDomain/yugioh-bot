import {
  parseSandboxBoard,
  parseSandboxRun,
  SandboxBoardError,
  type SandboxBoard,
  type SandboxRun,
} from "./sandbox-board.js";

export const SANDBOX_SHARE_PREFIX = "DKSB1:";
/** Includes the prefix. Fits a 32 KiB board, 1 KiB run and name after base64url encoding. */
export const SANDBOX_SHARE_MAX_LENGTH = 48 * 1024;

export interface SandboxShare {
  name?: string;
  board: SandboxBoard;
  run: SandboxRun;
}

function parseShare(value: unknown): SandboxShare {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SandboxBoardError("share", "Expected a scenario object.");
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new SandboxBoardError("share", "Expected a plain scenario object.");
  }
  for (const key of Object.keys(value)) {
    if (!["name", "board", "run"].includes(key)) {
      throw new SandboxBoardError("share", `Unsupported scenario field: ${key}.`);
    }
  }
  const input = value as Record<string, unknown>;
  let name: string | undefined;
  if (Object.hasOwn(input, "name")) {
    if (typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 80) {
      throw new SandboxBoardError("name", "Scenario name must contain 1-80 characters after trimming.");
    }
    name = input.name.trim();
  }
  return {
    ...(name === undefined ? {} : { name }),
    board: parseSandboxBoard(input.board),
    run: parseSandboxRun(input.run),
  };
}

function base64url(binary: string): string {
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Portable synchronous codec: compact UTF-8 JSON, then unpadded base64url.
 * DKSB1 always uses plain JSON, so Node and browsers need no compression dependency.
 */
export function encodeSandboxShare(value: SandboxShare): string {
  const bytes = new TextEncoder().encode(JSON.stringify(parseShare(value)));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const code = SANDBOX_SHARE_PREFIX + base64url(binary);
  if (code.length > SANDBOX_SHARE_MAX_LENGTH) {
    throw new SandboxBoardError("share", `Share code must not exceed ${SANDBOX_SHARE_MAX_LENGTH} characters.`);
  }
  return code;
}

/** Parse untrusted portable data. A share code grants no access and is not a signature. */
export function decodeSandboxShare(code: string): SandboxShare {
  if (typeof code !== "string" || code.length > SANDBOX_SHARE_MAX_LENGTH) {
    throw new SandboxBoardError("share", `Expected a share code of at most ${SANDBOX_SHARE_MAX_LENGTH} characters.`);
  }
  if (!code.startsWith(SANDBOX_SHARE_PREFIX)) {
    throw new SandboxBoardError("share", `Share code must start with ${SANDBOX_SHARE_PREFIX}`);
  }
  const payload = code.slice(SANDBOX_SHARE_PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(payload) || payload.length % 4 === 1) {
    throw new SandboxBoardError("share", "Share code contains invalid base64url data.");
  }
  let value: unknown;
  try {
    const binary = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    // Reject nonzero padding bits instead of accepting several encodings of the same data.
    if (base64url(binary) !== payload) throw new Error("Noncanonical base64url.");
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new SandboxBoardError("share", "Share code must contain valid base64url, UTF-8 and JSON data.");
  }
  return parseShare(value);
}
