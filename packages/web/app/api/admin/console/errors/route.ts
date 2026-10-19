import { sectionRoute } from "@/lib/admin-console/section";
import { loadErrors } from "@/lib/admin-console/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = sectionRoute(loadErrors);
