"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, ArrowUpFromLine, Layers, RotateCw, Shuffle, Sparkles, Swords, Zap, type LucideIcon } from "lucide-react";
import type { DuelCard, DuelPromptOption } from "@yugidraft/shared/duels";
import { cardDetailsText, cardStatsText } from "./constants";
import { duelFontClasses } from "./fonts";
import styles from "./room.module.css";
import fx from "./battle-fx.module.css";

/** Icon for an engine option id; the label always carries the meaning too. */
function optionIcon(id: string): LucideIcon {
  if (id.startsWith("summon") || id.startsWith("spsummon")) return ArrowUpFromLine;
  if (id.startsWith("mset") || id.startsWith("sset")) return Layers;
  if (id.startsWith("activate")) return Sparkles;
  if (id.startsWith("attack")) return Swords;
  if (id.startsWith("pos")) return RotateCw;
  if (id === "shuffle") return Shuffle;
  if (id.startsWith("to_")) return ArrowRight;
  return Zap;
}

/**
 * The menu title already names the card, so drop it from the row label and lift
 * an activation's effect text into a note line. The button keeps the full label
 * as its accessible name.
 */
function optionParts(option: DuelPromptOption, title: string): { main: string; note: string | null } {
  let text = option.label;
  let note: string | null = null;
  // Engine format: "Activate <card name>: <effect>". Card names can contain ": "
  // ("Number 39: Utopia"), so remove the known name before splitting off the effect.
  const namedPrefix = title && title !== "Card" ? `Activate ${title}: ` : null;
  if (option.id.startsWith("activate") && namedPrefix && text.startsWith(namedPrefix)) {
    note = text.slice(namedPrefix.length).trim() || null;
    text = "Activate";
  } else if (option.id.startsWith("activate") && text.indexOf(": ") > 0) {
    const colon = text.indexOf(": ");
    note = text.slice(colon + 2).trim() || null;
    text = text.slice(0, colon);
  }
  if (title && title !== "Card" && text.includes(title)) {
    const stripped = text.replace(title, "").replace(/\s{2,}/g, " ").replace(/\s+(of|with|to)$/i, "").trim();
    if (stripped) text = stripped;
  }
  return { main: text, note };
}

function useAnchoredPosition(anchor: HTMLElement, interactive: boolean, prefer: "above" | "below" = "above") {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, ready: false, side: "above" as "above" | "below", ax: 0 });

  useLayoutEffect(() => {
    function place() {
      const surface = ref.current;
      if (!surface || !anchor.isConnected) return;
      const card = (anchor.querySelector<HTMLElement>("[data-card-art]") ?? anchor).getBoundingClientRect();
      const width = surface.offsetWidth;
      const height = surface.offsetHeight;
      const margin = 8;
      const preferredLeft = interactive ? card.left : card.left + (card.width - width) / 2;
      const left = Math.max(margin, Math.min(preferredLeft, window.innerWidth - width - margin));
      const above = card.top - height - margin;
      const belowRoom = window.innerHeight - (card.bottom + margin + height);
      const side = prefer === "below"
        ? (belowRoom >= margin || above < margin ? "below" as const : "above" as const)
        : (above >= margin ? "above" as const : "below" as const);
      const preferredTop = side === "above" ? above : card.bottom + margin;
      const top = Math.max(margin, Math.min(preferredTop, window.innerHeight - height - margin));
      // The pointer notch tracks the card centre, kept inside the rounded corners.
      const ax = Math.max(16, Math.min(card.left + card.width / 2 - left, width - 16));
      setPosition({ left, top, ready: true, side, ax });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, interactive, prefer]);

  const style = {
    left: position.left,
    top: position.top,
    visibility: position.ready ? "visible" : "hidden",
    "--ax": `${position.ax}px`,
  } as CSSProperties;
  return { ref, style, visibility: style.visibility, side: position.side };
}

