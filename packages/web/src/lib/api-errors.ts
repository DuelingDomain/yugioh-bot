import { TournamentRemoteError } from "@yugidraft/shared/services";
import { errorResponseBody } from "@yugidraft/shared/observability";
import { NextResponse } from "next/server";

export function apiErrorResponse(error: unknown, operation: string) {
  if (error instanceof TournamentRemoteError) return NextResponse.json({ error: error.message, code: error.code,
    ...(error.entrants ? { entrants: error.entrants } : {}) }, { status: error.status });
  const { body, status } = errorResponseBody(error, { tags: { operation } });
  return NextResponse.json(body, { status });
}
