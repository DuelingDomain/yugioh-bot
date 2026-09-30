import { NextResponse } from "next/server";
import { requireDuelActor } from "@/lib/duel-host";

export const runtime = "nodejs";

const MAX_FIELD = 4000;

/** Logs a crash from the duel room's error boundary, so it shows in the web server log. */
export async function POST(request: Request) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // keep empty
  }
  const field = (key: string) => String(body[key] ?? "").slice(0, MAX_FIELD);
  console.error(
    `[duel-client-error] player=${actor.playerId} url=${field("url")} digest=${field("digest")}\n` +
      `message: ${field("message")}\nstack: ${field("stack")}\ncomponentStack: ${field("componentStack")}`,
  );
  return NextResponse.json({ ok: true });
}
