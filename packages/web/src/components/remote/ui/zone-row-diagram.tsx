/**
 * Where the two calibration cards go, drawn from the player's seat: the Main Monster row is the row nearer the middle of the
 * table (M1 at the left), the Spell & Trap row is the row nearest the player (S5 at the right).
 */
export function ZoneRowDiagram({ className }: { className?: string }) {
  const cols = [0, 1, 2, 3, 4];
  const left = 64, step = 30, size = 24, top = 4, rowStep = 32;
  const cell = (row: number, col: number, lit: boolean) => (
    <rect key={`${row}-${col}`} x={left + col * step} y={top + row * rowStep} width={size} height={size + 2} rx="3.5" fill={lit ? "var(--gold, #e8b94f)" : "currentColor"} fillOpacity={lit ? 1 : 0.06} stroke={lit ? "var(--gold-ink, #f6dc9a)" : "currentColor"} strokeOpacity={lit ? 1 : 0.4} strokeWidth="1.2" />
  );
  return (
    <svg className={className} viewBox="0 0 224 84" role="img" aria-label="Seen from your seat: M1 is the far left card of the Main Monster row, the row nearer the middle of the table. S5 is the far right card of the Spell and Trap row, the row nearest you." style={{ display: "block", maxWidth: "100%", height: "auto", color: "var(--ink2, #cdbfe8)" }}>
      {cols.map(c => cell(0, c, c === 0))}
      {cols.map(c => cell(1, c, c === 4))}
      <g fontFamily="var(--font-duel-ui), 'Sofia Sans Semi Condensed', system-ui, sans-serif" fontSize="10" fill="currentColor">
        <text x="0" y="20" fontWeight="700" fill="var(--ink, #f1ead9)">Main</text><text x="0" y="31">Monster</text>
        <text x="0" y="52" fontWeight="700" fill="var(--ink, #f1ead9)">Spell &amp;</text><text x="0" y="63">Trap</text>
        <text x={left + size / 2} y={top + size / 2 + 4} textAnchor="middle" fill="#1b1204" fontWeight="800">M1</text>
        <text x={left + 4 * step + size / 2} y={top + rowStep + size / 2 + 4} textAnchor="middle" fill="#1b1204" fontWeight="800">S5</text>
        <text x={left + (4 * step + size) / 2} y="81" textAnchor="middle" fontSize="9.5" fill="var(--ink3, #aaa1ba)">▼ You sit at this edge</text>
      </g>
    </svg>
  );
}
