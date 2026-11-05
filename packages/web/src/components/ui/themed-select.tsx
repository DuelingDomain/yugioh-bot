"use client";

import {
  useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, X } from "lucide-react";
import { duelFontClasses } from "@/components/duel/fonts";
import styles from "./themed-select.module.css";

export type ThemedChoice<T> = {
  value: T;
  label: string;
  /** One short line under the label in the list. */
  description?: string;
  /** Options with the same group sit under one heading. Keep them next to each other in `choices`. */
  group?: string;
  icon?: ReactNode;
  disabled?: boolean;
};

export type ThemedSelectProps<T extends string | number | boolean> = {
  label: string;
  value: T;
  choices: readonly ThemedChoice<T>[];
  onChange?: (value: T) => void;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
  hideLabel?: boolean;
  /** The id of text that explains the select, such as a hint under it. */
  describedBy?: string;
  /** Test id of the hidden native select. Its trigger button gets `<testId>-trigger`. */
  testId?: string;
  /** Accessible name that replaces the visible label, such as when several selects share one label. Start it with the visible text. */
  ariaLabel?: string;
  /** Id of the trigger button, so a `<label htmlFor>` elsewhere can name, focus and open it. */
  id?: string;
  /** `duel` (default) uses the duel UI font. `inherit` takes the font of the surrounding page, such as a sign-in form. */
  font?: "duel" | "inherit";
  /** `sheet` is the Match Sheet field. `menu` is the small button for the table's toolbars. */
  variant?: "sheet" | "menu";
  /** Menu variant: a wider button (240 px). */
  wide?: boolean;
  /** Text before the value in the button only, such as "Recognition". */
  prefix?: string;
  placeholder?: string;
  title?: string;
};

const SHEET_QUERY = "(max-width: 639px)";
const MARGIN = 8;
const GAP = 6;
const MAX_HEIGHT = 360;

type Place = { left: number; edge: number; width: number; maxHeight: number; up: boolean };

/** True on phones, where the list opens as a bottom sheet. */
function useSheetMode(): boolean {
  const [sheet, setSheet] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(SHEET_QUERY);
    const sync = () => setSheet(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return sheet;
}

/**
 * Open lists, newest last. One window listener, installed when this module loads (before any board or drawer mounts its own),
 * so Escape closes the list first and stops there: it never also backs out of a prompt, a pin or a drawer behind it.
 */
const openLists: (() => void)[] = [];
if (typeof window !== "undefined") {
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.isComposing || openLists.length === 0) return;
    event.preventDefault(); event.stopImmediatePropagation();
    openLists[openLists.length - 1]();
  }, true);
}

