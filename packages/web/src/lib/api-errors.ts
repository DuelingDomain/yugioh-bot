import { errorResponseBody } from "@yugidraft/shared/observability";
import { NextResponse } from "next/server";

export function apiErrorResponse(error: unknown, operation: string) {
  const { body, status } = errorResponseBody(error, { tags: { operation } });
  return NextResponse.json(body, { status });
}
