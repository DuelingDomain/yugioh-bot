import type createCore from "ocgcore-wasm";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findSyncWasmExport } from "./wasm-sync-export.js";

type Instantiate = (imports: WebAssembly.Imports, callback: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void) => object;

/** Scope automatic and explicit chunk loads separately from runtime callbacks, without changing WASM. */
export function scriptErrorCoreFactory(create: typeof createCore, scope: { enterLoad(): void; leaveLoad(): void }): typeof createCore {
  return ((options: Parameters<typeof createCore>[0] & { instantiateWasm?: Instantiate }) => {
    const name = findSyncWasmExport("_ocgapiLoadScript");
    const instantiateWasm: Instantiate = (imports, callback) => {
      const loaded = (instance: WebAssembly.Instance, module: WebAssembly.Module) => {
        const load = instance.exports[name];
        if (typeof load !== "function") throw new Error(`Core has no script-load export ${name}`);
        const exports = { ...instance.exports };
        exports[name] = (...args: number[]) => {
          scope.enterLoad();
          try { return load(...args); }
          finally { scope.leaveLoad(); }
        };
        callback({ exports } as WebAssembly.Instance, module);
      };
      if (options.instantiateWasm) return options.instantiateWasm(imports, loaded);
      // Legacy Standard uses the exact npm binary that createCore would otherwise instantiate.
      const binary = options.wasmBinary ?? readFileSync(join(dirname(fileURLToPath(import.meta.resolve("ocgcore-wasm"))), "..", "lib", "ocgcore.sync.wasm"));
      const module = new WebAssembly.Module(binary);
      loaded(new WebAssembly.Instance(module, imports), module);
      return {};
    };
    const initializer = { ...options, instantiateWasm };
    return create(initializer);
  }) as unknown as typeof createCore;
}
