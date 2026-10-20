import type { SectionId } from "@/lib/admin-console/types";

/** Smooth scroll to a section and put its id in the address bar, so the link can be shared. */
export function scrollToSection(id: SectionId): void {
  const target = document.getElementById(id);
  if (!target) return;
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
  try { history.replaceState(null, "", `#${id}`); } catch { /* not critical */ }
}
