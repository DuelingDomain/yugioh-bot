import { NextResponse } from "next/server";
import { requireSandboxActor } from "@/lib/sandbox-access";

export const runtime = "nodejs";

/** Tells the shell whether this developer may see the Sandbox link. */
export async function GET() {
  const actor = await requireSandboxActor();
  if (!actor.ok) {
    actor.response.headers.set("Cache-Control", "no-store");
    return actor.response;
  }
  return NextResponse.json({ allowed: true }, { headers: { "Cache-Control": "no-store" } });
}
