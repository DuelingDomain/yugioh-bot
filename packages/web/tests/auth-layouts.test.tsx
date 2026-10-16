import React from "react";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("@/components/layout/app-shell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("@/lib/hooks/use-duel-leave-guard", () => ({ DuelNavigationGuard: () => <span data-testid="navigation-guard" /> }));
vi.mock("@/components/duel/active-game-guard", () => ({ ActiveGameGuard: () => <span data-testid="active-game-guard" /> }));
import RootLayout from "../app/layout";
import AppLayout from "../app/(app)/layout";

it("mounts the active game guard alongside application content", () => {
  const html = renderToString(<AppLayout><p>Drafts</p></AppLayout>);
  expect(html).toContain('data-testid="active-game-guard"');
  expect(html).toContain("<main><p>Drafts</p></main>");
});

it("keeps the login and other root routes outside the active game guard", () => {
  const html = renderToString(<RootLayout><p>Discord sign-in</p></RootLayout>);
  expect(html).toContain("Discord sign-in");
  expect(html).toContain('data-testid="navigation-guard"');
  expect(html).not.toContain('data-testid="active-game-guard"');
});

it("mounts each navigation guard once for an application page", () => {
  const html = renderToString(<RootLayout><AppLayout><p>Duels</p></AppLayout></RootLayout>);
  expect(html.match(/data-testid="navigation-guard"/g)).toHaveLength(1);
  expect(html.match(/data-testid="active-game-guard"/g)).toHaveLength(1);
});
