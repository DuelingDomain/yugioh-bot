import { renderToString } from "react-dom/server";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ resolve: vi.fn(), connection: vi.fn(), provider: vi.fn(), auth: vi.fn(() => ({ isLoaded: false, isSignedIn: undefined })) }));
vi.mock("@/lib/session-identity", () => ({ resolveSessionIdentity: state.resolve }));
vi.mock("@/components/layout/app-shell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("next/server", () => ({ connection: state.connection }));
vi.mock("@/lib/hooks/use-duel-leave-guard", () => ({ DuelNavigationGuard: () => null }));
vi.mock("@clerk/nextjs", () => ({ useAuth: state.auth, useClerk: () => ({ signOut: vi.fn() }), ClerkProvider: (props: { children: React.ReactNode }) => { state.provider(props); return <>{props.children}</>; } }));
import RootLayout from "../app/layout";
import AppLayout from "../app/(app)/layout";
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("E2E_AUTH", "0"); });
afterEach(() => vi.unstubAllEnvs());
it("resolves signed-in identity before rendering application content", async () => { state.resolve.mockResolvedValue({ ok: true, identity: { userId: 42 } }); expect(renderToString(await AppLayout({ children: <p>Drafts</p> }))).toContain("Drafts"); });
it("redirects signed-out app requests and renders a retry panel on an outage", async () => {
 state.resolve.mockResolvedValue({ ok: false, status: 401 }); await expect(AppLayout({ children: <p>Drafts</p> })).rejects.toThrow("redirect:/sign-in");
 state.resolve.mockResolvedValue({ ok: false, status: 503 }); const html = renderToString(await AppLayout({ children: <p>Drafts</p> })); expect(html).toContain("role=\"alert\""); expect(html).toContain("We couldn&#x27;t load your account. Try again in a moment."); expect(html).toContain("data-testid=\"app-retry-panel\""); expect(html).toContain("Try again</button>"); expect(html).not.toContain("Drafts");
});
it("reads the E2E gate at request time and omits ClerkProvider when enabled", async () => {
 renderToString(await RootLayout({ children: <p>App</p> })); expect(state.connection).toHaveBeenCalledTimes(1); expect(state.provider).toHaveBeenCalledTimes(1);
 state.provider.mockClear(); state.auth.mockClear(); vi.stubEnv("E2E_AUTH", "1"); vi.stubEnv("E2E_AUTH_SECRET", "x".repeat(32));
 expect(renderToString(await RootLayout({ children: <p>Offline</p> }))).toContain("Offline"); expect(state.connection).toHaveBeenCalledTimes(2); expect(state.provider).not.toHaveBeenCalled(); expect(state.auth).not.toHaveBeenCalled();
});
