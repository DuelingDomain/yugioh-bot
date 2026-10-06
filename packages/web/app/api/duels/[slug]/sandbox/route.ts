import { NextResponse } from "next/server";
import { callDuelHost } from "@/lib/duel-host";
import {
  readSandboxBody, requireSandboxActor, sandboxBodyOptions, sandboxQueryOptions,
  sandboxErrorResponse, SandboxRequestError,
} from "@/lib/sandbox-access";

export const runtime = "nodejs";
type Context = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, { params }: Context) {
  const actor = await requireSandboxActor();
  if (!actor.ok) return actor.response;
  try {
    const { slug } = await params;
    const result = await callDuelHost({ op: "sandbox-info", slug, guildId: actor.guildId, playerId: actor.playerId });
    return result.ok ? NextResponse.json(result.data) : result.response;
  } catch (error) {
    return sandboxErrorResponse(error);
  }
}

/** B7 owns all engine movement and organizer/seat checks. These are thin signed calls. */
export async function POST(request: Request, { params }: Context) {
  const actor = await requireSandboxActor();
  if (!actor.ok) return actor.response;
  try {
    const { slug } = await params;
    const body = await readSandboxBody(request);
    const common = {
      slug, guildId: actor.guildId, playerId: actor.playerId,
      ...sandboxQueryOptions(request), ...sandboxBodyOptions(body),
    };
    let input: Parameters<typeof callDuelHost>[0];
    switch (body.action) {
      case "control": {
        if (typeof body.seat !== "number" || !Number.isInteger(body.seat) || body.seat < 1 || body.seat > 3) {
          throw new SandboxRequestError("seat must be a bot seat from 1 to 3");
        }
        if (body.control !== "pass" && body.control !== "practice" && body.control !== "manual") {
          throw new SandboxRequestError("control must be pass, practice or manual");
        }
        input = { ...common, op: "sandbox-control", seat: body.seat, control: body.control };
        break;
      }
      case "restart":
        input = { ...common, op: "sandbox-restart" };
        break;
      case "go-to-phase":
        if (typeof body.phase !== "string" || !["draw", "standby", "main1", "battle", "main2", "end"].includes(body.phase)) {
          throw new SandboxRequestError("phase must be draw, standby, main1, battle, main2 or end");
        }
        input = { ...common, op: "sandbox-go-to-phase", phase: body.phase };
        break;
      case "next-turn":
        input = { ...common, op: "sandbox-next-turn" };
        break;
      default:
        throw new SandboxRequestError("Unknown sandbox action");
    }
    const result = await callDuelHost(input);
    return result.ok ? NextResponse.json(result.data) : result.response;
  } catch (error) {
    return sandboxErrorResponse(error);
  }
}
