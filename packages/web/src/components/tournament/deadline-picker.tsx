"use client";

import * as React from "react";
import { Calendar, ChevronLeft, ChevronRight, Clock, X } from "lucide-react";
import {
  browserTimeZone,
  daysAwayLabel,
  daysBetween,
  daysFromTodayLabel,
  formatDateButton,
  formatDateShort,
  formatTime,
  isSameDay,
  monthCells,
  monthTitle,
  startOfDay,
  timeOptions,
  withDay,
  withMinutes,
} from "./create-tournament-model";
import styles from "./deadline-picker.module.css";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

type Open = "date" | "time" | null;

/**
 * The deadline field: a date button and a time button that open the app's own picker,
 * a clear button and a line saying how far away the deadline is. Times are in the
 * browser's time zone. The picker is absolutely positioned under its buttons.
 */
export function DeadlinePicker({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string;
  value: Date | null;
  onChange: (next: Date | null) => void;
}) {
  const [open, setOpen] = React.useState<Open>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const dateBtnRef = React.useRef<HTMLButtonElement>(null);
  const timeBtnRef = React.useRef<HTMLButtonElement>(null);
  const labelId = `${idPrefix}-label`;

  const restoreTo = React.useRef<"date" | "time" | null>(null);
  const close = (restoreFocus: boolean) => {
    if (restoreFocus) restoreTo.current = open;
    setOpen(null);
  };

  // After a popover closes, put focus back on the button that opened it (the buttons may
  // have just been swapped, so this runs after the commit).
  React.useEffect(() => {
    if (open !== null || !restoreTo.current) return;
    (restoreTo.current === "time" ? timeBtnRef : dateBtnRef).current?.focus();
    restoreTo.current = null;
  }, [open]);

  // Click outside closes.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const now = value ? new Date() : null;

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <span className="label" id={labelId}>
        Deadline <span style={{ color: "var(--ink-3)" }}>optional</span>
      </span>
      {value ? (
        <div className="dtf" role="group" aria-labelledby={labelId}>
          <button
            ref={dateBtnRef}
            id={`${idPrefix}-date`}
            type="button"
            className="input dtf-b"
            aria-haspopup="dialog"
            aria-expanded={open === "date"}
            onClick={() => setOpen(open === "date" ? null : "date")}
          >
            <Calendar className="ic sm" aria-hidden="true" />
            {formatDateButton(value)}
          </button>
          <button
            ref={timeBtnRef}
            id={`${idPrefix}-time`}
            type="button"
            className="input dtf-b"
            aria-haspopup="listbox"
            aria-expanded={open === "time"}
            onClick={() => setOpen(open === "time" ? null : "time")}
          >
            <Clock className="ic sm" aria-hidden="true" />
            {formatTime(value)}
          </button>
          <button
            type="button"
            className={`dtf-x ${styles.focus}`}
            aria-label="Clear the deadline"
            onClick={() => {
              onChange(null);
              setOpen(null);
            }}
          >
            <X className="ic sm" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <div className="dtf" role="group" aria-labelledby={labelId}>
          <button
            ref={dateBtnRef}
            id={`${idPrefix}-date`}
            type="button"
            className="input dtf-b dtf-e"
            aria-haspopup="dialog"
            aria-expanded={open === "date"}
            onClick={() => setOpen(open === "date" ? null : "date")}
          >
            <Calendar className="ic sm" aria-hidden="true" />
            No deadline · add one
          </button>
        </div>
      )}

      {open === "date" && (
        <DatePopover
          value={value}
          onPick={(day) => {
            onChange(withDay(value, day));
            close(true);
          }}
          onClear={() => {
            onChange(null);
            close(true);
          }}
          onClose={() => close(true)}
        />
      )}
      {open === "time" && value && (
        <TimePopover
          value={value}
          onPick={(minutes, closePicker = true) => {
            onChange(withMinutes(value, minutes));
            if (closePicker) close(true);
          }}
          onClose={(restore) => close(restore)}
        />
      )}

      <p className="hint" id={`${idPrefix}-hint`}>
        {value && now ? (
          <>
            {daysFromTodayLabel(now, value)}
            {browserTimeZone() ? `, in your time zone (${browserTimeZone().replace(/_/g, " ")}). ` : ". "}
            Closes the tournament as it stands. Unplayed matches stay unplayed and no champion is recorded.
          </>
        ) : (
          "Runs until every match is decided or you end it."
        )}
      </p>
    </div>
  );
}

