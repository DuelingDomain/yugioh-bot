import { sectionRoute } from "@/lib/admin-console/section";
import { loadUsage } from "@/lib/admin-console/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = sectionRoute(loadUsage);
