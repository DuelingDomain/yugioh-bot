"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, ArrowUpFromLine, Flag, Layers, RotateCw, Shuffle, Sparkles, Swords, Zap, type LucideIcon } from "lucide-react";
import type { DuelCard, DuelCardInfo, DuelPromptOption } from "@yugidraft/shared/duels";
import { cardDetailsText, cardStatsText } from "./constants";
import { duelFontClasses } from "./fonts";
import { safeAnimate } from "./safe-animate";
import baseStyles from "./room.module.css";
import baseFx from "./battle-fx.module.css";
import { useSkinStyles } from "./skin";

/** The card action menu the room or the table shell has open: where it sits, what it offers, and which prompt it answers. */
export type CardMenuState = {
  anchor: HTMLElement;
  title: string;
  /** The card the menu belongs to: the HUD's hover preview keeps showing it while the menu is open. */
  card?: DuelCard | null;
  options: DuelPromptOption[];
  promptId: string;
  revision: number;
  tone: "action" | "chain";
};

/** A face-down or unnamed target reads as "face-down monster" in the attack confirm. */
export function targetName(option: { label?: string; card?: { name?: string | null } | null }): string {
  const name = option.card?.name?.trim();
  if (name) return name;
  return !option.label || /^Card \d+$/.test(option.label) ? "face-down monster" : option.label;
}

/** The first element a zone key marks on the page (the card button when it has one). */
export function zoneAnchor(key: string, scope: ParentNode = document): HTMLElement | null {
  const zone = scope.querySelector<HTMLElement>(`[data-zones~="${key}"]`);
  return zone?.querySelector<HTMLElement>("button") ?? zone;
}

/** Put the confirm on the side of the target away from the attacker, so it never covers the arrow. */
export function confirmSide(attackerKey: string | null, anchor: HTMLElement, scope: ParentNode = document): "above" | "below" {
  const from = attackerKey ? scope.querySelector(`[data-zones~="${attackerKey}"]`) : null;
  if (!from) return "above";
  return from.getBoundingClientRect().top > anchor.getBoundingClientRect().top ? "above" : "below";
}

/** Icon for an engine option id; the label always carries the meaning too. */
function optionIcon(id: string): LucideIcon {
  if (id.startsWith("summon") || id.startsWith("spsummon")) return ArrowUpFromLine;
  if (id.startsWith("mset") || id.startsWith("sset")) return Layers;
  if (id.startsWith("activate")) return Sparkles;
  if (id.startsWith("attack")) return Swords;
  if (id.startsWith("pos")) return RotateCw;
  if (id === "shuffle") return Shuffle;
  if (id === "surrender") return Flag;
  if (id.startsWith("to_")) return ArrowRight;
  return Zap;
}

/**
 * The menu title already names the card, so drop it from the row label and lift
 * an activation's effect text into a note line. The button keeps the full label
 * as its accessible name.
 */
export function optionParts(option: DuelPromptOption, title: string): { main: string; note: string | null } {
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
    // Trim before the dangling-word check: removing a trailing name leaves "Attack directly with ".
    const stripped = text.replace(title, "").replace(/\s{2,}/g, " ").trim().replace(/\s+(of|with|to)$/i, "");
    if (stripped) text = stripped;
  }
  return { main: text, note };
}

/** Selector for surfaces a passive tooltip must never cover: open prompt panels and pile viewers. */
const AVOID_SURFACES = "[data-prompt-panel],[data-pile-viewer]";

/**
 * 3D mode only: the menu, hover info and confirm portal to the body, outside the room that holds the Solid Vision
 * font variables. Copy them from the anchor (which sits inside the room) so the portal uses the same type.
 */
function usePortalFont(anchor: HTMLElement, skinned: boolean): CSSProperties | undefined {
  return useMemo(() => {
    if (!skinned || !anchor.isConnected) return undefined;
    const computed = getComputedStyle(anchor);
    const out: Record<string, string> = {};
    for (const name of ["--sv-font", "--sv-font-num"]) {
      const value = computed.getPropertyValue(name).trim();
      if (value) out[name] = value;
    }
    return out as CSSProperties;
  }, [anchor, skinned]);
}

