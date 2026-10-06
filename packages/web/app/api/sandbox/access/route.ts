import { NextResponse } from "next/server";
import { requireSandboxActor } from "@/lib/sandbox-access";

export const runtime = "nodejs";

/** Tells the shell whether to show the Sandbox link. Always 200 with `{ admin }` so a member sees no error. */
export async function GET() {
  const actor = await requireSandboxActor();
  return NextResponse.json({ admin: actor.ok }, { headers: { "Cache-Control": "no-store" } });
}
