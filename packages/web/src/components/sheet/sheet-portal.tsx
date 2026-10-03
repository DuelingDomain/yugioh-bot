"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { SheetRoot } from "./sheet-root";

/**
 * `.ms` is a size container, so it is the containing block for `position: fixed`
 * descendants. Anything fixed (modals, sheets, popups, drawers, toasts, bottom bars)
 * must render through this portal. It mounts into document.body inside its own
 * `<SheetRoot flow>`, so tokens and fonts still apply. Renders nothing before mount so
 * server output stays stable.
 */
export function SheetPortal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(<SheetRoot flow>{children}</SheetRoot>, document.body);
}
