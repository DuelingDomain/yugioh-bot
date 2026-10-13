import { isIP } from "node:net";

/** Caddy replaces this header; web stays private behind the proxy. */
export function clientIpKey(request: Request): string {
  const ip = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim().slice(0, 128) || "unknown";
  if (isIP(ip) !== 6) return ip;
  const address = ip.split("%", 1)[0]!;
  const hex = address.replace(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/, (_, a, b, c, d) =>
    `${((Number(a) << 8) | Number(b)).toString(16)}:${((Number(c) << 8) | Number(d)).toString(16)}`);
  const [left, right] = hex.split("::");
  const start = left ? left.split(":") : [];
  const end = right ? right.split(":") : [];
  const groups = (right === undefined ? start : [...start, ...Array<string>(8 - start.length - end.length).fill("0"), ...end])
    .map(part => parseInt(part, 16));
  if (groups.slice(0, 5).every(part => part === 0) && groups[5] === 0xffff) {
    return `${groups[6]! >> 8}.${groups[6]! & 255}.${groups[7]! >> 8}.${groups[7]! & 255}`;
  }
  return `${groups.slice(0, 4).map(part => part.toString(16)).join(":")}::/64`;
}

/** Fixed windows retain insertion order, so expired and oldest windows are removed first. */
export function createRateLimiter(windowMs: number, maxClients = 10_000) {
  const clients = new Map<string, { count: number; expiresAt: number }>();
  return (buckets: readonly (readonly [string, number])[], now = Date.now()): number | null => {
    for (const [key, entry] of clients) {
      if (entry.expiresAt > now) break;
      clients.delete(key);
    }
    for (const [key, limit] of buckets) {
      const entry = clients.get(key);
      if (entry && entry.count >= limit) return Math.max(1, Math.ceil((entry.expiresAt - now) / 1000));
    }
    const keys = new Set(buckets.map(([key]) => key));
    const missing = [...keys].filter(key => !clients.has(key)).length;
    for (const key of clients.keys()) {
      if (clients.size + missing <= maxClients) break;
      if (!keys.has(key)) clients.delete(key);
    }
    for (const key of keys) {
      const entry = clients.get(key);
      if (entry) entry.count++;
      else clients.set(key, { count: 1, expiresAt: now + windowMs });
    }
    return null;
  };
}
