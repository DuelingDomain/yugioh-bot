import { LayoutDashboard, Trophy, Medal, Layers, Boxes, Swords, Library, FlaskConical, Settings, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  match: "exact" | "prefix";
  /** Shown only to guild admins. The shell asks `/api/sandbox/access`; pages and APIs still gate on their own. */
  adminOnly?: boolean;
}

export const navItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, match: "exact" },
  { href: "/tournaments", label: "Tournaments", icon: Trophy, match: "prefix" },
  { href: "/drafts", label: "Drafts", icon: Layers, match: "prefix" },
  { href: "/duels", label: "Duels", icon: Swords, match: "prefix" },
  { href: "/decks", label: "Decks", icon: Library, match: "prefix" },
  { href: "/cubes", label: "Cubes", icon: Boxes, match: "prefix" },
  { href: "/sandbox", label: "Sandbox", icon: FlaskConical, match: "prefix", adminOnly: true },
  { href: "/leaderboard", label: "Leaderboard", icon: Medal, match: "exact" },
  { href: "/settings", label: "Settings", icon: Settings, match: "exact" },
];
