import { listOnline } from "@yugidraft/shared/admin";
import { getDb } from "@/lib/db";
import { ok, type SectionLoader } from "./section";

export const loadOnline: SectionLoader<"online"> = async ({ now }) => ok(listOnline(getDb(), now), now);
