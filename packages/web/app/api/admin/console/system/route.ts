import { sectionRoute } from "@/lib/admin-console/section";
import { loadSystem } from "@/lib/admin-console/system";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = sectionRoute(loadSystem);
