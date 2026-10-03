import React from "react";
import { vi } from "vitest";
import type { ShellAccount } from "../../../src/components/layout/use-shell-account";

export const ready: ShellAccount = { status: "ready", name: "Imran", image: null, playerId: 7, profileSettled: true };
export const noProfile: ShellAccount = { ...ready, playerId: null };
export const loading: ShellAccount = { status: "loading", name: "", image: null, playerId: null, profileSettled: false };

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

export function stubFetch(session: object | "fail" = { user: { name: "Imran" } }, me: object | null = { playerId: 7 }) {
  global.fetch = vi.fn((url: string) => {
    if (url.includes("/api/auth/session")) {
      return session === "fail" ? Promise.reject(new Error("x")) : Promise.resolve({ ok: true, json: () => Promise.resolve(session) });
    }
    return Promise.resolve({ ok: me !== null, json: () => Promise.resolve(me) });
  }) as unknown as typeof fetch;
}
