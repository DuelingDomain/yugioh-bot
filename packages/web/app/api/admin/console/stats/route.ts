import { sectionRoute } from "@/lib/admin-console/section";
import { loadStats } from "@/lib/admin-console/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = sectionRoute(loadStats);
