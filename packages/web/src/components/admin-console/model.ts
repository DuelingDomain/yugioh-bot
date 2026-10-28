import { maskEmail, plural } from "@/lib/admin-console/format";
import { formatWeekdayDate } from "@/lib/admin-console/time";
import type {
  ErrorIssue, LiveData, OnlineData, OnlinePerson, SectionDataMap, SectionId, SectionResult, ServiceHealth, StatsData, SystemData, WaitlistData,
} from "@/lib/admin-console/types";
import type { SectionSnapshot } from "./use-admin-section";
import type { IconName, Tone } from "./parts";

export const VIEWS = ["overview", "people", "duels", "waitlist", "creators", "health", "insights"] as const;
export type View = (typeof VIEWS)[number];
export const VIEW_META: Record<View, { label: string; icon: IconName }> = {
  overview: { label: "Overview", icon: "overview" }, people: { label: "People", icon: "people" }, duels: { label: "Duels", icon: "duels" },
  waitlist: { label: "Waitlist", icon: "waitlist" }, creators: { label: "Creators", icon: "creators" }, health: { label: "Health", icon: "health" }, insights: { label: "Insights", icon: "insights" },
};
export const isView = (value: string): value is View => (VIEWS as readonly string[]).includes(value);
/** Link target of the Today list in the Duels view (/admin#duels-today). */
export const TODAY_ANCHOR = "duels-today";

export type Snapshots = { [K in Exclude<SectionId, "bridges">]: SectionSnapshot<K> };

/** The data of a section when it answered "ok", else null. */
export function okData<K extends SectionId>(snapshot: SectionSnapshot<K>): SectionDataMap[K] | null {
  const result = snapshot.result as SectionResult<SectionDataMap[K]> | null;
  return result?.state === "ok" ? result.data : null;
}

export function liveCounts(live: LiveData | null) {
  const duels = live?.duels.filter((d) => d.status === "active") ?? [];
  const drafts = live?.drafts.filter((d) => d.status === "active") ?? [];
  return {
    duels, drafts,
    lobbies: live?.duels.filter((d) => d.status === "lobby").length ?? 0,
    draftLobbies: live?.drafts.filter((d) => d.status === "pending").length ?? 0,
  };
}

export type PersonKind = "duel" | "draft" | "other";
export function kindOf(person: OnlinePerson): PersonKind {
  return person.current?.kind ?? "other";
}

const DAY_MS = 24 * 60 * 60 * 1000;
export function isNewIssue(issue: ErrorIssue, now: number): boolean {
  const first = issue.firstSeen ? Date.parse(issue.firstSeen) : NaN;
  return Number.isFinite(first) && now - first < DAY_MS;
}

export const SERVICE_TONE: Record<ServiceHealth["state"], Tone> = { up: "good", stale: "warn", down: "crit", "not-deployed": "quiet", "not-configured": "quiet" };
export const SERVICE_WORD: Record<ServiceHealth["state"], string> = { up: "Healthy", stale: "Late", down: "Down", "not-deployed": "Not deployed", "not-configured": "Not set up" };

/** Services that run here (not "not deployed"), and how many of them are up. */
export function serviceSummary(system: SystemData | null) {
  const services = (system?.services ?? []).filter((s) => s.state !== "not-deployed");
  const up = services.filter((s) => s.state === "up").length;
  const failing = services.some((s) => s.state === "down") || system?.disk?.tone === "fail";
  return { services, up, total: services.length, problems: system?.problems ?? 0, failing };
}

export interface Alert {
  key: string;
  tone: Tone;
  title: string;
  detail: string;
  at: number | null;
  action: { label: string; view?: View; href?: string };
}

/** Everything that needs the owner, worst first. */
export function alertsFor(s: Snapshots, now: number): Alert[] {
  const alerts: Alert[] = [];
  const errors = okData(s.errors);
  const system = okData(s.system);
  const waitlist = okData(s.waitlist);

  for (const issue of (errors?.issues ?? []).filter((i) => isNewIssue(i, now)).slice(0, 2)) {
    const people = issue.users ? ` · ${plural(issue.users, "person", "people")} affected` : "";
    alerts.push({
      key: `issue-${issue.id}`, tone: "crit", title: `New error: ${issue.title}`,
      detail: `${plural(issue.count, "event", "events")} in the last 24 h${people}${issue.project ? ` · ${issue.project}` : ""}`,
      at: Date.parse(issue.lastSeen) || null, action: { label: "View errors", view: "insights" },
    });
  }
  for (const service of system?.services ?? []) {
    if (service.state !== "down" && service.state !== "stale") continue;
    alerts.push({
      key: `svc-${service.id}`, tone: service.state === "down" ? "crit" : "warn",
      title: service.state === "down" ? `${service.label} is down` : `${service.label} is late`,
      detail: service.detail, at: service.lastBeatAt ?? null, action: { label: "View health", view: "health" },
    });
  }
  if (system?.disk && system.disk.tone !== "ok") {
    const days = system.disk.trend?.daysUntilFull;
    alerts.push({
      key: "disk", tone: system.disk.tone === "fail" ? "crit" : "warn", title: `Disk is ${Math.round(system.disk.usedPercent)}% full`,
      detail: days !== null && days !== undefined ? `About ${plural(days, "day", "days")} until full at the current rate.` : "Free space is getting low.",
      at: null, action: { label: "View health", view: "health" },
    });
  }
  if (system?.cardData?.state === "behind") {
    alerts.push({ key: "cards", tone: "warn", title: "Card data is behind", detail: system.cardData.headline, at: null, action: { label: "View health", view: "health" } });
  }
  for (const [id, label] of [["errors", "Sentry"], ["usage", "PostHog"], ["waitlist", "Clerk"]] as const) {
    const result = s[id].result;
    if (result?.state === "error") alerts.push({ key: `fail-${id}`, tone: "warn", title: `${label} did not answer`, detail: result.message, at: result.updatedAt, action: { label: "Open", view: id === "waitlist" ? "waitlist" : "insights" } });
  }
  if (waitlist && waitlist.pending > 0) {
    const first = waitlist.entries.slice(0, 2).map((e) => maskEmail(e.email));
    const more = waitlist.pending - first.length;
    alerts.push({
      key: "waitlist", tone: "info", title: `${plural(waitlist.pending, "person waits", "people wait")} for approval`,
      detail: `${first.join(" and ")}${more > 0 ? ` and ${more} more` : ""} asked to join.`,
      at: waitlist.entries[waitlist.entries.length - 1]?.createdAt ?? null, action: { label: "Review", view: "waitlist" },
    });
  }
  return alerts;
}

