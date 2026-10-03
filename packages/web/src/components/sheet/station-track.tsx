import type { CSSProperties, ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type TrackStation = { code: string; name: string };

/**
 * Staged progress (lobby, playing, final). `current` is the index of the plate you are on
 * (-1 for none). Purple = your move, gold = settled / theirs, ember = your match is live.
 */
export function StationTrack({
  stations,
  current,
  tone,
  size = "md",
  align = "center",
  caption,
  label = "Progress",
  className,
}: {
  stations: TrackStation[];
  current: number;
  tone: "mine" | "theirs" | "live";
  size?: "md" | "sm";
  align?: "center" | "left";
  caption?: ReactNode;
  label?: string;
  className?: string;
}) {
  const style = { "--i": Math.max(current, 0) } as CSSProperties;
  return (
    <div className={cn("trk", size === "sm" && "sm", align === "left" && "left", className)} data-tone={tone} style={style}>
      <div className="trk-stack">
        <span className="trk-line" />
        <span className="trk-done" />
        {current >= 0 && <span className="trk-pool" />}
        <ol className="trk-plates" aria-label={label}>
          {stations.map((s, n) => {
            if (n < current) {
              return (
                <li key={s.code + n}>
                  <span className="trk-plate" data-state="done">
                    <b>{s.code}</b>
                    <small>{s.name}</small>
                    <span className="trk-tick"><Check className="ic" aria-hidden="true" /></span>
                  </span>
                </li>
              );
            }
            if (n === current) {
              return (
                <li key={s.code + n}>
                  <span className="trk-plate" data-state="current" aria-current="step">
                    <b>{s.code}</b>
                    <small>{s.name}</small>
                  </span>
                </li>
              );
            }
            return (
              <li key={s.code + n}>
                <span className="trk-plate" data-next={n === current + 1 ? "true" : undefined}>
                  <b>{s.code}</b>
                  <small>{s.name}</small>
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      {caption != null && <p className="trk-cap">{caption}</p>}
    </div>
  );
}
