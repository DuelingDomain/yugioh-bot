import { sectionRoute } from "@/lib/admin-console/section";
import { loadLive } from "@/lib/admin-console/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = sectionRoute(loadLive);