type Rect = { left: number; top: number; width: number; height: number };

function intersects(a: Rect, b: Rect): boolean {
  return a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;
}

function useAnchoredPosition(
  anchor: HTMLElement,
  interactive: boolean,
  prefer: "above" | "below" = "above",
  /** Keep clear of the surfaces matching AVOID_SURFACES; hide when no placement is clear. */
  avoid = false,
) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, ready: false, side: "above" as "above" | "below", ax: 0, hidden: false });

  useLayoutEffect(() => {
    // An interactive menu must not move under the pointer: a hovered hand card grows, then shrinks
    // again when the pointer moves onto the menu. The menu follows the card while it grows and
    // ignores the shrink (only a resize or a scroll places it afresh).
    let largest = 0;
    function place(event?: Event) {
      const surface = ref.current;
      if (!surface || !anchor.isConnected) return;
      const card = (anchor.querySelector<HTMLElement>("[data-card-art]") ?? anchor).getBoundingClientRect();
      if (interactive) {
        if (event && (event.type === "resize" || event.type === "scroll")) largest = 0;
        else if (card.height < largest - 0.5) return;
        largest = Math.max(largest, card.height);
      }
      const width = surface.offsetWidth;
      const height = surface.offsetHeight;
      const margin = 8;
      const preferredLeft = interactive ? card.left : card.left + (card.width - width) / 2;
      const left = Math.max(margin, Math.min(preferredLeft, window.innerWidth - width - margin));
      const above = card.top - height - margin;
      const belowRoom = window.innerHeight - (card.bottom + margin + height);
      let side = prefer === "below"
        ? (belowRoom >= margin || above < margin ? "below" as const : "above" as const)
        : (above >= margin ? "above" as const : "below" as const);
      const preferredTop = side === "above" ? above : card.bottom + margin;
      let top = Math.max(margin, Math.min(preferredTop, window.innerHeight - height - margin));
      let finalLeft = left;
      let hidden = false;
      if (avoid) {
        const blocks: Rect[] = [];
        document.querySelectorAll<HTMLElement>(AVOID_SURFACES).forEach((el) => {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) blocks.push(rect);
        });
        if (blocks.length) {
          const clear = (rect: Rect) =>
            rect.left >= margin && rect.top >= margin && rect.left + rect.width <= window.innerWidth - margin &&
            rect.top + rect.height <= window.innerHeight - margin && !blocks.some((block) => intersects(rect, block));
          const centreTop = Math.max(margin, Math.min(card.top + (card.height - height) / 2, window.innerHeight - height - margin));
          const candidates: Array<{ left: number; top: number; side: "above" | "below" }> = [
            { left, top, side },
            { left, top: side === "above" ? card.bottom + margin : above, side: side === "above" ? "below" : "above" },
            { left: card.left - width - margin, top: centreTop, side: "above" },
            { left: card.right + margin, top: centreTop, side: "above" },
          ];
          const pick = candidates.find((candidate) => clear({ ...candidate, width, height }));
          if (pick) {
            finalLeft = pick.left;
            top = pick.top;
            side = pick.side;
          } else {
            hidden = true;
          }
        }
      }
      // The pointer notch tracks the card centre, kept inside the rounded corners.
      const ax = Math.max(16, Math.min(card.left + card.width / 2 - finalLeft, width - 16));
      setPosition({ left: finalLeft, top, ready: true, side, ax, hidden });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    // A hovered hand card grows with a short transition: measure it again once it has grown.
    anchor.addEventListener("transitionend", place);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      anchor.removeEventListener("transitionend", place);
    };
  }, [anchor, interactive, prefer, avoid]);

  const style = {
    left: position.left,
    top: position.top,
    visibility: position.ready && !position.hidden ? "visible" : "hidden",
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
  const styles = useSkinStyles(baseStyles, "menu");
  const font = usePortalFont(anchor, styles !== baseStyles);
  const { ref, style: placed, visibility, side } = useAnchoredPosition(anchor, true);
  const style = font ? { ...font, ...placed } : placed;

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
            data-primary={index === 0 && option.id !== "surrender" ? "true" : undefined}
            data-danger={option.id === "surrender" ? "true" : undefined}
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

/**
 * Passive card tooltip. It never covers an open prompt panel or pile viewer: it moves to a clear
 * side of the card, and hides when there is none.
 */
export function CardHoverInfo({ card, anchor }: { card: DuelCard | DuelCardInfo; anchor: HTMLElement }) {
  const styles = useSkinStyles(baseStyles, "menu");
  const font = usePortalFont(anchor, styles !== baseStyles);
  const { ref, style: placed } = useAnchoredPosition(anchor, false, "above", true);
  const style = font ? { ...font, ...placed } : placed;
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

/** A short left-right shake of the card button a pick refused. Skipped with reduced motion. */
export function shakeRefusedCard(anchor: HTMLElement, reducedMotion: boolean): void {
  if (reducedMotion) return;
  safeAnimate(anchor, [
    { transform: "translateX(0)" },
    { transform: "translateX(-5px)" },
    { transform: "translateX(5px)" },
    { transform: "translateX(-3px)" },
    { transform: "translateX(0)" },
  ], { duration: 260, easing: "ease-out" });
}

/**
 * A short note on a card whose click a pick refused (the pick is full, or the card must stay picked).
 * It sits above the card like the hover tooltip and clears itself, so nothing is left to dismiss.
 */
export function PickRefusalHint({ anchor, text, onDone }: { anchor: HTMLElement; text: string; onDone: () => void }) {
  const styles = useSkinStyles(baseStyles, "menu");
  const font = usePortalFont(anchor, styles !== baseStyles);
  const { ref, style: placed } = useAnchoredPosition(anchor, false, "above");
  const style = font ? { ...font, ...placed } : placed;
  useEffect(() => {
    const timer = window.setTimeout(onDone, 2200);
    return () => window.clearTimeout(timer);
  }, [text, onDone]);

  return createPortal(
    <div ref={ref} className={`${styles.cardTooltip} ${duelFontClasses}`} style={style} role="status" data-pick-hint>
      <span>{text}</span>
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
  preview,
  onConfirm,
  onBack,
}: {
  anchor: HTMLElement;
  targetName: string;
  busy: boolean;
  prefer: "above" | "below";
  /** 3D mode only: the battle preview ("2500 vs 1700" and the outcome lines). Classic ignores it. */
  preview?: { attacker: string; target: string; lines: ReactNode[] };
  onConfirm: () => void;
  onBack: () => void;
}) {
  const fx = useSkinStyles(baseFx, "menu");
  const skinned = fx !== baseFx;
  const font = usePortalFont(anchor, skinned);
  const { ref, style: placed, visibility, side } = useAnchoredPosition(anchor, false, prefer);
  const style = font ? { ...font, ...placed } : placed;
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
      const target = event.target instanceof Element ? event.target : null;
      // Keys inside another dialog (Report a bug) are not for this popover.
      if (target?.closest("[role='dialog']:not([data-attack-confirm])")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        backRef.current();
        return;
      }
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
      {skinned && preview ? (
        <>
          <div data-confirm-vs>
            <span data-win>{preview.attacker}</span>
            <small>vs</small>
            <span>{preview.target}</span>
          </div>
          <div data-confirm-lines>{preview.lines.map((line, index) => <span key={index}>{line}</span>)}</div>
        </>
      ) : null}
      <div className={fx.confirmRow}>
        <button type="button" className={fx.confirmGo} data-go disabled={busy} aria-keyshortcuts="Enter" onClick={onConfirm}>
          Attack {targetName}
          {skinned ? <kbd data-keycap aria-hidden="true">Enter</kbd> : null}
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