export function CardActionMenu({
  anchor,
  title,
  options,
  busy,
  tone = "action",
  onChoose,
  onClose,
  onOptionHover,
}: {
  anchor: HTMLElement;
  title: string;
  options: readonly DuelPromptOption[];
  busy: boolean;
  /** "chain" paints the menu gold for a chain response; "action" is your own action (purple). */
  tone?: "action" | "chain";
  onChoose: (option: DuelPromptOption) => void;
  onClose: () => void;
  /** Hover or keyboard focus on an option (null when it leaves). Drives the attack arrow preview. */
  onOptionHover?: (option: DuelPromptOption | null) => void;
}) {
  const { ref, style, visibility, side } = useAnchoredPosition(anchor, true);

  useLayoutEffect(() => {
    // The first layout pass measures a hidden menu; hidden items cannot focus.
    if (visibility !== "visible") return;
    ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
    function dismiss(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node) && !anchor.contains(event.target as Node)) onClose();
    }
    document.addEventListener("pointerdown", dismiss, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
      if (anchor.isConnected) anchor.focus({ preventScroll: true });
    };
  }, [anchor, onClose, ref, visibility]);

  return createPortal(
    <div
      ref={ref}
      className={`${styles.cardMenu} ${duelFontClasses}`}
      data-tone={tone}
      data-side={side}
      style={style}
      role="menu"
      aria-label={`${title} actions`}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
          return;
        }
        if (event.key === "Tab") {
          onClose();
          return;
        }
        const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
        if (!buttons.length) return;
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        let next: number | null = null;
        if (event.key === "ArrowDown") next = (current + 1) % buttons.length;
        if (event.key === "ArrowUp") next = (current - 1 + buttons.length) % buttons.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = buttons.length - 1;
        if (next != null) {
          event.preventDefault();
          buttons[next]?.focus();
        }
      }}
    >
      <div className={styles.menuTitle}>{title}</div>
      <div className={styles.menuList}>
      {options.map((option, index) => {
        const Icon = optionIcon(option.id);
        const { main, note } = optionParts(option, title);
        return (
          <button
            key={option.id}
            type="button"
            role="menuitem"
            aria-label={option.label}
            data-primary={index === 0 ? "true" : undefined}
            disabled={busy}
            onClick={() => onChoose(option)}
            onMouseEnter={onOptionHover ? () => onOptionHover(option) : undefined}
            onMouseLeave={onOptionHover ? () => onOptionHover(null) : undefined}
            onFocus={onOptionHover ? () => onOptionHover(option) : undefined}
            onBlur={onOptionHover ? () => onOptionHover(null) : undefined}
          >
            <Icon size={16} strokeWidth={1.75} aria-hidden />
            <span className={styles.menuLabel}>
              {main}
              {note ? <small>{note}</small> : null}
            </span>
          </button>
        );
      })}
      </div>
    </div>,
    document.body,
  );
}

export function CardHoverInfo({ card, anchor }: { card: DuelCard; anchor: HTMLElement }) {
  const { ref, style } = useAnchoredPosition(anchor, false);
  const stats = cardStatsText(card);
  const details = cardDetailsText(card);
  if (card.code == null) return null;

  return createPortal(
    <div ref={ref} className={`${styles.cardTooltip} ${duelFontClasses}`} style={style} role="tooltip">
      <strong>{card.name ?? `Card ${card.code}`}</strong>
      {stats ? <span className={styles.tooltipStats}>{stats}</span> : null}
      {details ? <span>{details}</span> : null}
    </div>,
    document.body,
  );
}

/**
 * The "yes" step of a human attack: a small confirm anchored to the locked target.
 * Only its primary button submits the attack. Enter confirms and Esc backs out, whether or
 * not the popover holds focus; clicking away (except on another legal target) also backs out.
 */
export function AttackConfirm({
  anchor,
  targetName,
  busy,
  prefer,
  onConfirm,
  onBack,
}: {
  anchor: HTMLElement;
  targetName: string;
  busy: boolean;
  prefer: "above" | "below";
  onConfirm: () => void;
  onBack: () => void;
}) {
  const { ref, style, visibility, side } = useAnchoredPosition(anchor, false, prefer);
  const confirmRef = useRef(onConfirm);
  const backRef = useRef(onBack);
  const busyRef = useRef(busy);
  confirmRef.current = onConfirm;
  backRef.current = onBack;
  busyRef.current = busy;

  useLayoutEffect(() => {
    // The first layout pass measures a hidden popover; hidden buttons cannot focus.
    if (visibility !== "visible") return;
    ref.current?.querySelector<HTMLButtonElement>("button[data-go]")?.focus({ preventScroll: true });
  }, [ref, visibility]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Enter" && event.key !== "Escape") return;
      if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        backRef.current();
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      // Inside the popover a button activates natively; on a zone, Enter re-aims at that zone.
      if (target?.closest("[data-attack-confirm],[data-zones],input,textarea,select,[contenteditable='true']")) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat && !busyRef.current) confirmRef.current();
    }
    function onPointer(event: PointerEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("[data-attack-confirm]") || anchor.contains(target)) return;
      if (target?.closest('[data-zones][data-legal="true"]')) return;
      backRef.current();
    }
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
      const active = document.activeElement;
      if (anchor.isConnected && (active === document.body || active == null || ref.current?.contains(active))) {
        anchor.focus({ preventScroll: true });
      }
    };
  }, [anchor, ref]);

  return createPortal(
    <div
      ref={ref}
      className={`${fx.confirm} ${duelFontClasses}`}
      data-attack-confirm
      data-side={side}
      style={style}
      role="dialog"
      aria-label={`Confirm attack on ${targetName}`}
    >
      <div className={fx.confirmRow}>
        <button type="button" className={fx.confirmGo} data-go disabled={busy} aria-keyshortcuts="Enter" onClick={onConfirm}>
          Attack {targetName}
        </button>
        <button type="button" className={fx.confirmBack} disabled={busy} aria-keyshortcuts="Escape" onClick={onBack}>
          Back
        </button>
      </div>
      <span className={fx.confirmHint}><kbd>Enter</kbd> attack · <kbd>Esc</kbd> back</span>
    </div>,
    document.body,
  );
}