function DatePopover({
  value,
  onPick,
  onClear,
  onClose,
}: {
  value: Date | null;
  onPick: (day: Date) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const today = React.useMemo(() => startOfDay(new Date()), []);
  const start = value && daysBetween(today, value) >= 0 ? value : today;
  const [view, setView] = React.useState({ y: start.getFullYear(), m: start.getMonth() });
  const [focusDay, setFocusDay] = React.useState<Date>(startOfDay(start));
  const ref = React.useRef<HTMLDivElement>(null);
  const shouldFocus = React.useRef(true);

  // Focus the day button for `focusDay` (on open and after keyboard moves).
  React.useEffect(() => {
    if (!shouldFocus.current) return;
    const el = ref.current?.querySelector<HTMLButtonElement>(`button[data-day="${focusDay.getTime()}"]`);
    el?.focus();
  }, [focusDay, view]);

  const moveFocus = (next: Date) => {
    const clamped = next.getTime() < today.getTime() ? today : next;
    shouldFocus.current = true;
    setFocusDay(startOfDay(clamped));
    setView({ y: clamped.getFullYear(), m: clamped.getMonth() });
  };

  const shiftMonth = (delta: number) => {
    moveFocus(new Date(view.y, view.m + delta, 1));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === "Tab") {
      const focusable = Array.from(
        ref.current?.querySelectorAll<HTMLElement>("button:not(:disabled):not([tabindex='-1'])") ?? [],
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
      return;
    }
    const target = (e.target as HTMLElement).closest<HTMLElement>("button[data-day]");
    if (!target) return;
    const cur = new Date(Number(target.dataset.day));
    const step = (days: number) => new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + days);
    const stepMonth = (delta: number) => {
      const month = cur.getMonth() + delta;
      const lastDay = new Date(cur.getFullYear(), month + 1, 0).getDate();
      return new Date(cur.getFullYear(), month, Math.min(cur.getDate(), lastDay));
    };
    switch (e.key) {
      case "ArrowLeft": e.preventDefault(); moveFocus(step(-1)); break;
      case "ArrowRight": e.preventDefault(); moveFocus(step(1)); break;
      case "ArrowUp": e.preventDefault(); moveFocus(step(-7)); break;
      case "ArrowDown": e.preventDefault(); moveFocus(step(7)); break;
      case "PageUp": e.preventDefault(); moveFocus(stepMonth(-1)); break;
      case "PageDown": e.preventDefault(); moveFocus(stepMonth(1)); break;
    }
  };

  const cells = monthCells(view.y, view.m);
  const atCurrentMonth = view.y === today.getFullYear() && view.m === today.getMonth();

  return (
    <div className={`dtp ${styles.pop}`} role="dialog" aria-label="Choose a date" ref={ref} onKeyDown={onKeyDown}>
      <div className="dtp-h">
        <button type="button" className={`dtf-x ${styles.focus}`} aria-label="Previous month" disabled={atCurrentMonth} onClick={() => shiftMonth(-1)}>
          <ChevronLeft className="ic sm" aria-hidden="true" />
        </button>
        <b aria-live="polite">{monthTitle(view.y, view.m)}</b>
        <button type="button" className={`dtf-x ${styles.focus}`} aria-label="Next month" onClick={() => shiftMonth(1)}>
          <ChevronRight className="ic sm" aria-hidden="true" />
        </button>
      </div>
      <div className="dtp-g" aria-hidden="true">
        {WEEKDAYS.map((d) => (
          <i key={d}>{d}</i>
        ))}
      </div>
      <div className="dtp-g">
        {cells.map((cell, i) => {
          if (!cell.date) return <span key={`b${i}`} />;
          const day = cell.date;
          const past = day.getTime() < today.getTime();
          const isToday = isSameDay(day, today);
          const selected = value != null && isSameDay(day, value);
          const isFocus = isSameDay(day, focusDay);
          return (
            <button
              key={day.getTime()}
              type="button"
              data-day={day.getTime()}
              className={[styles.focus, styles.day, isToday ? "today" : "", selected ? "sel" : ""].join(" ").trim()}
              disabled={past}
              tabIndex={isFocus ? 0 : -1}
              aria-current={isToday ? "date" : undefined}
              aria-pressed={selected}
              aria-label={day.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
              onClick={() => onPick(day)}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
      <div className="dtp-f">
        <button type="button" className={`btn btn-quiet btn-sm ${styles.focus}`} onClick={onClear}>
          No deadline
        </button>
        <span>{value ? `${formatDateShort(value)} · ${daysAwayLabel(new Date(), value)}` : ""}</span>
      </div>
    </div>
  );
}

function TimePopover({
  value,
  onPick,
  onClose,
}: {
  value: Date;
  onPick: (minutes: number, closePicker?: boolean) => void;
  onClose: (restoreFocus: boolean) => void;
}) {
  const options = React.useMemo(() => timeOptions(), []);
  const current = value.getHours() * 60 + value.getMinutes();
  const found = options.findIndex((o) => o.minutes === current);
  const nearest = found >= 0 ? found : options.findIndex((o) => o.minutes > current);
  const [active, setActive] = React.useState(nearest >= 0 ? nearest : 0);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    ref.current?.focus();
  }, []);

  React.useEffect(() => {
    ref.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); setActive((i) => Math.min(i + 1, options.length - 1)); break;
      case "ArrowUp": e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); break;
      case "Home": e.preventDefault(); setActive(0); break;
      case "End": e.preventDefault(); setActive(options.length - 1); break;
      case "Enter":
      case " ":
        e.preventDefault();
        onPick(options[active].minutes);
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        onClose(true);
        break;
      case "Tab":
        if (!e.shiftKey) onClose(false);
        break;
    }
  };

  return (
    <div className={`dtp dtp-t ${styles.pop}`}>
      <input
        type="time"
        step={60}
        className="input"
        aria-label="Deadline time"
        defaultValue={`${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`}
        onChange={(e) => {
          if (!e.currentTarget.value || !e.currentTarget.validity.valid) return;
          const [hours, minutes] = e.currentTarget.value.split(":").map(Number);
          onPick(hours * 60 + minutes, false);
        }}
        onBlur={(e) => {
          if (!ref.current?.contains(e.relatedTarget)) onClose(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose(true);
          }
        }}
      />
      <div
        ref={ref}
        className={styles.times}
        role="listbox"
        aria-label="Choose a time"
        tabIndex={0}
        aria-activedescendant={`deadline-time-${active}`}
        onKeyDown={onKeyDown}
      >
        {options.map((o, i) => (
          <span
            key={o.minutes}
            id={`deadline-time-${i}`}
            data-i={i}
            data-active={i === active ? "true" : undefined}
            className={styles.opt}
            role="option"
            aria-selected={o.minutes === current}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(o.minutes)}
          >
            {o.label}
          </span>
        ))}
      </div>
    </div>
  );
}
