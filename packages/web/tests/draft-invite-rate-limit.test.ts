import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function request(ip = "1.2.3.4") { return new Request("http://localhost", { headers: { "x-forwarded-for": ip } }); }
describe("draft invite fixed windows", () => {
  beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => vi.useRealTimers());
  it("limits a user across IPs and releases the window without extending it", async () => {
    const { draftInviteRateLimit } = await import("../src/lib/draft-invite-rate-limit");
    for (let i=0;i<10;i++) expect(draftInviteRateLimit(request(`ip-${i}`),101)).toBeNull();
    const denied = draftInviteRateLimit(request("fresh"),101)!;
    expect(denied.status).toBe(429); expect(denied.headers.get("retry-after")).toBe("60");
    vi.advanceTimersByTime(59_000);
    expect(draftInviteRateLimit(request("fresh"),101)!.headers.get("retry-after")).toBe("1");
    vi.advanceTimersByTime(1_000);
    expect(draftInviteRateLimit(request("fresh"),101)).toBeNull();
  });
  it("limits an IP across users and leaves other IPs available", async () => {
    const { draftInviteRateLimit } = await import("../src/lib/draft-invite-rate-limit");
    for (let i=0;i<30;i++) expect(draftInviteRateLimit(request(),101+i)).toBeNull();
    expect(draftInviteRateLimit(request("1.2.3.4, spoofed"),999)?.status).toBe(429);
    expect(draftInviteRateLimit(request("other"),999)).toBeNull();
  });
  it("bounds memory by refusing new buckets instead of evicting active windows", async () => {
    const { draftInviteRateLimit } = await import("../src/lib/draft-invite-rate-limit");
    for (let i=0;i<5000;i++) expect(draftInviteRateLimit(request(`ip-${i}`),i+1)).toBeNull();
    expect(draftInviteRateLimit(request("overflow"),99999)?.status).toBe(429);
    vi.advanceTimersByTime(60_000);
    expect(draftInviteRateLimit(request("overflow"),99999)).toBeNull();
  });
});
