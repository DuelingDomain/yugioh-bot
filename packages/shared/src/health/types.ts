export const SERVICE_IDS = ["ws", "duel", "web", "worker", "caddy"] as const;
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
  cgroup: CgroupMetrics | null;
  capacity?: Capacity;
}
export interface HostMetrics {
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
  incomplete: string[];
  stale: boolean;
}
