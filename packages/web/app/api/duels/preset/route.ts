import { NextResponse } from "next/server";
import { callDuelHost, requireDuelActor, scenariosEnabled, scenariosOffResponse } from "@/lib/duel-host";

export const runtime = "nodejs";

/** Dev only (DUEL_SCENARIOS=1). Lists the scenario presets the duel host knows. */
export async function GET() {
  if (!scenariosEnabled()) return scenariosOffResponse();
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  const result = await callDuelHost({ op: "list-presets", guildId: actor.guildId, playerId: actor.playerId });
  if (!result.ok) return result.response;
  const data = result.data as { presets?: unknown; core?: unknown } | null;
  const core = data?.core && typeof data.core === "object" ? (data.core as { tag?: unknown; sha?: unknown }) : null;
  return NextResponse.json({
    presets: Array.isArray(data?.presets) ? data.presets : [],
    core: {
      tag: typeof core?.tag === "string" ? core.tag : null,
      sha: typeof core?.sha === "string" ? core.sha : null,
    },
  });
}

/**
 * The optional seed: four decimal numbers (numbers or decimal strings), or one number that we spread into four
 * (the same spread the e2e runner uses). Returns the four strings, null when there is no seed, or undefined when it is invalid.
 */
function parseSeed(value: unknown): string[] | null | undefined {
  if (value === undefined || value === null) return null;
  const decimal = (item: unknown): string | null => {
    if (typeof item === "number") return Number.isSafeInteger(item) && item >= 0 ? String(item) : null;
    if (typeof item === "string" && /^\d{1,20}$/.test(item.trim())) return item.trim();
    return null;
  };
  if (Array.isArray(value)) {
    if (value.length !== 4) return undefined;
    const parts = value.map(decimal);
    return parts.every((part): part is string => part !== null) ? parts : undefined;
  }
  const single = decimal(value);
  if (single === null || single.length > 15) return undefined;
  const n = BigInt(single);
  return [n, n * 7n + 1n, n * 13n + 2n, n * 31n + 3n].map(String);
}

/** Dev only. Body `{ presetId, seed? }`. Answers `{ slug }` of the new duel. */
export async function POST(request: Request) {
  if (!scenariosEnabled()) return scenariosOffResponse();
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const presetId = body && typeof body === "object" ? (body as { presetId?: unknown }).presetId : undefined;
  if (typeof presetId !== "string" || !presetId.trim() || presetId.length > 100) {
    return NextResponse.json({ error: "presetId is required" }, { status: 400 });
  }

  const seed = parseSeed((body as { seed?: unknown }).seed);
  if (seed === undefined) {
    return NextResponse.json({ error: "seed must be one number or four decimal numbers" }, { status: 400 });
  }

  const result = await callDuelHost({ op: "start-preset", presetId, ...(seed ? { seed } : {}), guildId: actor.guildId, playerId: actor.playerId });
  if (!result.ok) return result.response;
  const data = result.data as { slug?: unknown; session?: { slug?: unknown } } | null;
  const slug = typeof data?.slug === "string" ? data.slug : data?.session?.slug;
  if (typeof slug !== "string" || !slug) {
    return NextResponse.json({ error: "The engine did not return a duel" }, { status: 502 });
  }
  return NextResponse.json({ slug });
}
