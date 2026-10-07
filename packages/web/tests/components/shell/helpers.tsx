import React from "react";
import { vi } from "vitest";
import type { ShellAccount } from "../../../src/components/layout/use-shell-account";

export const ready: ShellAccount = { status: "ready", name: "Imran", image: null, playerId: 7, profileSettled: true, tier: "Gold", elo: 1432, isAdmin: false };
export const noProfile: ShellAccount = { ...ready, playerId: null };
export const loading: ShellAccount = { status: "loading", name: "", image: null, playerId: null, profileSettled: false, tier: null, elo: null, isAdmin: false };

export function LinkStub({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a href={href} {...props}>
      {children}
    </a>
  );
}

export function fontMock() {
  const font = () => ({ className: "font-class", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
}

export const NOT_LIVE = { yourDuel: null, liveCount: 0 };

export function stubFetch(
  session: object | "fail" = { user: { name: "Imran" } },
  me: object | null = { playerId: 7 },
  live: object | null = NOT_LIVE,
  admin = false,
) {
  global.fetch = vi.fn((url: string) => {
    if (url.includes("/api/auth/session")) {
      return session === "fail" ? Promise.reject(new Error("x")) : Promise.resolve({ ok: true, json: () => Promise.resolve(session) });
    }
    if (url.includes("/api/admin/access")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ admin }) });
    }
    if (url.includes("/api/live")) {
      return Promise.resolve({ ok: live !== null, status: live !== null ? 200 : 401, json: () => Promise.resolve(live) });
    }
    if (url.includes("/api/player/me")) {
      return Promise.resolve({ ok: me !== null, json: () => Promise.resolve(me) });
    }
    if (/\/api\/player\/\d+/.test(url)) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ rating: 1432.4, rank: { name: "Gold" } }) });
    }
    return Promise.resolve({ ok: me !== null, json: () => Promise.resolve(me) });
  }) as unknown as typeof fetch;
}
