import { sectionRoute } from "@/lib/admin-console/section";
import { loadBridges } from "@/lib/admin-console/bridges";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = sectionRoute(loadBridges);
