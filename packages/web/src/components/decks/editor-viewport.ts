"use client";

import { useEffect, useState } from "react";

/** Attach to the host's direct child, including loading and error placeholders. */
export function useEditorViewport(pool: boolean) {
  const [content, editorRef] = useState<HTMLElement | null>(null);
  const [isPhone, setIsPhone] = useState(false);

  useEffect(() => {
    const host = content?.parentElement;
    if (!content || !host) return;

    // The negative margins have applied by now. Measure the shell rather than
    // assuming a header height; scrollY keeps the offset stable on short pages.
    const measureTop = () => {
      if (pool) host.style.setProperty("--de-top", `${host.getBoundingClientRect().top + window.scrollY}px`);
    };
    measureTop();
    if (pool) window.addEventListener("resize", measureTop);

    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(([entry]) => {
      if (entry) setIsPhone(entry.contentRect.width < 960);
      measureTop();
    });
    observer?.observe(content);

    return () => {
      observer?.disconnect();
      if (pool) {
        window.removeEventListener("resize", measureTop);
        host.style.removeProperty("--de-top");
      }
    };
  }, [content, pool]);

  return { editorRef, isPhone };
}
