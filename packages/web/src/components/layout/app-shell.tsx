"use client";

import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { TopBar } from "./topbar";
import { MobileDrawer } from "./mobile-drawer";

export function AppShell({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const pathname = usePathname();

  // Keep the field's inspector and Domain rail usable instead of squeezing them
  // beside the dashboard navigation. The room includes its own route back.
  if (pathname.startsWith("/duels/")) {
    return <main className="min-h-screen bg-bg-deep p-4 text-text-primary sm:p-6 lg:p-8">{children}</main>;
  }

  // The deck editor is a full-screen, three-pane workspace with its own route back.
  if (pathname === "/decks/new" || /^\/decks\/\d+$/.test(pathname)) {
    return <main className="min-h-screen bg-bg-deep text-text-primary">{children}</main>;
  }

  return (
    <div
      className="min-h-screen bg-bg-deep text-text-primary"
      data-sidebar-collapsed={sidebarCollapsed ? "true" : "false"}
    >
      <TopBar
        onMenuClick={() => setDrawerOpen(true)}
        onToggleSidebar={() => setSidebarCollapsed((c) => !c)}
        sidebarCollapsed={sidebarCollapsed}
      />
      <Sidebar collapsed={sidebarCollapsed} />
      <MobileDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
      <main className="app-shell-content">
        <div className="mx-auto p-4 sm:p-6 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}