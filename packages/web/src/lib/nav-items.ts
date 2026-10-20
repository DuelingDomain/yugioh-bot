import { LayoutDashboard, Trophy, Medal, Layers, Boxes, Swords, Library, UserCog, DatabaseZap, Bug, Gauge, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  match: "exact" | "prefix";
}

export const navItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, match: "exact" },
  { href: "/tournaments", label: "Tournaments", icon: Trophy, match: "prefix" },
  { href: "/drafts", label: "Drafts", icon: Layers, match: "prefix" },
  { href: "/duels", label: "Duels", icon: Swords, match: "prefix" },
  { href: "/decks", label: "Decks", icon: Library, match: "prefix" },
  { href: "/cubes", label: "Cubes", icon: Boxes, match: "prefix" },
  { href: "/leaderboard", label: "Leaderboard", icon: Medal, match: "exact" },
  { href: "/admin", label: "Admin console", icon: Gauge, match: "prefix" },
  { href: "/settings/card-data", label: "Card data", icon: DatabaseZap, match: "prefix" },
  { href: "/settings/bug-reports", label: "Bug reports", icon: Bug, match: "prefix" },
  { href: "/settings/account", label: "Account", icon: UserCog, match: "prefix" },
];
