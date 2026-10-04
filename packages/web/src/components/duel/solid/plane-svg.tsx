import table from "./table.module.css";

/**
 * The attack path drawn on the plane (laid out in plane coordinates, so it tilts with the table). Stub from the
 * foundation: `aim` is the attacker and target boxes in plane pixels; the table worker draws the path.
 */
export type PlaneAim = { from: { x: number; y: number }; to: { x: number; y: number } } | null;

export function PlaneSvg({ aim }: { aim: PlaneAim }) {
  if (!aim) return null;
  return (
    <svg className={table.planeSvg} aria-hidden="true" data-sv-plane-svg="">
      <line x1={aim.from.x} y1={aim.from.y} x2={aim.to.x} y2={aim.to.y} stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
