import { LayoutDashboard, Trophy, Medal, Layers, Boxes, Swords, Library, Settings, DatabaseZap, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  match: "exact" | "prefix";
  /** Shown only to guild admins. */
  adminOnly?: boolean;
}

export const navItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, match: "exact" },
  { href: "/tournaments", label: "Tournaments", icon: Trophy, match: "prefix" },
  { href: "/drafts", label: "Drafts", icon: Layers, match: "prefix" },
  { href: "/duels", label: "Duels", icon: Swords, match: "prefix" },
  { href: "/decks", label: "Decks", icon: Library, match: "prefix" },
  { href: "/cubes", label: "Cubes", icon: Boxes, match: "prefix" },
  { href: "/leaderboard", label: "Leaderboard", icon: Medal, match: "exact" },
  { href: "/settings/card-data", label: "Card data", icon: DatabaseZap, match: "prefix", adminOnly: true },
  { href: "/settings", label: "Settings", icon: Settings, match: "exact" },
];
