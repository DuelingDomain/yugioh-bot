import { mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ listed: vi.fn() }));
vi.mock("@/lib/remote-duels", () => ({ remoteDuelsForViewer: state.listed }));

let root: string;
let codeDir: string;
let dataDir: string;

async function put(directory: string, path: string, content: string) {
  const file = join(directory, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
  return file;
}

async function get(path: string[], init: RequestInit & { method?: string } = {}) {
  const { GET, HEAD } = await import("../app/dev/vision-assets/[...path]/route");
  const request = new Request(`http://localhost/dev/vision-assets/${path.join("/")}`, init);
  return (init.method === "HEAD" ? HEAD : GET)(request, { params: Promise.resolve({ path }) });
}

beforeEach(async () => {
  vi.resetModules();
  root = await mkdtemp(join(tmpdir(), "vision-assets-"));
  codeDir = join(root, "code");
  dataDir = join(root, "data");
  await mkdir(codeDir);
  await mkdir(dataDir);
  vi.stubEnv("DUEL_FX_LAB", "1");
  vi.stubEnv("VISION_CODE_DIR", codeDir);
  vi.stubEnv("VISION_DATA_DIR", dataDir);
  state.listed.mockReset().mockResolvedValue(true);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe("code files from the web image", () => {
  it("serves worker.js, NOTICE and ort/* from the code directory before the data directory", async () => {
    for (const [directory, label] of [[codeDir, "image"], [dataDir, "volume"]] as const) {
      await put(directory, "worker.js", `worker from ${label}`);
      await put(directory, "NOTICE", `notice from ${label}`);
      await put(directory, "ort/ort-wasm-simd-threaded.mjs", `runtime from ${label}`);
      await put(directory, "ort/LICENSE", `license from ${label}`);
    }
    const worker = await get(["worker.js"]);
    expect(worker.status).toBe(200);
    expect(await worker.text()).toBe("worker from image");
    expect(worker.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(await (await get(["NOTICE"])).text()).toBe("notice from image");
    expect(await (await get(["ort", "ort-wasm-simd-threaded.mjs"])).text()).toBe("runtime from image");
    const license = await get(["ort", "LICENSE"]);
    expect(await license.text()).toBe("license from image");
    expect(license.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  });

  it("always revalidates and sends a strong content ETag, with no mtime-derived headers", async () => {
    await put(codeDir, "worker.js", "export {}");
    const response = await get(["worker.js"]);
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
    expect(response.headers.get("etag")).toMatch(/^"[0-9a-f]{32}"$/);
    expect(response.headers.get("last-modified")).toBeNull();
    expect(response.headers.get("content-length")).toBe("9");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("answers a matching If-None-Match with 304, including a weak form from a compressing proxy", async () => {
    await put(codeDir, "worker.js", "export {}");
    const etag = (await get(["worker.js"])).headers.get("etag")!;
    for (const condition of [etag, `W/${etag}`, `"other", ${etag}`, "*"]) {
      const response = await get(["worker.js"], { headers: { "if-none-match": condition } });
      expect(response.status, condition).toBe(304);
      expect(await response.text()).toBe("");
      expect(response.headers.get("cache-control")).toBe("private, no-cache");
      expect(response.headers.get("etag")).toBe(etag);
      expect(response.headers.get("content-length")).toBeNull();
    }
    const stale = await get(["worker.js"], { headers: { "if-none-match": '"0123456789abcdef0123456789abcdef"' } });
    expect(stale.status).toBe(200);
    expect(await stale.text()).toBe("export {}");
  });

  it("derives the ETag from the contents, not from size or mtime", async () => {
    const first = await put(codeDir, "worker.js", "one");
    await utimes(first, 0, 0);
    const a = (await get(["worker.js"])).headers.get("etag");
    const second = await put(codeDir, "worker.js", "two");
    await utimes(second, 0, 0);
    const b = (await get(["worker.js"])).headers.get("etag");
    expect(b).not.toBe(a);
    // The same bytes with another mtime (a rebuilt image) keep the ETag, so browsers still get a 304.
    await writeFile(second, "one");
    await utimes(second, 1_700_000_000, 1_700_000_000);
    expect((await get(["worker.js"])).headers.get("etag")).toBe(a);
  });

  it("answers HEAD with headers and no body", async () => {
    await put(codeDir, "worker.js", "export {}");
    const response = await get(["worker.js"], { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
    expect(response.headers.get("etag")).toMatch(/^"[0-9a-f]{32}"$/);
  });

  it("falls back to the data directory when the image has no such file, with the data caching rules", async () => {
    await put(dataDir, "worker.js", "worker from volume");
    await put(dataDir, "ort/ort-wasm-simd-threaded.wasm", "wasm from volume");
    const response = await get(["worker.js"]);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("worker from volume");
    expect(response.headers.get("cache-control")).toBe("private, max-age=3600, must-revalidate");
    expect(response.headers.get("etag")).toMatch(/^"[0-9a-f]+-[0-9a-f]+"$/);
    expect(response.headers.get("last-modified")).not.toBeNull();
    const wasm = await get(["ort", "ort-wasm-simd-threaded.wasm"]);
    expect(await wasm.text()).toBe("wasm from volume");
    expect(wasm.headers.get("content-type")).toBe("application/wasm");
  });

  it("falls back to the data directory when no code directory exists, as in local development", async () => {
    vi.stubEnv("VISION_CODE_DIR", join(root, "missing"));
    await put(dataDir, "worker.js", "worker from volume");
    expect(await (await get(["worker.js"])).text()).toBe("worker from volume");
    // The image path is the default and does not exist on a development machine.
    vi.stubEnv("VISION_CODE_DIR", "");
    const response = await get(["worker.js"]);
    expect(await response.text()).toBe("worker from volume");
    expect(response.headers.get("cache-control")).toBe("private, max-age=3600, must-revalidate");
  });

  it("returns 404 when neither directory has the file", async () => {
    expect((await get(["worker.js"])).status).toBe(404);
    expect((await get(["ort", "ort-wasm-simd-threaded.mjs"])).status).toBe(404);
  });

  it("ships the default code directory in the web image at the same path", async () => {
    const { VISION_CODE_DIR_DEFAULT } = await import("../src/lib/vision-assets");
    const parent = dirname(VISION_CODE_DIR_DEFAULT);
    const dockerfile = await readFile(resolve(dirname(fileURLToPath(import.meta.url)), "../../../Dockerfile"), "utf8");
    // The vision-code stage stages the files under /stage<default> and the web stage copies /stage<parent> over <parent>.
    expect(dockerfile).toContain(`VISION_DATA_DIR=/stage${VISION_CODE_DIR_DEFAULT} npx tsx scripts/vision/prepare.ts --code-only`);
    expect(dockerfile).toContain(`COPY --from=vision-code /stage${parent} ${parent}\n`);
  });
});

describe("data files stay in the data volume", () => {
  it("never reads models, indexes or other data from the code directory", async () => {
    await put(codeDir, "models/card-detector.onnx", "planted model");
    await put(codeDir, "yugioh-index.bin", "planted index");
    await put(codeDir, "related-cards.json", "{}");
    for (const path of [["models", "card-detector.onnx"], ["yugioh-index.bin"], ["related-cards.json"]]) {
      expect((await get(path)).status, path.join("/")).toBe(404);
    }
    await put(dataDir, "models/card-detector.onnx", "real model");
    const model = await get(["models", "card-detector.onnx"]);
    expect(await model.text()).toBe("real model");
    expect(model.headers.get("cache-control")).toBe("private, max-age=3600, must-revalidate");
  });

  it("does not treat other top-level names or the models notices as code", async () => {
    await put(codeDir, "worker.js.map", "map");
    await put(codeDir, "models/LICENSE", "planted license");
    await put(codeDir, "ort", "not a directory entry under ort/");
    expect((await get(["worker.js.map"])).status).toBe(404);
    expect((await get(["models", "LICENSE"])).status).toBe(404);
    await put(dataDir, "models/LICENSE", "model license");
    expect(await (await get(["models", "LICENSE"])).text()).toBe("model license");
  });

  it("never serves diagnostics from either directory", async () => {
    await put(dataDir, "diagnostics/field/crop.jpg", "private crop");
    await put(codeDir, "diagnostics/field/crop.jpg", "private crop");
    expect((await get(["diagnostics", "field", "crop.jpg"])).status).toBe(404);
  });
});

describe("path safety applies to both roots", () => {
  it("refuses traversal segments", async () => {
    await put(root, "secret.js", "secret");
    for (const path of [["..", "secret.js"], ["ort", "..", "..", "secret.js"], [".", "worker.js"], ["ort", "", "x.mjs"], ["ort", "a\\b.mjs"], ["ort", "a\0b.mjs"], ["ort/../../secret.js"]]) {
      const response = await get(path);
      expect(response.status, JSON.stringify(path)).toBe(404);
    }
  });

  it("refuses a symlink that leaves the code directory and does not serve its target", async () => {
    await put(root, "outside/ort-wasm-simd-threaded.mjs", "secret");
    await symlink(join(root, "outside"), join(codeDir, "ort"));
    expect((await get(["ort", "ort-wasm-simd-threaded.mjs"])).status).toBe(404);
    await put(codeDir, "worker.js", "ok");
    await symlink(join(root, "outside/ort-wasm-simd-threaded.mjs"), join(codeDir, "NOTICE"));
    expect((await get(["NOTICE"])).status).toBe(404);
  });

  it("refuses a symlink that leaves the data directory", async () => {
    await put(root, "outside/model.onnx", "secret");
    await symlink(join(root, "outside"), join(dataDir, "models"));
    await symlink(join(root, "outside/model.onnx"), join(dataDir, "linked.onnx"));
    expect((await get(["models", "model.onnx"])).status).toBe(404);
    expect((await get(["linked.onnx"])).status).toBe(404);
  });

  it("falls through to the data directory when the code file is an escaping symlink", async () => {
    await put(root, "outside/worker.js", "secret");
    await symlink(join(root, "outside/worker.js"), join(codeDir, "worker.js"));
    await put(dataDir, "worker.js", "worker from volume");
    expect(await (await get(["worker.js"])).text()).toBe("worker from volume");
  });

  it("serves a symlink that stays inside its root", async () => {
    await put(codeDir, "build/worker.js", "inside");
    await symlink(join(codeDir, "build/worker.js"), join(codeDir, "worker.js"));
    expect(await (await get(["worker.js"])).text()).toBe("inside");
  });

  it("does not serve a directory", async () => {
    await mkdir(join(codeDir, "ort", "nested.js"), { recursive: true });
    expect((await get(["ort", "nested.js"])).status).toBe(404);
  });
});

describe("access gate", () => {
  it("still hides code files unless the lab is on or the viewer is listed", async () => {
    await put(codeDir, "worker.js", "export {}");
    vi.stubEnv("DUEL_FX_LAB", "0");
    vi.stubEnv("REMOTE_DUELS", "0");
    expect((await get(["worker.js"])).status).toBe(404);
    vi.stubEnv("REMOTE_DUELS", "1");
    state.listed.mockResolvedValue(false);
    expect((await get(["worker.js"])).status).toBe(404);
    state.listed.mockResolvedValue(true);
    expect((await get(["worker.js"])).status).toBe(200);
  });
});