/** True when `position: fixed` inside this element is placed against the element and not the viewport (or the element clips it). */
function holdsFixedChildren(el: Element): boolean {
  const style = getComputedStyle(el);
  const backdrop = style.backdropFilter || (style as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter || "none";
  return style.transform !== "none" || style.translate !== "none" || style.rotate !== "none" || style.scale !== "none"
    || style.perspective !== "none" || style.filter !== "none" || backdrop !== "none"
    || /paint|layout|strict|content/.test(style.contain) || /transform|perspective|filter/.test(style.willChange)
    || (style.containerType !== "" && style.containerType !== "normal");
}

/**
 * Where to draw the list. In a modal dialog it goes inside that dialog, because a screen reader hides the content outside an `aria-modal` dialog.
 * It stays on the page when the dialog (or a parent) would move or clip a fixed child.
 */
function listHost(trigger: Element | null): Element {
  // A `popover` element sits in the top layer, above everything on the page: a list drawn on the page would open behind it,
  // and a press on that list would light-dismiss the popover. The list goes inside the popover.
  const popover = trigger?.closest("[popover]") ?? null;
  if (popover && popover.matches(":popover-open")) return popover;
  const dialog = trigger?.closest('[role="dialog"][aria-modal="true"], dialog') ?? null;
  if (!dialog) return document.body;
  for (let node: Element | null = dialog; node && node !== document.documentElement; node = node.parentElement) {
    if (holdsFixedChildren(node)) return document.body;
  }
  return dialog;
}

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");

/**
 * A select that looks like our theme and not like the browser's list.
 * Pattern: WAI-ARIA select-only combobox. Focus stays on the button; the list is a listbox that the button points at with `aria-activedescendant`.
 * A hidden native `<select>` mirrors the value, so `data-testid` + `selectOption` keep working.
 */
export function ThemedSelect<T extends string | number | boolean>({
  label, value, choices, onChange, disabled = false, compact = false, className, hideLabel = false, describedBy, testId, ariaLabel, id, font = "duel",
  variant = "sheet", wide = false, prefix, placeholder = "", title,
}: ThemedSelectProps<T>) {
  const uid = useId();
  const labelId = `${uid}-label`;
  const listId = `${uid}-list`;
  const optionId = (index: number) => `${uid}-opt-${index}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", timer: 0 as unknown as ReturnType<typeof setTimeout> });
  const sheet = useSheetMode();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [place, setPlace] = useState<Place | null>(null);
  // Where the list is drawn: inside the modal dialog that holds the button (so screen readers can reach it), else on the page.
  const [host, setHost] = useState<Element | null>(null);
  const [inheritedFont, setInheritedFont] = useState<string | undefined>(undefined);

  const selectedIndex = choices.findIndex((choice) => choice.value === value);
  const selected = selectedIndex >= 0 ? choices[selectedIndex] : null;

  const sections = useMemo(() => {
    const out: { group?: string; items: { choice: ThemedChoice<T>; index: number }[] }[] = [];
    choices.forEach((choice, index) => {
      const last = out[out.length - 1];
      if (last && last.group === choice.group) last.items.push({ choice, index });
      else out.push({ group: choice.group, items: [{ choice, index }] });
    });
    return out;
  }, [choices]);

  const enabled = useCallback((index: number) => index >= 0 && index < choices.length && !choices[index].disabled, [choices]);
  const step = useCallback((from: number, direction: 1 | -1): number => {
    for (let index = from + direction; index >= 0 && index < choices.length; index += direction) if (enabled(index)) return index;
    return from;
  }, [choices, enabled]);
  const edge = useCallback((direction: 1 | -1) => step(direction === 1 ? -1 : choices.length, direction), [choices.length, step]);

  const close = useCallback(() => { setOpen(false); setPlace(null); }, []);
  const openList = useCallback((at?: "first" | "last") => {
    if (disabled || !choices.length) return;
    const start = at === "first" ? edge(1) : at === "last" ? edge(-1) : enabled(selectedIndex) ? selectedIndex : edge(1);
    setActive(start);
    setHost(listHost(triggerRef.current));
    setInheritedFont(font === "inherit" && triggerRef.current ? getComputedStyle(triggerRef.current).fontFamily : undefined);
    setOpen(true);
  }, [choices.length, disabled, edge, enabled, font, selectedIndex]);
  const commit = useCallback((index: number) => {
    if (!enabled(index)) return;
    const choice = choices[index];
    if (choice.value !== value) onChange?.(choice.value);
    close();
    triggerRef.current?.focus({ preventScroll: true });
  }, [choices, close, enabled, onChange, value]);

  // The list never outlives the button, or a disabled state.
  useEffect(() => { if (disabled) close(); }, [disabled, close]);
  useEffect(() => () => clearTimeout(typed.current.timer), []);

  // Place the list under the button, or above it when there is no room below.
  const measure = useCallback(() => {
    const trigger = triggerRef.current; const list = listRef.current;
    if (!trigger || !list || sheet) return;
    const rect = trigger.getBoundingClientRect();
    const vw = window.innerWidth; const vh = window.innerHeight;
    const width = Math.min(Math.max(rect.width, variant === "menu" ? 220 : 0), vw - MARGIN * 2);
    const natural = Math.min(list.scrollHeight + 2, MAX_HEIGHT);
    const below = vh - rect.bottom - GAP - MARGIN; const above = rect.top - GAP - MARGIN;
    const up = natural > below && above > below;
    const room = Math.max(96, up ? above : below);
    const height = Math.min(natural, room);
    const left = Math.min(Math.max(rect.left, MARGIN), Math.max(MARGIN, vw - width - MARGIN));
    // Above the button the list hangs from its bottom edge, so a shorter list still touches the button.
    const anchor = up ? vh - rect.top + GAP : rect.bottom + GAP;
    setPlace((now) => now && now.left === left && now.edge === anchor && now.width === width && now.maxHeight === height && now.up === up ? now : { left, edge: anchor, width, maxHeight: height, up });
  }, [sheet, variant]);
  useLayoutEffect(() => { if (open) measure(); }, [open, measure, choices]);

  useEffect(() => {
    if (!open) return;
    // A press on the button or inside the list layer (list, sheet, backdrop) is not "outside": the backdrop closes on its own click.
    // On touch the browser picks the click target after the finger lifts, so closing at pointerdown would let that click land on
    // the control under the list. Touch and pen wait for the click instead (a drag or scroll cancels it).
    let stopWaiting: (() => void) | null = null;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || layerRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      // A label of the button forwards its click to the button, which then closes the list.
      if (Array.from(triggerRef.current?.labels ?? []).some((node) => node.contains(target))) return;
      if (event.pointerType === "mouse" || !event.pointerType) { close(); return; }
      stopWaiting?.();
      const done = () => { stopWaiting?.(); stopWaiting = null; };
      const onClick = () => { done(); close(); };
      document.addEventListener("click", onClick, { once: true, capture: true });
      document.addEventListener("pointercancel", done, { once: true, capture: true });
      stopWaiting = () => {
        document.removeEventListener("click", onClick, true);
        document.removeEventListener("pointercancel", done, true);
      };
    };
    // A scroll of the page or of a parent of the button closes the list (the button would move away from it). A phone sheet does not follow the page, so it stays.
    // A scroll elsewhere, such as a log that follows a live duel, leaves it open.
    // A scroll that lands just after the click (the browser scrolled the button into view) does not count.
    const openedAt = performance.now();
    const scrolled = (event: Event) => {
      const target = event.target as Node | null;
      if (performance.now() - openedAt < 150) return;
      if (sheet || (target && popRef.current?.contains(target))) return;
      if (target && target !== document && !target.contains(triggerRef.current)) return;
      close();
    };
    // Escape closes only the list (see `openLists`).
    const closeAndFocus = () => { close(); triggerRef.current?.focus({ preventScroll: true }); };
    openLists.push(closeAndFocus);
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("scroll", scrolled, true);
    window.addEventListener("resize", measure);
    return () => {
      const at = openLists.indexOf(closeAndFocus);
      if (at >= 0) openLists.splice(at, 1);
      document.removeEventListener("pointerdown", outside, true);
      stopWaiting?.();
      window.removeEventListener("scroll", scrolled, true);
      window.removeEventListener("resize", measure);
    };
  }, [open, sheet, close, measure]);

  // Keep the active option in view inside the list (never scrolls the page).
  useEffect(() => {
    if (!open || active < 0) return;
    const list = listRef.current; const node = document.getElementById(optionId(active));
    if (!list || !node) return;
    const top = node.offsetTop - list.offsetTop; const bottom = top + node.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = Math.max(0, top - 30);
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 6;
    // optionId depends only on uid
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active, place]);

  const typeahead = (character: string) => {
    const state = typed.current;
    clearTimeout(state.timer);
    state.text += character.toLowerCase();
    state.timer = setTimeout(() => { state.text = ""; }, 600);
    const repeated = state.text.length > 1 && [...state.text].every((c) => c === state.text[0]);
    const needle = repeated ? state.text[0] : state.text;
    const from = open ? active : selectedIndex;
    const order = choices.map((_, i) => (from + (repeated || state.text.length === 1 ? 1 : 0) + i + choices.length) % choices.length);
    const found = order.find((index) => enabled(index) && choices[index].label.toLowerCase().startsWith(needle));
    if (found === undefined) return;
    setActive(found);
    if (!open) setOpen(true);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled || event.ctrlKey || event.metaKey) return;
    const key = event.key;
    const take = () => { event.preventDefault(); event.stopPropagation(); };
    if (!open) {
      if (key === "ArrowDown" || key === "ArrowUp" || key === "Enter" || key === " ") { take(); openList(); }
      else if (key === "Home") { take(); openList("first"); }
      else if (key === "End") { take(); openList("last"); }
      else if (key.length === 1 && !event.altKey) { take(); typeahead(key); }
      return;
    }
    switch (key) {
      case "ArrowDown": take(); setActive((now) => step(now, 1)); break;
      case "ArrowUp": take(); if (event.altKey) commit(active); else setActive((now) => step(now, -1)); break;
      case "Home": take(); setActive(edge(1)); break;
      case "End": take(); setActive(edge(-1)); break;
      case "PageDown": take(); setActive((now) => { let next = now; for (let n = 0; n < 8; n++) next = step(next, 1); return next; }); break;
      case "PageUp": take(); setActive((now) => { let next = now; for (let n = 0; n < 8; n++) next = step(next, -1); return next; }); break;
      case "Enter": take(); commit(active); break;
      case " ": take(); if (typed.current.text) typeahead(" "); else commit(active); break;
      case "Tab": close(); break;
      default: if (key.length === 1 && !event.altKey) { take(); typeahead(key); }
    }
  };

  const triggerClass = cx(styles.trigger, compact && styles.compact, variant === "menu" && styles.menuTrigger);
  const triggerId = id ?? `${uid}-trigger`;
  const popover = open && typeof document !== "undefined" ? createPortal(
    <div ref={layerRef} className={cx(styles.scope, duelFontClasses)} data-layer-opener="" data-themed-select-layer=""
      style={inheritedFont ? ({ "--ts-font": inheritedFont } as CSSProperties) : undefined}
      onMouseDown={(event) => event.preventDefault()}>
      {sheet ? <div className={styles.backdrop} aria-hidden="true" data-testid="themed-select-backdrop"
        onClick={() => { close(); triggerRef.current?.focus({ preventScroll: true }); }} /> : null}
      <div ref={popRef} className={cx(sheet ? styles.sheet : styles.popover, !sheet && place?.up && styles.popoverUp)}
        data-themed-select-popover="" data-layer-opener=""
        style={sheet ? undefined : place ? { left: place.left, ...(place.up ? { bottom: place.edge } : { top: place.edge }), width: place.width, maxHeight: place.maxHeight } : { left: 0, top: 0, visibility: "hidden" }}
        onMouseDown={(event) => event.preventDefault()}>
        {sheet ? <>
          <div className={styles.grip} aria-hidden="true" />
          <div className={styles.sheetHead}>
            <span className={styles.sheetTitle}>{ariaLabel ?? label}</span>
            <button type="button" className={styles.sheetClose} aria-label="Close" tabIndex={-1}
              onClick={() => { close(); triggerRef.current?.focus({ preventScroll: true }); }}><X size={18} aria-hidden="true" /></button>
          </div>
        </> : null}
        <div ref={listRef} id={listId} role="listbox" aria-label={ariaLabel} aria-labelledby={ariaLabel ? undefined : labelId} className={styles.list}>
          {sections.map((section, at) => {
            const options = section.items.map(({ choice, index }) => (
              <div key={String(choice.value)} id={optionId(index)} role="option" className={styles.option}
                aria-selected={index === selectedIndex} aria-disabled={choice.disabled || undefined}
                data-active={index === active} data-value={String(choice.value)}
                onPointerMove={() => { if (!choice.disabled && index !== active) setActive(index); }}
                onClick={() => commit(index)}>
                {choice.icon ? <span className={styles.oIcon} aria-hidden="true">{choice.icon}</span> : null}
                <span className={styles.oText}>
                  <span className={styles.oLabel}>{choice.label}</span>
                  {choice.description ? <span className={styles.oDesc}>{choice.description}</span> : null}
                </span>
                {index === selectedIndex ? <Check size={15} strokeWidth={2} className={styles.check} aria-hidden="true" /> : null}
              </div>
            ));
            if (!section.group) return <div key={at} className={styles.group} role="presentation">{options}</div>;
            const groupId = `${uid}-group-${at}`;
            return <div key={at} className={styles.group} role="group" aria-labelledby={groupId}>
              <div id={groupId} className={styles.groupLabel} role="presentation">{section.group}</div>{options}
            </div>;
          })}
        </div>
      </div>
    </div>,
    host ?? document.body,
  ) : null;

  return (
    <div className={cx(styles.scope, styles.field, font === "inherit" && styles.inheritFont, variant === "menu" && styles.menu, variant === "menu" && wide && styles.menuWide, duelFontClasses, className)}>
      <label id={labelId} htmlFor={triggerId} className={hideLabel || variant === "menu" ? styles.srOnly : styles.label}
        onMouseDown={(event) => event.preventDefault()}>{label}</label>
      <button ref={triggerRef} id={triggerId} type="button" role="combobox" className={triggerClass}
        disabled={disabled} title={title}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        aria-label={ariaLabel} aria-labelledby={ariaLabel ? undefined : labelId} aria-describedby={describedBy}
        data-testid={testId ? `${testId}-trigger` : undefined}
        onClick={() => {
          if (open) { close(); return; }
          // Safari does not focus a button on a mouse click; the keys and the blur close need that focus.
          triggerRef.current?.focus({ preventScroll: true });
          openList();
        }}
        onKeyDown={onKeyDown}
        onKeyUp={(event) => { if (event.key === " ") event.preventDefault(); }}
        onBlur={(event) => { if (!popRef.current?.contains(event.relatedTarget as Node | null)) close(); }}>
        {prefix ? <span className={styles.prefix}>{prefix}</span> : null}
        {selected?.icon ? <span className={styles.tIcon} aria-hidden="true">{selected.icon}</span> : null}
        <span className={cx(styles.value, !selected && styles.placeholder)}>{selected ? selected.label : placeholder}</span>
        <ChevronDown size={variant === "menu" ? 14 : 16} strokeWidth={1.6} className={styles.chevron} aria-hidden="true" />
      </button>
      <select className={styles.native} tabIndex={-1} aria-hidden="true" disabled={disabled} value={String(value)} data-testid={testId}
        onChange={(event) => {
          const next = choices.find((choice) => String(choice.value) === event.target.value);
          if (next && !next.disabled) onChange?.(next.value);
        }}>
        {choices.map((choice) => <option key={String(choice.value)} value={String(choice.value)} disabled={choice.disabled}>{choice.label}</option>)}
      </select>
      {popover}
    </div>
  );
}
