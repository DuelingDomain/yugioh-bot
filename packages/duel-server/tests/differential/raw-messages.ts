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