/** Change against a base: "↑ 6", "↓ 2", "no change". */
export function delta(current: number, base: number, percent = false): { text: string; dir: "up" | "down" | "flat" } {
  if (percent) {
    if (base <= 0) return current > 0 ? { text: "new", dir: "up" } : { text: "no change", dir: "flat" };
    const pct = Math.round(((current - base) / base) * 100);
    return pct === 0 ? { text: "no change", dir: "flat" } : { text: `${pct > 0 ? "↑" : "↓"} ${Math.abs(pct)}%`, dir: pct > 0 ? "up" : "down" };
  }
  const diff = current - base;
  return diff === 0 ? { text: "no change", dir: "flat" } : { text: `${diff > 0 ? "↑" : "↓"} ${Math.abs(diff)}`, dir: diff > 0 ? "up" : "down" };
}

/** Average of the six full days before today. */
export function weekAverage(stats: StatsData, key: keyof StatsData["series"]): number {
  const before = stats.series[key].slice(0, -1);
  return before.length ? before.reduce((a, b) => a + b, 0) / before.length : 0;
}

/** "13 Oct" from the Eastern day key "2026-10-13". The key is a plain calendar date, so it is read as UTC midnight to keep the day from shifting. */
export function shortDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : day;
}

export interface HeaderText { eyebrow: string; title: string; em?: string; sub: string }

export function headerFor(view: View, s: Snapshots, now: number): HeaderText {
  const online = okData(s.online) as OnlineData | null;
  const live = liveCounts(okData(s.live));
  const waitlist = okData(s.waitlist) as WaitlistData | null;
  const system = okData(s.system);
  const health = serviceSummary(system);
  const day = formatWeekdayDate(now);
  const count = online?.count ?? 0;
  switch (view) {
    case "overview": {
      const alerts = alertsFor(s, now).filter((a) => a.tone !== "info").length;
      return {
        eyebrow: `Overview · ${day}`, title: `${plural(count, "person", "people")} online,`, em: ` ${plural(live.duels.length, "duel", "duels")} live`,
        sub: alerts === 0 ? "Nothing needs a look. All services run normally." : `${plural(alerts, "thing needs", "things need")} a look. Details are below.`,
      };
    }
    case "people":
      return { eyebrow: "People", title: `${count.toLocaleString("en-US")} online now`, sub: "Select a person to see where they are and what they did last." };
    case "duels":
      return {
        eyebrow: "Duels and drafts", title: `${plural(live.duels.length, "duel", "duels")} and ${plural(live.drafts.length, "draft", "drafts")} live`,
        sub: "Open any table as a spectator. Below the live tables, every duel of today with its result and replay.",
      };
    case "waitlist": {
      const n = waitlist?.pending ?? 0;
      return {
        eyebrow: "Waitlist", title: n ? `${plural(n, "person", "people")} waiting` : "Nobody is waiting",
        sub: "Approve sends the invite email and opens sign-up for that person.",
      };
    }
    case "creators": {
      const data = okData(s.creators);
      const creators = data?.creators ?? [];
      const signedUp = creators.reduce((sum, c) => sum + c.signedUp, 0);
      return {
        eyebrow: "Creators",
        title: data ? `${plural(creators.length, "creator", "creators")}, ${plural(signedUp, "sign-up", "sign-ups")}` : "Creators",
        sub: "A creator link or email lets people skip the waitlist. Clerk sends each invite by email.",
      };
    }
    case "health": {
      const disk = system?.disk;
      const days = disk?.trend?.daysUntilFull;
      const parts = [
        health.problems === 0 ? "All services run normally." : `${plural(health.problems, "problem needs", "problems need")} a look.`,
        days !== null && days !== undefined ? `Disk has about ${plural(days, "day", "days")} left at the current rate.` : disk ? `Disk is ${Math.round(disk.usedPercent)}% used.` : "",
      ];
      return { eyebrow: "Health", title: health.total ? `${health.up} of ${health.total} services healthy` : "Services", sub: parts.filter(Boolean).join(" ") };
    }
    case "insights":
      return {
        eyebrow: "Insights", title: "Last 7 days",
        sub: "Sign-ups, activity, errors and traffic from the app, Sentry and PostHog.",
      };
  }
}
