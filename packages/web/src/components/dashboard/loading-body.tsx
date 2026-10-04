import type { CSSProperties } from "react";
import { FloorList, FloorRow } from "@/components/sheet";

/**
 * What a list page shows while its data loads: the real heading and actions come from the page frame,
 * and the body is blocks of the same rhythm as the rows that will replace them. The blocks are still
 * (no shimmer). One status for assistive tech, the blocks themselves are hidden from it.
 */
export function LoadingBody({ label, sections = [3, 2], cols = "36px minmax(0, 1fr) 96px" }: {
  label: string;
  /** Rows in each section. */
  sections?: number[];
  cols?: string;
}) {
  return (
    <div role="status" aria-label={label} aria-busy="true" data-testid="loading-body" style={{ display: "grid", gap: "clamp(28px, 4cqi, 44px)", minWidth: 0 }}>
      {sections.map((rows, section) => (
        <section key={section} aria-hidden="true">
          <div style={{ padding: "0 0 14px" }}>
            <span className="sk" style={{ width: 132, height: 14 }} />
          </div>
          <FloorList>
            {Array.from({ length: rows }, (_, row) => (
              <FloorRow key={row} cols={cols} phoneCols="30px minmax(0, 1fr) 64px" phoneAreas={'"a b c"'}>
                <span className="sk" style={{ height: 30, width: 30, borderRadius: "50%" } as CSSProperties} />
                <span style={{ display: "grid", gap: 8, minWidth: 0 }}>
                  <span className="sk" style={{ width: `${62 - ((row * 11) % 24)}%`, height: 13 }} />
                  <span className="sk" style={{ width: `${38 + ((row * 7) % 18)}%` }} />
                </span>
                <span className="sk" style={{ width: "100%", height: 12 }} />
              </FloorRow>
            ))}
          </FloorList>
        </section>
      ))}
    </div>
  );
}
