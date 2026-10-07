import { vi } from "vitest";
import { EMPTY_OPEN_NOW, type OpenNow } from "@/lib/open-now";

export const OPEN_TOURNAMENT = { slug: "spring-cup", name: "Spring Cup", format: "round_robin", joinedCount: 3, viewerJoined: false };
export const OPEN_DRAFT = { slug: "cube-night", name: "Cube night", mode: "cube", seatsTaken: 4, seatCount: 8, viewerJoined: false };

/** Answer GET /api/lobby/open with `data`, or with a failure status when `data` is a number. Other URLs 404. */
export function stubOpenNow(data: OpenNow | number | "throw" = EMPTY_OPEN_NOW) {
  const fetchMock = vi.fn(async (url: string) => {
    if (!String(url).startsWith("/api/lobby/open")) return new Response("{}", { status: 404 });
    if (data === "throw") throw new TypeError("network down");
    if (typeof data === "number") return new Response("{}", { status: data });
    return Response.json(data);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
