"use client";

/**
 * Shows an equip link on the board as a line between the two cards.
 *
 *  - Hover or focus on either card of a link draws a violet line from the equip card to its monster,
 *    with a dot on each card, a small chain-link glyph on the line and a soft ring round both cards.
 *    A monster with several equips shows every line. Reduced motion draws the same picture, still.
 *  - When the engine reports an equip (an "equip" event), the line draws itself from the equip card
 *    to its monster once (about 650 ms), then fades. It waits for the chain link that caused it
 *    (chainEffectAt), like the other card effects. Reduced motion: no animation, the chip on the
 *    cards says it.
 *
 * Everything sits on a pointer-transparent overlay inside the field and is measured from the zone
 * elements every frame, so it follows a card that moves or a board that resizes. Pointer and focus
 * are read from the field by delegated listeners, so the zones need no extra handlers.
 */
import { duelFxClock } from "./fx-clock";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DuelEvent } from "@yugidraft/shared/duels";
import { zoneKey } from "./constants";
import { chainEffectAt } from "./chain-beats";
import { collectFreshEvents, findZoneElement, maxEventId } from "./event-queue";
import { equipLinePath, linksTouching, type Box, type EquipLink, type EquipLinks } from "./equip-links";
import { safeFxAnimate as safeAnimate } from "./safe-animate";
import styles from "./equip-fx.module.css";

export const EQUIP_ATTACH_MS = 650;

const clock = (): number => (typeof performance !== "undefined" ? duelFxClock.now() : duelFxClock.dateNow());

/** The card's visible box in overlay pixels: a Defense Position card is turned a quarter in its zone. */
function cardBox(overlay: DOMRect, zone: HTMLElement): Box | null {
  const rect = zone.getBoundingClientRect();
  if (rect.width < 4 || rect.height < 4 || overlay.width < 4) return null;
  const cx = rect.left - overlay.left + rect.width / 2;
  const cy = rect.top - overlay.top + rect.height / 2;
  const turned = zone.dataset.defense === "true" && rect.height > rect.width;
  const width = turned ? rect.height : rect.width;
  const height = turned ? rect.width : rect.height;
  return { left: cx - width / 2, top: cy - height / 2, width, height };
}

type Parts = {
  g: SVGGElement;
  shadow: SVGPathElement;
  line: SVGPathElement;
  dotA: SVGCircleElement;
  dotB: SVGCircleElement;
  glyph: SVGGElement;
  ringA: SVGRectElement;
  ringB: SVGRectElement;
};

function place(parts: Parts, overlay: DOMRect, link: EquipLink): void {
  const zoneA = findZoneElement(link.equipZone);
  const zoneB = findZoneElement(link.hostZone);
  const a = zoneA ? cardBox(overlay, zoneA) : null;
  const b = zoneB ? cardBox(overlay, zoneB) : null;
  const shape = a && b ? equipLinePath(a, b, 3) : null;
  if (!a || !b || !shape) {
    if (parts.g.dataset.placed !== "false") parts.g.dataset.placed = "false";
    return;
  }
  if (parts.g.dataset.placed !== "true") parts.g.dataset.placed = "true";
  const set = (el: Element, name: string, value: string) => {
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  };
  set(parts.shadow, "d", shape.d);
  set(parts.line, "d", shape.d);
  set(parts.dotA, "cx", String(shape.from.x));
  set(parts.dotA, "cy", String(shape.from.y));
  set(parts.dotB, "cx", String(shape.to.x));
  set(parts.dotB, "cy", String(shape.to.y));
  set(parts.glyph, "transform", `translate(${shape.mid.x} ${shape.mid.y})`);
  for (const [ring, box] of [[parts.ringA, a], [parts.ringB, b]] as const) {
    set(ring, "x", String(box.left));
    set(ring, "y", String(box.top));
    set(ring, "width", String(box.width));
    set(ring, "height", String(box.height));
  }
}

/** One link's drawing. `attachDelay` (ms) makes it the one-shot version that draws itself in. */
function LinkDrawing({
  link,
  attachDelay,
  register,
}: {
  link: EquipLink;
  attachDelay: number | null;
  register: (id: string, parts: Parts | null) => void;
}) {
  const attach = attachDelay != null;
  const id = `${attach ? "a" : "h"}:${link.equipKey}`;
  const ref = useRef<SVGGElement>(null);
  const delayRef = useRef(attachDelay ?? 0);
  useLayoutEffect(() => {
    const g = ref.current;
    if (!g) return undefined;
    const q = <T extends Element>(name: string) => g.querySelector(`[data-part="${name}"]`) as unknown as T;
    const entry: Parts = {
      g,
      shadow: q("shadow"),
      line: q("line"),
      dotA: q("dotA"),
      dotB: q("dotB"),
      glyph: q("glyph"),
      ringA: q("ringA"),
      ringB: q("ringB"),
    };
    register(id, entry);
    if (attach) {
      // Draw in, hold, fade. Starts after the chain link that caused it.
      const delay = delayRef.current;
      safeAnimate(entry.line, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 320, delay, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "both" });
      safeAnimate(
        g,
        [{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.72 }, { opacity: 0 }],
        { duration: EQUIP_ATTACH_MS, delay, fill: "both" },
      );
    }
    return () => register(id, null);
  }, [id, attach, register]);
  return (
    <g ref={ref} className={styles.link} data-equip-link={link.equipKey} data-mode={attach ? "attach" : "hover"} data-placed="false">
      <rect data-part="ringA" className={styles.ring} rx="5" />
      <rect data-part="ringB" className={styles.ring} rx="5" />
      <path data-part="shadow" className={styles.shadow} pathLength={1} />
      <path data-part="line" className={styles.line} pathLength={1} />
      <circle data-part="dotA" className={styles.dot} r="3.2" />
      <circle data-part="dotB" className={styles.dot} r="3.2" />
      <g data-part="glyph" className={styles.glyphWrap}>
        <circle className={styles.glyphBg} r="9" />
        <g transform="translate(-6 -6) scale(0.5)" className={styles.glyphMark}>
          <g transform="rotate(-40 12 12)" fill="none" strokeLinecap="round">
            <rect x="1.5" y="8" width="12" height="8" rx="4" />
            <rect x="10.5" y="8" width="12" height="8" rx="4" />
          </g>
        </g>
      </g>
    </g>
  );
}

