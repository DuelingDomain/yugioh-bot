import { NextResponse } from "next/server";
import { requireWebAccess } from "@/lib/web-access";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { createCardCatalogService, createCubeService } from "@yugidraft/shared/services";
import { serializeYdk, ydkFileName } from "@/lib/ydk-file";

export const runtime = "nodejs";

/** The cube as a `<cube name>.ydk` download. Anyone on the server can read a cube, so anyone can export it. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireWebAccess();
  if (!actor.ok) return actor.response;
  if (!env.discordGuildId) {
    return NextResponse.json({ error: "Server not configured for cubes" }, { status: 500 });
  }
  const { id } = await params;
  const cubeId = Number(id);
  if (!Number.isInteger(cubeId)) {
    return NextResponse.json({ error: "Invalid cube id" }, { status: 400 });
  }

  const db = getDb();
  const cube = db.prepare("select name from cubes where id = ? and guild_id = ?").get(cubeId, env.discordGuildId) as
    | { name: string }
    | undefined;
  if (!cube) {
    return NextResponse.json({ error: "Cube not found" }, { status: 404 });
  }

  const pools = createCubeService(db, createCardCatalogService(db)).getCubePools(cubeId);
  const fileName = ydkFileName(cube.name);
  // The plain name is an ASCII fallback; browsers read the UTF-8 name from filename*.
  const encoded = encodeURIComponent(fileName).replace(/['()*!]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  return new NextResponse(serializeYdk(pools.main, pools.extra), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`,
      "Cache-Control": "no-store",
    },
  });
}
