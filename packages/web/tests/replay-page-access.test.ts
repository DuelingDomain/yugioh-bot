import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ access: vi.fn(), get: vi.fn(), prepare: vi.fn() }));
vi.mock("@/lib/web-access", () => ({ requireWebAccess: mocks.access }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ prepare: mocks.prepare }) }));
vi.mock("@/lib/env", () => ({ env: { discordGuildId: "test-guild" } }));
vi.mock("@/components/duel/replay", () => ({ DuelReplayView: () => null }));
import DuelReplayPage from "../app/(app)/duels/[slug]/replay/page";

const page = () => DuelReplayPage({ params: Promise.resolve({ slug: "source" }) });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OWNER_USER_IDS", "101");
  mocks.access.mockResolvedValue({ ok: true, userId: "101" });
  mocks.prepare.mockReturnValue({ get: mocks.get });
  mocks.get.mockReturnValue({ sandbox: 0, setup_json: null });
});
afterEach(() => vi.unstubAllEnvs());

it("shows the owner hint for an ordinary local source", async () => {
  expect((await page()).props.canInspectSource).toBe(true);
  expect(mocks.get).toHaveBeenCalledWith("source", "test-guild");
});
it.each([{ sandbox: 1, setup_json: null }, { sandbox: 0, setup_json: '{"sandbox":{}}' }])(
  "keeps a sandbox source on the ordinary replay route: %j", async source => {
    mocks.get.mockReturnValue(source);
    expect((await page()).props.canInspectSource).toBe(false);
  },
);
it.each([undefined, "", "102"])("hides owner controls for list %s", async ids => {
  vi.stubEnv("OWNER_USER_IDS", ids);
  expect((await page()).props.canInspectSource).toBe(false);
  expect(mocks.prepare).not.toHaveBeenCalled();
});
it("fails closed when source metadata is unavailable", async () => {
  mocks.get.mockImplementationOnce(() => { throw new Error("Database unavailable"); });
  expect((await page()).props.canInspectSource).toBe(false);
});
