import { extname } from "node:path";
import { Readable } from "node:stream";
import { fxLabEnabled, visionAssetsEnabled } from "@/lib/fx-lab";
import { remoteDuelsForViewer } from "@/lib/remote-duels";
import { contentEtag, etagMatches, openVisionAsset, statEtag } from "@/lib/vision-assets";

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

/**
 * Generated assets stay outside public/ so the request-time lab gate always applies. worker.js, NOTICE and ort/* come
 * from the web image (VISION_CODE_DIR); everything else, and those three when the image lacks them, from VISION_DATA_DIR.
 */
export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  if (!visionAssetsEnabled()) return new Response(null, { status: 404 });
  // Outside the public lab these files belong to Remote Duels, so the rollout list applies.
  if (!fxLabEnabled() && !await remoteDuelsForViewer()) return new Response(null, { status: 404 });

  const { path } = await params;
  if (!path.length || path.some(part => !part || part === "." || part === ".." || /[/\\\0]/.test(part))) {
    return new Response(null, { status: 404 });
  }
  // Owner diagnostic crops share DATA, but are never public model/lab assets.
  if (path[0] === "diagnostics") return new Response(null, { status: 404 });
  const mime = ["LICENSE", "NOTICE"].includes(path.at(-1)!) ? "text/plain; charset=utf-8" : MIME_TYPES[extname(path.at(-1)!).toLowerCase()];
  if (!mime) return new Response(null, { status: 404 });

  let asset;
  try {
    asset = await openVisionAsset(path);
    if (!asset) return new Response(null, { status: 404 });
    const { file, stat, code } = asset;
    // Code ships with the image: a content hash and a revalidation on every load put a new image in front of browsers
    // without a ?v= bump. Data files keep the longer cache; the manual copy preserves their mtimes.
    const etag = code ? await contentEtag(asset) : statEtag(stat);
    const headers = new Headers({
      "Content-Type": mime,
      "Content-Length": String(stat.size),
      "Cache-Control": code ? "private, no-cache" : "private, max-age=3600, must-revalidate",
      "ETag": etag,
      "X-Content-Type-Options": "nosniff",
    });
    if (!code) headers.set("Last-Modified", stat.mtime.toUTCString());
    if (etagMatches(request.headers.get("if-none-match"), etag)) {
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
    await asset?.file.close().catch(() => {});
    return new Response(null, { status: 404 });
  }
}

export const HEAD = GET;
