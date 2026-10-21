export const SERVICE_IDS = ["ws", "duel", "web", "worker"] as const;
export type ServiceId = typeof SERVICE_IDS[number];
export interface CgroupMetrics {
  memoryBytes: number | null;
  memoryLimitBytes: number | null;
  oomKills: number | null;
  cpuUsageUsec: number | null;
  /** 100% means one logical CPU, so multi-core usage can exceed 100%. */
  cpuPercent: number | null;
}
export interface Capacity {
  engineWorkers?: number;
  maxWorkers?: number;
  queuedRebuilds?: number;
  connectedSockets?: number;
}
export interface ServiceReport {
  at: number;
  instance: string;
  /** First report after an observed instance change, carried forward across ticks. */
  restartedAt?: number;
  cgroup: CgroupMetrics | null;
  capacity?: Capacity;
}
export interface HostMetrics {
  /** Host-wide cumulative /proc/vmstat oom_kill counter; not a cgroup counter. */
  oomKills: number | null;
  cpuPercent: number | null;
  vcpuCount: number | null;
  load: [number, number, number] | null;
  memory: { usedBytes: number; availableBytes: number; totalBytes: number; usedPercent: number } | null;
  swap: { usedBytes: number; totalBytes: number } | null;
  uptimeSeconds: number | null;
}
export interface HealthSample {
  at: number;
  host: HostMetrics;
  /** Kills since the preceding sample, accumulated when replacing the same minute. */
  oomKillDelta: number | null;
  services: Record<ServiceId, ServiceReport | null>;
  activity: { guildId: string; liveDuels: number; liveDrafts: number } | null;
}
export interface HealthPoint {
  at: number;
  cpuPercent: number | null;
  ramPercent: number | null;
  load1: number | null;
  engineWorkers: number | null;
}
export interface VpsHealth {
  current: HealthSample | null;
  history: HealthPoint[];
  status: "OK" | "High" | "Upgrade soon" | null;
  reasons: string[];
  restarts: Partial<Record<ServiceId, number>>;
  incomplete: string[];
  stale: boolean;
}
