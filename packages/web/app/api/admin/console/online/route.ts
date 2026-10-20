import { sectionRoute } from "@/lib/admin-console/section";
import { loadOnline } from "@/lib/admin-console/online";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = sectionRoute(loadOnline);
