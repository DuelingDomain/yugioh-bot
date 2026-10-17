import { apiErrorResponse } from "./api-errors";
import { NextResponse } from "next/server";
import { CardFetchLimitError, isCardFetchError } from "@yugidraft/shared/services";

export function cardFetchErrorResponse(error: unknown): Response | undefined {
  if (!isCardFetchError(error)) return;
  if (error instanceof CardFetchLimitError) {
    return NextResponse.json({ error: error.message }, { status: 429, headers: { "Retry-After": String(error.retryAfter) } });
  }
  if (error.status != null && error.status !== 429 && (error.status < 500 || error.status >= 600)) {
    return NextResponse.json({ error: "Unknown set" }, { status: 400 });
  }
  return NextResponse.json({ error: "Card database is unavailable. Try again shortly." }, {
    status: 503, headers: { "Retry-After": String(error.retryAfter ?? 1) },
  });
}

export function withCardFetchErrors<Args extends unknown[]>(handler: (...args: Args) => Promise<Response>) {
  return async (...args: Args): Promise<Response> => {
    try { return await handler(...args); }
    catch (error) {
      const response = cardFetchErrorResponse(error);
      return response ?? apiErrorResponse(error, "[card fetch API]");
    }
  };
}
