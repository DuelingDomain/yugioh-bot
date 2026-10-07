import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest, type NextMiddleware, type NextFetchEvent } from "next/server";
import { E2E_SESSION_COOKIE, isE2EAuthEnabled, verifyE2ESession } from "@/lib/e2e-auth";
import { fxLabEnabled, isFxLabPublicPath } from "@/lib/fx-lab";
const PUBLIC = ["/sign-in(.*)", "/sign-up(.*)", "/sso-callback(.*)", "/access", "/login", "/favicon.ico", "/icon.svg", "/apple-icon.png", "/icons/(.*)"];
const isPublic = createRouteMatcher(PUBLIC);
function beforeAuth(request: NextRequest): Response | null {
  const path = request.nextUrl.pathname;
  if (path === "/dev/fx-lab" && !fxLabEnabled()) return new NextResponse(null, { status: 404 });
  if (path.startsWith("/api/test-auth/")) return isE2EAuthEnabled() ? NextResponse.next() : NextResponse.json({ error: "not_found" }, { status: 404 });
  if (isPublic(request) || (path === "/api/waitlist" && request.method === "POST") || (path === "/api/auth/session" && request.method === "GET") || (fxLabEnabled() && isFxLabPublicPath(path))) return NextResponse.next();
  return null;
}
function unauthorized(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL("/sign-in", request.url);
  url.searchParams.set("redirect_url", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(url);
}
// Construct Clerk lazily: an E2E request must never initialize its middleware.
let clerkProxy: NextMiddleware | undefined;
export default async function proxy(request: NextRequest, event: NextFetchEvent) {
  // Disabled test endpoints remain unavailable even when Clerk cannot initialize.
  if (request.nextUrl.pathname.startsWith("/api/test-auth/") && !isE2EAuthEnabled()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (isE2EAuthEnabled()) {
    const early = beforeAuth(request); if (early) return early;
    const id = verifyE2ESession(request.cookies.get(E2E_SESSION_COOKIE)?.value, process.env.E2E_AUTH_SECRET ?? "");
    return id === null ? unauthorized(request) : NextResponse.next();
  }
  clerkProxy ??= clerkMiddleware(async (auth, req) => {
    const early = beforeAuth(req); if (early) return early;
    const { userId } = await auth();
    return userId ? NextResponse.next() : unauthorized(req);
  });
  return clerkProxy(request, event);
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
