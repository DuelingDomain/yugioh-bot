import { sectionRoute } from "@/lib/admin-console/section";
import { loadToday } from "@/lib/admin-console/today";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = sectionRoute(loadToday);
