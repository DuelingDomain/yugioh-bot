import { requireSandboxActor } from "@/lib/sandbox-access";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { callDuelHost, duelErrorResponse, requireDuelActor, scenariosEnabled, scenariosOffResponse } from "@/lib/duel-host";

export const runtime = "nodejs";

const MAX_NOTE = 4000;
const MAX_ATTACHMENTS = 1_500_000;

/** Tells the room whether to show the Report button. 404 when DUEL_SCENARIOS is off. No engine call. */
export async function GET() {
  if (!scenariosEnabled()) return scenariosOffResponse();
  return NextResponse.json({ enabled: true });
}

/**
 * Dev only (DUEL_SCENARIOS=1). Body `{ note, attachments? }`. Answers `{ path, attachments, partial? }`: the folder the host wrote, `"written" | "none" | "too-large" | "failed"`, and `partial: true` when the host wrote it without the core (stall).
 * `attachments` (any JSON object, at most 1.5 MB as text) is written next to the host files as
 * `client-attachments.json`. The host op only takes `note`, so the structured form fields travel inside the note text.
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!scenariosEnabled()) return scenariosOffResponse();
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  const { slug } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const note = body && typeof body === "object" ? (body as { note?: unknown }).note : undefined;
  if (typeof note !== "string" || note.length > MAX_NOTE) {
    return NextResponse.json({ error: `note must be text of at most ${MAX_NOTE} characters` }, { status: 400 });
  }

  try {
    // Same access rule as the room: throws when this player may not see the duel.
    const room = actor.duels.room(slug, actor.guildId, actor.playerId);
    if (room.session.sandbox) {
      const sandboxActor = await requireSandboxActor();
      if (!sandboxActor.ok) return sandboxActor.response;
    }
  } catch (error) {
    return duelErrorResponse(error);
  }

  const result = await callDuelHost({ op: "report", slug, note, guildId: actor.guildId, playerId: actor.playerId });
  if (!result.ok) return result.response;
  const data = result.data as { path?: unknown; dir?: unknown; folder?: unknown; partial?: unknown } | null;
  const path = [data?.path, data?.folder, data?.dir].find((v): v is string => typeof v === "string");
  if (!path) return NextResponse.json({ error: "The engine did not return a report folder" }, { status: 502 });
  const attachments = body && typeof body === "object" ? (body as { attachments?: unknown }).attachments : undefined;
  let written: "written" | "none" | "too-large" | "failed" = "none";
  if (attachments !== undefined && attachments !== null) {
    try {
      const text = JSON.stringify(attachments, null, 2);
      if (text.length <= MAX_ATTACHMENTS) {
        writeFileSync(join(path, "client-attachments.json"), text);
        written = "written";
      } else {
        written = "too-large";
      }
    } catch {
      // Best effort: the report folder already exists and holds the note. The answer says the file is missing.
      written = "failed";
    }
  }
  // The host sets `partial` when the core did not answer in time and it wrote the folder without the core.
  return NextResponse.json(data?.partial === true ? { path, attachments: written, partial: true } : { path, attachments: written });
}
