import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Raw message capture (design section 9: the differential test compares message bytes, not only
 * the parsed messages). The wrapper parses the buffer of `OCG_DuelGetMessage` and drops a message
 * that it cannot parse, so two cores can differ in bytes that the parsed messages do not show.
 *
 * The emscripten glue of ocgcore-wasm calls `instantiateWasm(imports, callback)` when the option is
 * set. We instantiate the wasm ourselves and give the glue a copy of the exports in which the
 * getMessage export also copies the buffer (pointer + length from the out parameter) before it
 * returns. The copy only reads wasm memory, so the core behaves the same.
 */

let getMessageExport: string | null = null;

/** Name of the minified wasm export that the sync glue binds to `_ocgapiDuelGetMessage`. */
function findGetMessageExport(): string {
  if (getMessageExport) return getMessageExport;
  const dist = dirname(fileURLToPath(import.meta.resolve("ocgcore-wasm")));
  for (const file of readdirSync(dist)) {
    if (!file.startsWith("ocgcore.sync-") || !file.endsWith(".js")) continue;
    const match = /_ocgapiDuelGetMessage=\w+\.(\w+)/.exec(readFileSync(join(dist, file), "utf8"));
    if (match) return (getMessageExport = match[1]!);
  }
  throw new Error(`raw message capture: no sync glue in ${dist} binds _ocgapiDuelGetMessage`);
}

export interface RawMessageCapture {
  /** Pass these options to the emscripten factory (createCore spreads its options into it). */
  instantiateWasm: (imports: WebAssembly.Imports, callback: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void) => object;
  /** The buffers of the getMessage calls since the last take, in call order. */
  take(): Uint8Array[];
}

export function rawMessageCapture(wasmBinary: ArrayBuffer): RawMessageCapture {
  const name = findGetMessageExport();
  let buffers: Uint8Array[] = [];
  return {
    // Synchronous on purpose: an error thrown here rejects the glue's promise. An async failure
    // would leave createCore waiting forever.
    instantiateWasm(imports, callback) {
      const module = new WebAssembly.Module(wasmBinary);
      const instance = new WebAssembly.Instance(module, imports);
      const memory = Object.values(instance.exports).find((value): value is WebAssembly.Memory => value instanceof WebAssembly.Memory);
      const original = instance.exports[name];
      if (!memory || typeof original !== "function") {
        throw new Error(`raw message capture: the wasm has no memory export or no function export "${name}"`);
      }
      const getMessage = original as (duel: number, lengthPointer: number) => number;
      const exports: Record<string, unknown> = { ...instance.exports };
      exports[name] = (duel: number, lengthPointer: number): number => {
        const pointer = getMessage(duel, lengthPointer);
        // Read the buffer after the call: the call can grow the memory and detach older views.
        const length = new DataView(memory.buffer).getUint32(lengthPointer, true);
        buffers.push(new Uint8Array(memory.buffer, pointer, length).slice());
        return pointer;
      };
      callback({ exports } as unknown as WebAssembly.Instance, module);
      return {};
    },
    take() {
      const taken = buffers;
      buffers = [];
      return taken;
    },
  };
}

export function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("hex");
}

/** Split a getMessage buffer into its messages (each is a u32 length, then the message). */
export function splitMessages(bytes: Uint8Array): Uint8Array[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const messages: Uint8Array[] = [];
  let at = 0;
  while (at + 4 <= bytes.byteLength) {
    const length = view.getUint32(at, true);
    messages.push(bytes.subarray(at + 4, Math.min(bytes.byteLength, at + 4 + length)));
    at += 4 + length;
  }
  if (at < bytes.byteLength) messages.push(bytes.subarray(at));
  return messages;
}

/** Message ids the multi-duelist core adds (PLAN.md). The wrapper drops them, so the raw tap reads them. */
export const MSG_DUELIST_ELIMINATED = 200;
export const MSG_ATTACK_DUELIST = 201;
/** Sent instead of MSG_FIELD_DISABLED when there are more than two duelists: `u8 count`, then count x (`u8 duelist`, `u32 mask`). */
export const MSG_FIELD_DISABLED_N = 202;
/** The core closes the named seat's optional response to a departed turn player. */
export const MSG_SURRENDER_WINDOW_CLOSED = 203;

/**
 * The minified wrapper does not know ids 200, 201, 202 and 203. For each one it drops the message and calls
 * `console.warn("failed to parse a message: <id>")` (the parse itself is correct: the layout of the four
 * messages matches the core writer, see the tests). The tap above reads them, so those four warnings are noise
 * at 3 and 4 seats. Run `read` with them removed. Any other warning (also for an unknown id) still passes.
 */
export function withoutDuelistParseWarnings<T>(read: () => T): T {
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    const text = args.length === 1 && typeof args[0] === "string" ? args[0] : null;
    if (text != null && /^failed to parse a message: (200|201|202|203)$/.test(text)) return;
    warn(...args);
  };
  try {
    return read();
  } finally {
    console.warn = warn;
  }
}

export type RawDuelistMessage =
  | { type: typeof MSG_SURRENDER_WINDOW_CLOSED; duelist: number; after: number }
  | { type: typeof MSG_DUELIST_ELIMINATED; duelist: number; reason: number; /** Raw messages of any other id before this one in the buffer. */ after: number }
  | { type: typeof MSG_ATTACK_DUELIST; duelist: number; after: number }
  | { type: typeof MSG_FIELD_DISABLED_N; zones: Array<{ duelist: number; mask: number }>; after: number };

/**
 * Parse the messages with ids 200, 201, 202 and 203 out of one getMessage buffer. Each message is a length
 * prefix, then the id byte, then its body. Any other message only counts toward `after`.
 */
export function parseDuelistMessages(bytes: Uint8Array): { extras: RawDuelistMessage[]; others: number } {
  const extras: RawDuelistMessage[] = [];
  let others = 0;
  for (const message of splitMessages(bytes)) {
    const id = message[0];
    if (id === MSG_DUELIST_ELIMINATED && message.byteLength >= 3) {
      extras.push({ type: MSG_DUELIST_ELIMINATED, duelist: message[1]!, reason: message[2]!, after: others });
    } else if (id === MSG_SURRENDER_WINDOW_CLOSED) {
      if (message.byteLength >= 2) extras.push({ type: MSG_SURRENDER_WINDOW_CLOSED, duelist: message[1]!, after: others });
    } else if (id === MSG_ATTACK_DUELIST && message.byteLength >= 2) {
      extras.push({ type: MSG_ATTACK_DUELIST, duelist: message[1]!, after: others });
    } else if (id === MSG_FIELD_DISABLED_N && message.byteLength >= 2) {
      const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
      const count = message[1]!;
      // A truncated entry list is dropped whole: a half-read mask would show wrong zones.
      if (message.byteLength >= 2 + count * 5) {
        const zones: Array<{ duelist: number; mask: number }> = [];
        for (let index = 0; index < count; index += 1) {
          zones.push({ duelist: message[2 + index * 5]!, mask: view.getUint32(3 + index * 5, true) });
        }
        extras.push({ type: MSG_FIELD_DISABLED_N, zones, after: others });
      }
    } else {
      others += 1;
    }
  }
  return { extras, others };
}
