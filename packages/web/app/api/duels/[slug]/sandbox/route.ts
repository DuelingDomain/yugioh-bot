import { SANDBOX_OPS } from "@yugidraft/shared/duels";
import { NextResponse } from "next/server";
import { callDuelHost } from "@/lib/duel-host";
import {
  parseSandboxId, readSandboxBody, requireSandboxActor, sandboxBodyOptions, sandboxQueryOptions,
  sandboxErrorResponse, SandboxRequestError,
} from "@/lib/sandbox-access";

export const runtime = "nodejs";
type Context = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, { params }: Context) {
  const actor = await requireSandboxActor();
  if (!actor.ok) return actor.response;
  try {
    const { slug } = await params;
    const result = await callDuelHost({ op: SANDBOX_OPS.info, slug, guildId: actor.guildId, playerId: actor.playerId });
    return result.ok ? NextResponse.json(result.data) : result.response;
  } catch (error) {
    return sandboxErrorResponse(error);
  }
}

/** The host checks sandbox/organizer access and owns engine changes; the scenario service owns saves. */
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
        input = { ...common, op: SANDBOX_OPS.control, seat: body.seat, control: body.control };
        break;
      }
      case "eliminate":
        if (typeof body.seat !== "number" || !Number.isInteger(body.seat) || body.seat < 0 || body.seat > 3) {
          throw new SandboxRequestError("seat must be a seat from 0 to 3");
        }
        input = { ...common, op: SANDBOX_OPS.eliminate, seat: body.seat };
        break;
      case "snapshot":
        input = { ...common, op: SANDBOX_OPS.snapshot };
        break;
      case "save-state": {
        // Match the numeric scenarioId used by start; never treat a bad id as a new save.
        if (body.scenarioId !== undefined && typeof body.scenarioId !== "number") {
          throw new SandboxRequestError("Scenario id must be a positive integer");
        }
        const scenarioId = body.scenarioId === undefined ? undefined : parseSandboxId(body.scenarioId);
        const result = await callDuelHost({ ...common, op: SANDBOX_OPS.snapshot });
        if (!result.ok) return result.response;
        const snapshot = result.data;
        if (!snapshot || typeof snapshot !== "object" || !("board" in snapshot) || !("run" in snapshot)
          || !("lost" in snapshot) || !Array.isArray(snapshot.lost)
          || !snapshot.lost.every((loss: unknown) => typeof loss === "string")) {
          throw new SandboxRequestError("Invalid engine snapshot", 502);
        }
        const write = { name: body.name, board: snapshot.board, run: snapshot.run };
        const scenario = scenarioId === undefined
          ? actor.scenarios.create(actor.guildId, actor.playerId, write)
          : actor.scenarios.update(scenarioId, actor.guildId, actor.playerId, write);
        return NextResponse.json({ scenario: { id: scenario.id, name: scenario.name }, lost: snapshot.lost });
      }
      case "close":
        input = { ...common, op: SANDBOX_OPS.close };
        break;
      case "restart":
        input = { ...common, op: SANDBOX_OPS.restart };
        break;
      case "go-to-phase":
        if (typeof body.phase !== "string" || !["draw", "standby", "main1", "battle", "main2", "end"].includes(body.phase)) {
          throw new SandboxRequestError("phase must be draw, standby, main1, battle, main2 or end");
        }
        input = { ...common, op: SANDBOX_OPS.phase, to: body.phase };
        break;
      case "next-turn":
        input = { ...common, op: SANDBOX_OPS.nextTurn };
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
