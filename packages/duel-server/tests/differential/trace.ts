import { createHash } from "node:crypto";
// Type imports only. A value import of "ocgcore-wasm" here would wait for the vi.mock factory that loads this file.
import type createCore from "ocgcore-wasm";
import type { OcgCoreSync, OcgDuelHandle, OcgMessage } from "ocgcore-wasm";
import { rawMessageCapture, splitMessages, toHex, type RawMessageCapture } from "./raw-messages.js";

type OcgModule = typeof import("ocgcore-wasm");

/**
 * One core process step: what `duelProcess` returned, every parsed message the wrapper produced
 * for it, the raw bytes of every message the core wrote (hex, one entry per message), the
 * "failed to parse a message" warnings of the wrapper, and a snapshot of the whole field taken
 * right after it. The field snapshot holds `duelQueryField` and a full-flag `duelQueryLocation`
 * of every location of both teams.
 */
export interface TraceStep {
  status: unknown;
  messages: string[];
  raw: string[];
  parseWarnings: string[];
  field: string;
}

export interface Trace {
  steps: TraceStep[];
}

const SNAPSHOT_LOCATION_NAMES = ["DECK", "HAND", "MZONE", "SZONE", "GRAVE", "REMOVED", "EXTRA"] as const;

export function stringify(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === "bigint") return `${item}n`;
    if (item instanceof Uint8Array) return Array.from(item);
    return item;
  });
}

export function sha1(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

function snapshotField(ocg: OcgModule, lib: OcgCoreSync, handle: OcgDuelHandle): string {
  const flags = Object.values(ocg.OcgQueryFlags).reduce((all, flag) => all | flag, 0);
  const locations: Record<string, unknown> = {};
  for (const controller of [0, 1] as const) {
    for (const name of SNAPSHOT_LOCATION_NAMES) {
      const location = ocg.OcgLocation[name];
      locations[`${controller}:${location}`] = lib.duelQueryLocation(handle, {
        flags: flags as never,
        controller,
        location,
      });
    }
  }
  return stringify({ field: lib.duelQueryField(handle), locations });
}

let active: Trace | null = null;

/** Start recording. Every core created after this call, until `stopRecording`, appends to the trace. */
// Lua seeds its string hash (and math.random) from time(NULL). The wasm runtime reads Date.now, so
// the order of pairs() in a card script, and with it a message, can change from one run to the next.
// A recording freezes Date.now, so a replay of a journal is repeatable.
const FIXED_NOW = Date.UTC(2026, 0, 1);
let realNow: (() => number) | null = null;

let wasmOverride: ArrayBuffer | null = null;

/** Make every core created by the wrapper use this wasm, or restore the caller's choice with null. */
export function setWasmOverride(wasm: ArrayBuffer | null): void {
  wasmOverride = wasm;
}

export function startRecording(): Trace {
  active = { steps: [] };
  if (!realNow) {
    realNow = Date.now;
    Date.now = () => FIXED_NOW;
  }
  return active;
}

export function stopRecording(): void {
  active = null;
  if (realNow) {
    Date.now = realNow;
    realNow = null;
  }
}

/**
 * Wraps the default export of "ocgcore-wasm" (`createCore`). The returned core behaves like the
 * original. When a recording is active at creation time, it also appends a TraceStep to that
 * recording after every `duelProcess`. The extra queries only read core state.
 */
export function wrapCreateCore(ocg: OcgModule): typeof createCore {
  const original = ocg.default;
  const wrapped = async (...callArgs: Parameters<typeof createCore>) => {
    const options: Record<string, unknown> = { ...(callArgs[0] as object) };
    if (wasmOverride) options.wasmBinary = wasmOverride;
    const trace = active;
    let capture: RawMessageCapture | null = null;
    if (trace) {
      // The raw bytes need our own instantiation of the wasm, so a recorded core must get its wasm as bytes.
      if (!(options.wasmBinary instanceof ArrayBuffer)) throw new Error("differential trace: a recorded core needs wasmBinary");
      capture = rawMessageCapture(options.wasmBinary);
      options.instantiateWasm = capture.instantiateWasm;
    }
    const lib = (await (original as (...a: unknown[]) => Promise<unknown>)(options, ...callArgs.slice(1))) as OcgCoreSync;
    if (!trace || !capture) return lib;
    const rawCapture = capture;
    let pending: TraceStep | null = null;
    return new Proxy(lib, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        if (typeof value !== "function") return value;
        if (property === "duelProcess") {
          return (handle: OcgDuelHandle) => {
            const status = (value as (h: OcgDuelHandle) => unknown).call(target, handle);
            pending = { status, messages: [], raw: [], parseWarnings: [], field: snapshotField(ocg, target, handle) };
            trace.steps.push(pending);
            return status;
          };
        }
        if (property === "duelGetMessage") {
          return (handle: OcgDuelHandle) => {
            // The wrapper drops a message it cannot parse and only warns. Catch those warnings.
            const warnings: string[] = [];
            const warn = console.warn;
            console.warn = (...warnArgs: unknown[]) => {
              const text = warnArgs.map(String).join(" ");
              if (text.startsWith("failed to parse a message")) warnings.push(text);
              else warn(...warnArgs);
            };
            let messages: OcgMessage[];
            try {
              messages = (value as (h: OcgDuelHandle) => OcgMessage[]).call(target, handle);
            } finally {
              console.warn = warn;
            }
            const buffers = rawCapture.take();
            if (pending) {
              pending.messages.push(...messages.map((message) => stringify(message)));
              pending.raw.push(...buffers.flatMap((buffer) => splitMessages(buffer)).map(toHex));
              pending.parseWarnings.push(...warnings);
            }
            return messages;
          };
        }
        return value.bind(target);
      },
    });
  };
  return wrapped as unknown as typeof createCore;
}
