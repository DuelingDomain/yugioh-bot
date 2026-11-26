import type { SVGProps } from "react";
import s from "./remote-ui.module.css";

const PATHS = {
  mic: <><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
  micoff: <><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M3 3l18 18" /></>,
  undo: <><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></>,
  hist: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
  log: <><path d="M5 4h14v16H5z" /><path d="M8 9h8M8 13h8M8 17h5" /></>,
  card: <><rect x="6" y="3" width="12" height="18" rx="2" /><path d="M9 8h6" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  warn: <><path d="M12 3 2 20h20L12 3z" /><path d="M12 10v4M12 17v.5" /></>,
  check: <path d="m5 12 5 5L20 7" />,
  next: <path d="M5 12h14M13 6l6 6-6 6" />,
  cam: <><path d="M4 7h3l2-3h6l2 3h3v13H4z" /><circle cx="12" cy="13" r="4" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  phone: <><rect x="7" y="2.5" width="10" height="19" rx="2" /><path d="M11 18.5h2" /></>,
  camoff: <><path d="M4 7h3l2-3h6l2 3h3v13H4z" /><path d="M3 3l18 18" /></>,
  hand: <path d="M4 20l1-5L16 4l4 4L9 19z" />,
  grip: <path d="M9 5v.01M15 5v.01M9 12v.01M15 12v.01M9 19v.01M15 19v.01" strokeWidth="3" strokeLinecap="round" />,
  flag: <path d="M5 21V4M5 4h11l-2 4 2 4H5" />,
  pin: <path d="M9 4h6l-1 6 3 3H7l3-3-1-6zM12 13v8" />,
  sword: <path d="M14 4h6v6L10 20l-6-6zM5 19l-2 2M8 16l-3 3" />,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5z" /><path d="m3 13 9 5 9-5" /></>,
  cardback: <><rect x="6" y="3" width="12" height="18" rx="2" /><path d="m12 9 2.5 3-2.5 3-2.5-3z" /></>,
  flip: <><path d="M4 11a8 8 0 0 1 14-4l2 2" /><path d="M20 4v5h-5" /><path d="M20 13a8 8 0 0 1-14 4l-2-2" /><path d="M4 20v-5h5" /></>,
  coin: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3.5" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.01" /></>,
  chev: <path d="m9 6 6 6-6 6" />,
  back: <path d="m15 6-6 6 6 6" />,
  bolt: <path d="M13 3 5 14h6l-1 7 8-11h-6z" />,
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  ban: <><circle cx="12" cy="12" r="9" /><path d="m5.6 5.6 12.8 12.8" /></>,
  swap: <><path d="M4 8h14l-4-4M20 16H6l4 4" /></>,
  refresh: <><path d="M20 12a8 8 0 1 1-2.3-5.6L20 8" /><path d="M20 3v5h-5" /></>,
  dots: <path d="M5 12v.01M12 12v.01M19 12v.01" strokeWidth="3" strokeLinecap="round" />,
  scan: <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16" />,
  snow: <path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" />,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></>,
  sliders: <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6" />,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className, ...rest }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" {...rest} className={className ? `${s.ic} ${className}` : s.ic}>{PATHS[name]}</svg>;
}
