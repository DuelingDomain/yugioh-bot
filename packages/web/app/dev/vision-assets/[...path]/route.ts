import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { fxLabEnabled } from "@/lib/fx-lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME_TYPES: Record<string, string> = {
  ".md": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".onnx": "application/octet-stream",
  ".bin": "application/octet-stream",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

/** Local, generated assets stay outside public/ so the request-time lab gate always applies. */
export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  if (!fxLabEnabled()) return new Response(null, { status: 404 });

  const { path } = await params;
  if (!path.length || path.some(part => !part || part === "." || part === ".." || /[/\\\0]/.test(part))) {
    return new Response(null, { status: 404 });
  }
  const mime = ["LICENSE", "NOTICE"].includes(path.at(-1)!) ? "text/plain; charset=utf-8" : MIME_TYPES[extname(path.at(-1)!).toLowerCase()];
  if (!mime) return new Response(null, { status: 404 });

  // Next runs with packages/web as cwd; an explicit directory may be absolute or relative to it.
  const dataDir = resolve(process.cwd(), process.env.VISION_DATA_DIR || "../../data/vision");
  let file;
  try {
    const root = await realpath(dataDir);
    const candidate = resolve(root, ...path);
    if (!inside(root, candidate)) return new Response(null, { status: 404 });
    const target = await realpath(candidate);
    if (!inside(root, target)) return new Response(null, { status: 404 });
    // Refuse a final-component symlink introduced between realpath and open, too.
    file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (!stat.isFile()) {
      await file.close();
      return new Response(null, { status: 404 });
    }
    const etag = `"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`;
    const headers = new Headers({
      "Content-Type": mime,
      "Content-Length": String(stat.size),
      "Cache-Control": "public, max-age=3600, must-revalidate",
      "ETag": etag,
      "Last-Modified": stat.mtime.toUTCString(),
      "X-Content-Type-Options": "nosniff",
    });
    if (request.headers.get("if-none-match") === etag) {
      await file.close();
      headers.delete("Content-Length");
      return new Response(null, { status: 304, headers });
    }
    if (request.method === "HEAD") {
      await file.close();
      return new Response(null, { headers });
    }
    const stream = file.createReadStream({ autoClose: true });
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { headers });
  } catch {
    await file?.close().catch(() => {});
    return new Response(null, { status: 404 });
  }
}

export const HEAD = GET;
