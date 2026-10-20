import { sectionRoute } from "@/lib/admin-console/section";
import { loadWaitlist } from "@/lib/admin-console/waitlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = sectionRoute(loadWaitlist);
