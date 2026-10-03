"use client";

import { useEffect, useRef } from "react";
import { TALK_SHOW_MS, talkText } from "@yugidraft/shared/ws/talk";
import type { HeardLine } from "@/lib/stores/talk-store";
import { animate } from "./motion";

/**
 * What a seat just said. It pops in, then fades just before the store drops it.
 * Give it `key={heard.seq}` so a new line starts fresh. With animations Off it simply appears and goes.
 */
export function TalkBubble({
  heard,
  as: Tag = "div",
  className,
  name,
  flip,
  rise = 6,
  scale = 0.9,
}: {
  heard: HeardLine;
  as?: "div" | "span";
  className: string;
  /** A friend's name, shown small before the words. Yours has none. */
  name?: string;
  flip?: boolean;
  /** How far it floats in from, in px. */
  rise?: number;
  scale?: number;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    void animate(el, [{ opacity: 0, transform: `translateY(${rise}px) scale(${scale})` }, { opacity: 1, transform: "none" }], {
      duration: 220,
      easing: "cubic-bezier(0.2,0.9,0.3,1.2)",
    });
    void animate(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 260, delay: TALK_SHOW_MS - 260, fill: "forwards" });
  }, [rise, scale]);
  return (
    <Tag ref={ref as never} className={className} role="status" data-flip={flip ? "" : undefined}>
      {name ? <small>{name}</small> : null}
      {talkText(heard.line)}
    </Tag>
  );
}
