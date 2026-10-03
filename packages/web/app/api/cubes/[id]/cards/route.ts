import { NextResponse } from "next/server";
import { requireWebAccess } from "@/lib/web-access";
import { cubeWriteAccess } from "@/lib/cube-access";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { createCardCatalogService, createCubeService } from "@yugidraft/shared/services";
import { cubeDetail } from "@/lib/cube-detail";
import { importYdkIntoCube } from "@/lib/cube-ydk";
import { YDK_MAX_CHARS } from "@/lib/ydk-file";

export const runtime = "nodejs";

type Op =
  | { op: "add"; catalogCardId: number; pool: "main" | "extra"; maxCopies?: number }
  | { op: "remove"; catalogCardId: number }
  | { op: "setMaxCopies"; catalogCardId: number; maxCopies: number }
  | { op: "import"; codes: number[]; pool?: "main" | "extra" }
  | { op: "importYdk"; text: string }
  | { op: "seedArchetype"; archetype: string; banlist?: string };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const denied = await cubeWriteAccess(db, cubeId, actor.userId);
  if (denied) return denied;

  const catalog = createCardCatalogService(db);
  const cubes = createCubeService(db, catalog);
  const body = (await request.json().catch(() => ({}))) as Op;

  try {
    switch (body.op) {
      case "add":
        cubes.addCard(cubeId, body.catalogCardId, body.pool, body.maxCopies);
        break;
      case "remove":
        cubes.removeCard(cubeId, body.catalogCardId);
        break;
      case "setMaxCopies":
        cubes.setMaxCopies(cubeId, body.catalogCardId, body.maxCopies);
        break;
      case "import": {
        const codes = Array.isArray(body.codes)
          ? body.codes.filter((n): n is number => Number.isInteger(n))
          : [];
        const result = await cubes.importPasscodes(cubeId, codes, { pool: body.pool });
        return NextResponse.json({ ...cubeDetail(cubeId, cubes, catalog), ...result });
      }
      case "importYdk": {
        if (typeof body.text !== "string" || body.text.trim() === "") {
          return NextResponse.json({ error: "Add a YDK file or paste a deck list." }, { status: 400 });
        }
        if (body.text.length > YDK_MAX_CHARS) {
          return NextResponse.json({ error: "That YDK text is too large." }, { status: 400 });
        }
        // parseDeckText throws on a file with two #deckmaster sections; the catch below sends it as a 400.
        const result = await importYdkIntoCube(cubes, cubeId, body.text);
        if (result.added === 0 && result.unknown.length === 0) {
          return NextResponse.json({ error: "No passcodes found in that YDK text." }, { status: 400 });
        }
        return NextResponse.json({ ...cubeDetail(cubeId, cubes, catalog), ...result });
      }
      case "seedArchetype": {
        const archetype = body.archetype?.trim();
        if (!archetype) {
          return NextResponse.json({ error: "archetype is required" }, { status: 400 });
        }
        const result = await cubes.seedArchetypeInto(cubeId, archetype, { banlist: body.banlist });
        return NextResponse.json({ ...cubeDetail(cubeId, cubes, catalog), ...result });
      }
      default:
        return NextResponse.json({ error: "Unknown op" }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cube update failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json(cubeDetail(cubeId, cubes, catalog));
}
