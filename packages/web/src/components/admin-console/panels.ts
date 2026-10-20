import type { ComponentType } from "react";
import type { SectionId } from "@/lib/admin-console/types";
import { OnlinePanel } from "./panels/online-panel";
import { WaitlistPanel } from "./panels/waitlist-panel";
import { LivePanel } from "./panels/live-panel";
import { StatsPanel } from "./panels/stats-panel";
import { ErrorsPanel } from "./panels/errors-panel";
import { UsagePanel } from "./panels/usage-panel";
import { SystemPanel } from "./panels/system-panel";

/** One panel component per section. Each lives in its own file under ./panels. */
export const PANELS: Record<SectionId, ComponentType> = {
  online: OnlinePanel, waitlist: WaitlistPanel, live: LivePanel, stats: StatsPanel,
  errors: ErrorsPanel, usage: UsagePanel, system: SystemPanel,
};
