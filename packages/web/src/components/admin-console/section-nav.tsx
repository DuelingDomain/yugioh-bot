"use client";

import { useEffect, useState } from "react";
import { SECTIONS } from "@/lib/admin-console/sections";
import type { SectionId } from "@/lib/admin-console/types";
import { scrollToSection } from "./scroll";
import styles from "./admin-console.module.css";

/** Sticky anchor tabs. The tab of the section near the top of the screen is marked current. */
export function SectionNav() {
  const [active, setActive] = useState<SectionId>("online");
  useEffect(() => {
    const visible = new Map<string, number>();
    const observer = new IntersectionObserver((records) => {
      for (const r of records) { if (r.isIntersecting) visible.set(r.target.id, r.boundingClientRect.top); else visible.delete(r.target.id); }
      const first = SECTIONS.find((s) => visible.has(s.id));
      if (first) setActive(first.id);
    }, { rootMargin: "-20% 0px -65% 0px" });
    for (const s of SECTIONS) { const el = document.getElementById(s.id); if (el) observer.observe(el); }
    return () => observer.disconnect();
  }, []);
  return (
    <nav className={styles.nav} aria-label="Admin sections">
      {SECTIONS.map((s) => (
        <a key={s.id} className={styles.navLink} href={`#${s.id}`} aria-current={active === s.id ? "true" : undefined}
          onClick={(e) => { e.preventDefault(); setActive(s.id); scrollToSection(s.id); }}>
          {s.title}
        </a>
      ))}
    </nav>
  );
}
