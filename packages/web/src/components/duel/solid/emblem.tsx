import table from "./table.module.css";

const RAYS = Array.from({ length: 32 }, (_, index) => {
  const angle = (index / 32) * Math.PI * 2;
  const inner = 36;
  const outer = index % 2 ? 58 : 68;
  return {
    x1: (100 + Math.cos(angle) * inner).toFixed(1), y1: (100 + Math.sin(angle) * inner).toFixed(1),
    x2: (100 + Math.cos(angle) * outer).toFixed(1), y2: (100 + Math.sin(angle) * outer).toFixed(1),
  };
});

/** The gold emblem in the middle of the table (concept `EMBLEM`). Decoration only. */
export function Emblem() {
  return (
    <svg className={table.emblem} viewBox="0 0 200 200" aria-hidden="true" data-sv-emblem="">
      <g fill="none" stroke="currentColor" strokeWidth="0.8">
        <circle cx="100" cy="100" r="97" />
        <circle cx="100" cy="100" r="92" strokeDasharray="1.5 4" />
        <circle cx="100" cy="100" r="74" />
        <circle cx="100" cy="100" r="30" strokeWidth="1.2" />
        <circle cx="100" cy="100" r="22" />
        {RAYS.map((ray, index) => <line key={index} {...ray} />)}
      </g>
    </svg>
  );
}
