// The 24 Solid Vision icons (concept app.js 20-45): viewBox 24, stroke 1.6, round caps and joins, 16px by default.
const ICONS = {
  chevUp: <path d="M6 15l6-6 6 6" />,
  chevR: <path d="M9 6l6 6-6 6" />,
  summon: <><path d="M12 17V5" /><path d="M7 10l5-5 5 5" /><path d="M5 20h14" /></>,
  set: <><rect x="6" y="3.5" width="12" height="17" rx="1.5" /><path d="M12 8v6" /><path d="M9.5 11.5L12 14l2.5-2.5" /></>,
  sword: <><path d="M19 5l-9.5 9.5" /><path d="M14 5h5v5" /><path d="M7 13l4 4" /><path d="M8.5 15.5L5 19" /></>,
  target: <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" /></>,
  eye: <><path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" /><circle cx="12" cy="12" r="2.5" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="6.5" /><path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4L5.3 5.3" /></>,
  tilt: <path d="M7 7h10l4 11H3z" />,
  flat: <rect x="4" y="6" width="16" height="12" rx="1.5" />,
  bot: <><rect x="5" y="8" width="14" height="11" rx="2" /><path d="M12 4.5V8" /><path d="M9.5 13h.01M14.5 13h.01" /></>,
  user: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c1-4 4-6 7-6s6 2 7 6" /></>,
  lock: <><rect x="5" y="11" width="14" height="9" rx="1.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  coin: <><circle cx="12" cy="12" r="8" /><path d="M8.5 12h7" /></>,
  burst: <path d="M12 3l1.6 5 5-2.2-2.3 4.9 5 1.7-5 1.6 2.3 5-5-2.3L12 21l-1.6-5.3-5 2.3 2.3-5-5-1.6 5-1.7L5.4 5.8l5 2.2z" />,
  negate: <><circle cx="12" cy="12" r="8" /><path d="M6.4 6.4l11.2 11.2" /></>,
  arrowR: <><path d="M4 12h15" /><path d="M13 6l6 6-6 6" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  pause: <path d="M9 6v12M15 6v12" />,
  card: <rect x="6" y="3.5" width="12" height="17" rx="1.5" />,
  log: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
} as const;

export type SvIconName = keyof typeof ICONS;
export const SV_ICON_NAMES = Object.keys(ICONS) as SvIconName[];

export function SvIcon({ name, size = 16, className }: { name: SvIconName; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none" }}>
      {ICONS[name]}
    </svg>
  );
}
