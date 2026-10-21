import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CgroupMetrics, HostMetrics } from "./types.js";

function read(path: string): string | null {
  try { return readFileSync(path, "utf8"); } catch { return null; }
}
function number(value: string | null | undefined): number | null {
  if (!value?.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function fields(text: string | null): Record<string, number> {
  return Object.fromEntries((text ?? "").trim().split("\n").flatMap(line => {
    const [key, raw] = line.trim().split(/[:\s]+/); const n = number(raw);
    return n === null ? [] : [[key, n]];
  }));
}

/** A few small proc reads per minute. No subprocesses or process enumeration. */
export function createHostSampler(procDir = "/proc") {
  let previous: { total: number; idle: number } | null = null;
  return (): HostMetrics => {
    const stat = read(join(procDir, "stat"));
    const cpu = stat?.match(/^cpu\s+(.+)$/m)?.[1].trim().split(/\s+/).slice(0, 8).map(Number);
    let cpuPercent: number | null = null;
    if (cpu && cpu.length >= 4 && cpu.every(Number.isFinite)) {
      // guest/guest_nice are already included in user/nice; do not count them twice.
      const total = cpu.reduce((a, b) => a + b, 0), idle = cpu[3] + (cpu[4] ?? 0);
      if (previous && total > previous.total && idle >= previous.idle) cpuPercent = Math.max(0, Math.min(100, 100 * (1 - (idle - previous.idle) / (total - previous.total))));
      previous = { total, idle };
    } else previous = null;
    const mem = fields(read(join(procDir, "meminfo")));
    const total = mem.MemTotal, available = mem.MemAvailable;
    const memory = total > 0 && available >= 0 && available <= total ? {
      usedBytes: (total - available) * 1024, availableBytes: available * 1024, totalBytes: total * 1024, usedPercent: 100 * (1 - available / total),
    } : null;
    const load = read(join(procDir, "loadavg"))?.trim().split(/\s+/).slice(0, 3).map(Number);
    return {
      cpuPercent, vcpuCount: stat ? stat.match(/^cpu\d+\s/gm)?.length ?? null : null,
      load: load?.length === 3 && load.every(n => Number.isFinite(n) && n >= 0) ? load as [number, number, number] : null,
      memory, swap: mem.SwapTotal >= 0 && mem.SwapFree >= 0 && mem.SwapFree <= mem.SwapTotal ? { totalBytes: mem.SwapTotal * 1024, usedBytes: (mem.SwapTotal - mem.SwapFree) * 1024 } : null,
      uptimeSeconds: number(read(join(procDir, "uptime"))?.split(" ")[0]),
    };
  };
}

/** Resolve only this process's unified cgroup, including native systemd services. */
export function createCgroupSampler(procDir = "/proc", cgroupDir = "/sys/fs/cgroup") {
  let previous: { at: number; usage: number; identity: string } | null = null;
  return (at = Date.now()): CgroupMetrics | null => {
    const member = read(join(procDir, "self/cgroup"))?.match(/^0::(.*)$/m)?.[1];
    if (member === undefined || member.split("/").includes("..")) return null;
    // Interactive login scopes can contain every local dev service. Never label
    // that shared scope's totals as the memory/CPU of each individual service.
    const dedicatedService = member.split("/").at(-1)?.endsWith(".service");
    const container = /(?:^|\/)(?:docker[-/]|libpod-|cri-containerd-|kubepods)/.test(member);
    if (member !== "/" && !dedicatedService && !container) return null;
    const directory = resolve(cgroupDir, `.${member}`);
    if (directory !== resolve(cgroupDir) && !directory.startsWith(`${resolve(cgroupDir)}/`)) return null;
    const memoryBytes = number(read(join(directory, "memory.current")));
    // The host root cgroup has no memory.current; its cpu.stat is host-wide.
    if (member === "/" && memoryBytes === null) return null;
    const memoryLimitBytes = number(read(join(directory, "memory.max")));
    const events = fields(read(join(directory, "memory.events")));
    const cpuUsageUsec = fields(read(join(directory, "cpu.stat"))).usage_usec ?? null;
    if (memoryBytes === null && cpuUsageUsec === null) { previous = null; return null; }
    let identity: string;
    try { identity = `${statSync(directory).ino}`; } catch { previous = null; return null; }
    let cpuPercent: number | null = null;
    if (previous && previous.identity === identity && cpuUsageUsec !== null && at > previous.at && cpuUsageUsec >= previous.usage) {
      cpuPercent = (cpuUsageUsec - previous.usage) / ((at - previous.at) * 10);
    }
    previous = cpuUsageUsec === null ? null : { at, usage: cpuUsageUsec, identity };
    return { memoryBytes, memoryLimitBytes, oomKills: events.oom_kill ?? null, cpuUsageUsec, cpuPercent };
  };
}