export type EquipFxProps = {
  links: EquipLinks;
  events: readonly DuelEvent[];
  duelKey: string;
  reducedMotion: boolean;
};

export function EquipFx({ links, events, duelKey, reducedMotion }: EquipFxProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [pointerZones, setPointerZones] = useState("");
  const [focusZones, setFocusZones] = useState("");
  const [attach, setAttach] = useState<readonly string[]>([]);
  const parts = useRef(new Map<string, Parts>());
  const activeLinks = useRef(new Map<string, EquipLink>());
  /** equip key -> ms to wait before its one-shot line starts (set when the event arrives). */
  const pending = useRef(new Map<string, number>());
  const timers = useRef(new Set<number>());
  const cursor = useRef<number>(maxEventId(events) ?? 0);
  const keyRef = useRef(duelKey);

  // Pointer and focus, read from the field the overlay sits in.
  useEffect(() => {
    const root = overlayRef.current?.parentElement;
    if (!root) return undefined;
    const zones = (target: EventTarget | null): string => {
      const el = target instanceof Element ? target.closest<HTMLElement>("[data-zones]") : null;
      return el?.dataset.zones ?? "";
    };
    const over = (event: Event) => setPointerZones(zones(event.target));
    const leave = () => setPointerZones("");
    const focusIn = (event: Event) => setFocusZones(zones(event.target));
    const focusOut = () => setFocusZones("");
    root.addEventListener("pointerover", over);
    root.addEventListener("pointerleave", leave);
    root.addEventListener("focusin", focusIn);
    root.addEventListener("focusout", focusOut);
    return () => {
      root.removeEventListener("pointerover", over);
      root.removeEventListener("pointerleave", leave);
      root.removeEventListener("focusin", focusIn);
      root.removeEventListener("focusout", focusOut);
    };
  }, []);

  const hovered = useMemo(
    () => linksTouching(links, (pointerZones || focusZones).split(" ").filter(Boolean)),
    [links, pointerZones, focusZones],
  );
  const attaching = useMemo(() => links.links.filter((link) => attach.includes(link.equipKey)), [links, attach]);

  // A new equip: draw its line in once, after the chain link that caused it.
  useEffect(() => {
    if (keyRef.current !== duelKey) {
      keyRef.current = duelKey;
      cursor.current = maxEventId(events) ?? 0;
      return;
    }
    const { nextCursor, fresh } = collectFreshEvents(events, cursor.current);
    cursor.current = nextCursor;
    if (reducedMotion) return;
    for (const event of fresh) {
      if (event.kind !== "equip" || !event.zone) continue;
      const key = zoneKey(event.zone.controller, event.zone.location, event.zone.sequence);
      const wait = Math.max(0, chainEffectAt(event.id) - clock());
      pending.current.set(key, wait);
      setAttach((now) => (now.includes(key) ? now : [...now, key]));
      const timer = duelFxClock.setTimeout(() => {
        timers.current.delete(timer);
        setAttach((now) => now.filter((entry) => entry !== key));
      }, wait + EQUIP_ATTACH_MS + 80);
      timers.current.add(timer);
    }
  }, [events, duelKey, reducedMotion]);

  useEffect(
    () => () => {
      for (const timer of timers.current) duelFxClock.clearTimeout(timer);
      timers.current.clear();
    },
    [],
  );

  const register = useRef((id: string, entry: Parts | null) => {
    if (entry) parts.current.set(id, entry);
    else parts.current.delete(id);
  }).current;

  // Keep every line on its cards while the layout moves.
  const activeCount = hovered.length + attaching.length;
  activeLinks.current = new Map([
    ...hovered.map((link): [string, EquipLink] => [`h:${link.equipKey}`, link]),
    ...attaching.map((link): [string, EquipLink] => [`a:${link.equipKey}`, link]),
  ]);
  useLayoutEffect(() => {
    if (activeCount === 0) return undefined;
    let raf = 0;
    const measure = () => {
      const overlay = overlayRef.current;
      if (!overlay) return;
      const origin = overlay.getBoundingClientRect();
      for (const [id, p] of parts.current) {
        const link = activeLinks.current.get(id);
        if (link) place(p, origin, link);
      }
    };
    const tick = () => {
      measure();
      raf = duelFxClock.requestAnimationFrame(tick);
    };
    if (typeof requestAnimationFrame !== "function") {
      measure();
      return undefined;
    }
    tick();
    return () => duelFxClock.cancelAnimationFrame(raf);
  }, [activeCount, hovered, attaching]);

  return (
    <div ref={overlayRef} className={styles.layer} data-equip-fx="true" aria-hidden="true">
      <svg className={styles.svg} width="100%" height="100%">
        {hovered.map((link) => (
          <LinkDrawing key={`h:${link.equipKey}`} link={link} attachDelay={null} register={register} />
        ))}
        {attaching.map((link) => (
          <LinkDrawing key={`a:${link.equipKey}`} link={link} attachDelay={pending.current.get(link.equipKey) ?? 0} register={register} />
        ))}
      </svg>
    </div>
  );
}
